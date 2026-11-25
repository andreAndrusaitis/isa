/**
 * API externa de integração (/api/integrations/v1/*).
 *
 * API REST por recurso, autenticada por API key com escopos granulares
 * (ver services/apiKeys.ts) e idempotência por external_request_id.
 */
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { AppError } from '../middlewares/errorHandler'
import { TicketService } from './tickets'
import { AuthorizedDomainService } from './authorizedDomains'
import { createUser, updateUser } from './users'
import { MAX_BYTES, resolveAttachmentMime, storeAttachment } from './uploads'
import { getAvailableCategoriesForOrg } from './categories'
import type { ApiKeyContext } from '../middlewares/apiKeyAuth'
import { assertSenderAllowed } from './email/blocklist'
import { createOrganization } from './organizations'
import { createAuditLog } from './audit'

const externalId = z.string().trim().min(1).max(255).optional()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------

// Anexo em base64 cru. Aceita snake_case ou o formato do Outlook/Graph
// (contentType/contentBytes) — no Power Automate dá para repassar
// body/attachments do gatilho direto, sem mapear campo a campo.
const attachmentFields = {
  name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().max(255).nullish(),
  content_bytes: z.string().trim().nullish(),
  contentType: z.string().trim().max(255).nullish(),
  contentBytes: z.string().trim().nullish(),
}
type AttachmentInput = z.infer<z.ZodObject<typeof attachmentFields>>

export const createTicketSchema = z.object({
  external_request_id: externalId,
  organization_id: z.string().uuid().optional(),
  requester: z.object({
    email: z.string().trim().email().max(255),
    name: z.string().trim().min(1).max(255).optional(),
  }),
  ticket: z.object({
    // title/description são obrigatórios para chamados comuns, mas uma
    // subcategoria "especial" (ex.: onboarding/offboarding) deriva o título de
    // um template e não usa descrição livre — nesse caso envie special_data
    // em vez de title/description. A validação real (o que é obrigatório em
    // cada caso) é feita por TicketService.createTicket.
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).max(50000).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    queue: z.string().trim().min(1).max(100).optional(),
    category_id: z.string().trim().min(1).nullable().optional(),
    subcategory_id: z.string().trim().min(1).nullable().optional(),
    // Só usado quando a subcategoria é especial (ver GET /subcategories →
    // is_special/special_form_schema) — chaves e valores do formulário
    // dinâmico daquela subcategoria.
    special_data: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    // O Power Automate costuma serializar a lista como texto ("@{...}") — aceita array ou string JSON.
    attachments: z.preprocess(
      (v) => {
        if (typeof v !== 'string') return v
        if (!v.trim()) return []
        try { return JSON.parse(v) } catch { return v }
      },
      z.array(z.object(attachmentFields)).max(20),
    ).optional(),
  }),
})

export const updateTicketSchema = z.object({
  external_request_id: externalId,
  status: z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  queue: z.string().trim().min(1).max(100).optional(),
  assigned_to_email: z.string().trim().email().max(255).optional(),
  note: z.string().trim().min(1).max(5000).optional(),
})

// Um arquivo por chamada — para anexos grandes que não cabem junto do POST /tickets.
export const addAttachmentSchema = z.object({
  external_request_id: externalId,
  ...attachmentFields,
})

/** Valida tipo/conteúdo antes de qualquer escrita (falha cedo, sem chamado órfão). */
export function prepareAttachment(a: AttachmentInput) {
  const base64 = a.content_bytes || a.contentBytes
  if (!base64) {
    throw new AppError(400, `Anexo "${a.name}" sem conteúdo (content_bytes) — no Outlook, ligue Include Attachments`, 'EMPTY_ATTACHMENT')
  }
  const mime = resolveAttachmentMime(a.name, a.content_type || a.contentType)
  if (!mime) throw new AppError(400, `Tipo de arquivo não permitido: ${a.name}`, 'INVALID_ATTACHMENT_TYPE')
  const bytes = Buffer.byteLength(base64, 'base64')
  // Checa aqui, não só no upload: senão os anexos anteriores já subiram ao blob e ficam órfãos.
  if (bytes > MAX_BYTES) throw new AppError(413, `Anexo "${a.name}" excede o tamanho máximo (10 MB)`, 'ATTACHMENT_TOO_LARGE')
  return { name: a.name, mime, base64, bytes }
}

type PreparedAttachment = ReturnType<typeof prepareAttachment>

/** Sobe ao blob e devolve os dados da linha de ticket_attachments (sem ticket_id). */
async function uploadAttachment(a: PreparedAttachment) {
  const url = await storeAttachment(`data:${a.mime};base64,${a.base64}`)
  return { name: a.name, size: String(a.bytes), type: a.mime.startsWith('image/') ? 'image' : 'file', url: url! }
}

// Não grava base64 no log de requisições.
const describeAttachment = (a: PreparedAttachment) => ({ name: a.name, mime: a.mime, bytes: a.bytes })

export const closureSchema = z.object({
  status: z.enum(['resolved', 'closed']),
  note: z.string().trim().min(1).max(5000).optional(),
  external_request_id: externalId,
})

export const createUserSchema = z.object({
  external_request_id: externalId,
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  organization_id: z.string().uuid().optional(),
})

export const updateUserSchema = z.object({
  external_request_id: externalId,
  changes: z.object({
    name: z.string().trim().min(1).max(255).optional(),
    email: z.string().trim().email().max(255).optional(),
    active: z.boolean().optional(),
    organization_id: z.string().uuid().nullable().optional(),
  }),
})

// ------------------------------------------------------------------
// Idempotência + log por chave
// ------------------------------------------------------------------

export interface ApiOperationResult {
  statusCode: number
  resourceType: string
  resourceId: string
  body: unknown
}

/** Dona do log/idempotência: chave da API de chamados ou da API de Projetos. */
export type ApiRequestOwner = { api_key_id: string } | { project_api_key_id: string }

export async function runIdempotentOperation(
  apiKey: ApiKeyContext,
  method: string,
  path: string,
  payload: { external_request_id?: string },
  meta: { ip?: string },
  handler: () => Promise<ApiOperationResult>,
): Promise<{ statusCode: number; body: unknown }> {
  return runIdempotent({ api_key_id: apiKey.id }, method, path, payload, meta, handler)
}

export async function runIdempotent(
  owner: ApiRequestOwner,
  method: string,
  path: string,
  payload: { external_request_id?: string },
  meta: { ip?: string },
  handler: () => Promise<ApiOperationResult>,
): Promise<{ statusCode: number; body: unknown }> {
  const externalRequestId = payload.external_request_id ?? null

  if (externalRequestId) {
    // findFirst: a chave única composta tem nome diferente para cada tipo de dona.
    const existing = await prisma.apiRequestLog.findFirst({
      where: { ...owner, external_request_id: externalRequestId },
    })

    if (existing && (existing.status === 'success' || existing.status === 'duplicate')) {
      return {
        statusCode: 200,
        body: { duplicate: true, request_id: existing.id, resource_type: existing.resource_type, resource_id: existing.resource_id },
      }
    }
    // 'received' é o pedido em curso entre gravar o log e marcá-lo 'processing':
    // executar aqui duplicaria o recurso. Só o que falhou pode rodar de novo.
    if (existing && (existing.status === 'processing' || existing.status === 'received')) {
      throw new AppError(409, 'Requisição com este external_request_id ainda está em processamento', 'API_REQUEST_IN_FLIGHT')
    }
    if (existing) {
      return execute(existing.id)
    }
  }

  const request = await prisma.apiRequestLog.create({
    data: {
      ...owner,
      external_request_id: externalRequestId,
      method,
      path,
      status: 'received',
      request_payload: sanitizePayload(payload),
      ip: meta.ip ?? null,
    },
  }).catch((err) => {
    // Retentativa simultânea com o mesmo external_request_id: a outra está processando.
    if (err?.code === 'P2002') throw new AppError(409, 'Requisição com este external_request_id ainda está em processamento', 'API_REQUEST_IN_FLIGHT')
    throw err
  })

  return execute(request.id)

  async function execute(requestId: string) {
    await prisma.apiRequestLog.update({
      where: { id: requestId },
      data: { status: 'processing', error_code: null, error_message: null, request_payload: sanitizePayload(payload) },
    })

    try {
      const result = await handler()

      await prisma.apiRequestLog.update({
        where: { id: requestId },
        data: {
          status: 'success',
          resource_type: result.resourceType,
          resource_id: result.resourceId,
          response_status: result.statusCode,
          response_payload: { resource_type: result.resourceType, resource_id: result.resourceId },
        },
      })

      return { statusCode: result.statusCode, body: result.body }
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : error instanceof z.ZodError
          ? new AppError(400, 'Dados inválidos', 'VALIDATION_ERROR', error.flatten().fieldErrors)
          : new AppError(500, 'Falha ao processar requisição', 'API_REQUEST_FAILED')

      await prisma.apiRequestLog.update({
        where: { id: requestId },
        data: { status: 'failed', response_status: appError.statusCode, error_code: appError.code, error_message: appError.message },
      }).catch(() => undefined)

      throw appError
    }
  }
}

// ------------------------------------------------------------------
// Operações de escrita
// ------------------------------------------------------------------

export async function createTicket(apiKey: ApiKeyContext, payload: unknown, meta: { ip?: string }) {
  const data = createTicketSchema.parse(payload)
  const attachments = (data.ticket.attachments ?? []).map(prepareAttachment)
  const logged = { ...data, ticket: { ...data.ticket, attachments: attachments.map(describeAttachment) } }

  return runIdempotentOperation(apiKey, 'POST', '/tickets', logged, meta, async () => {
    const email = data.requester.email.toLowerCase()
    // Remetente bloqueado (spam, aviso de não entrega): não abre chamado nem cria usuário.
    await assertSenderAllowed(email)
    const organization = await resolveOrganization(apiKey, data.organization_id ?? null, email)
    const requester = await resolveRequester({ email, name: data.requester.name ?? email.split('@')[0], organizationId: organization.id, apiKey })

    if (data.ticket.category_id) await assertCategoryExists(data.ticket.category_id)
    if (data.ticket.subcategory_id) await assertSubcategoryExists(data.ticket.subcategory_id)

    // Sobe os anexos antes de criar o chamado: se o blob falhar, o retry não duplica chamado.
    const uploaded = await Promise.all(attachments.map(uploadAttachment))

    const ticket = await TicketService.createTicket({
      title: data.ticket.title,
      description: data.ticket.description,
      special_data: data.ticket.special_data,
      priority: data.ticket.priority ?? 'medium',
      category_id: data.ticket.category_id ?? null,
      subcategory_id: data.ticket.subcategory_id ?? null,
      user_id: requester.id,
      org_id: requester.org_id ?? organization.id,
      queue: data.ticket.queue ?? undefined,
      attachment_url: null,
      attachments: uploaded,
      channel: 'api',
    }, requester.id)

    if (!ticket?.id) throw new AppError(500, 'Chamado criado, mas resposta não possui id', 'API_TICKET_RESPONSE_INVALID')

    return {
      statusCode: 201,
      resourceType: 'ticket' as const,
      resourceId: ticket.id as string,
      body: {
        duplicate: false,
        resource_type: 'ticket',
        resource_id: ticket.id,
        portal_url: portalTicketUrl(ticket.id as string),
        ticket,
        attachments: uploaded.map(u => ({ name: u.name, size: Number(u.size), type: u.type })),
      },
    }
  })
}

/**
 * Empresa do remetente pelo domínio; sem empresa cadastrada, cria uma com o
 * domínio (fornecedores e e-mail pessoal ficam de fora pelos Bloqueios). Empresa
 * inativa com o domínio não é recriada: o e-mail não abre chamado.
 */
async function resolveOrCreateEmailOrganization(email: string): Promise<{ organization: Awaited<ReturnType<typeof resolveOrganization>>; created: boolean }> {
  try {
    return { organization: await resolveOrganization({ org_id: null } as ApiKeyContext, null, email), created: false }
  } catch (err) {
    if (!(err instanceof AppError && err.code === 'API_ORG_NOT_FOUND')) throw err
  }
  const domain = email.split('@')[1]!.toLowerCase()
  const byDomain = { deleted_at: null, OR: [{ domains: { has: domain } }, { domains: { has: `@${domain}` } }] }
  // Duas instâncias lendo e-mails do mesmo domínio novo: a trava faz só uma criar.
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-org:${domain}`}))`
    const existing = await tx.organization.findFirst({ where: byDomain, orderBy: { created_at: 'asc' } })
    if (existing && !existing.active) {
      throw new AppError(403, `A empresa ${existing.name} (domínio ${domain}) está inativa`, 'ORGANIZATION_INACTIVE')
    }
    if (existing) return { organization: existing, created: false }
    const organization = await createOrganization({
      name: domain,
      domains: [domain],
      notes: `Criada automaticamente pelo e-mail de ${email} recebido na caixa de atendimento em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    })
    await createAuditLog({ action: 'CREATE_ORG', resource: 'ORG', details: { orgId: organization.id, name: organization.name, via: 'email', from: email } })
    return { organization, created: true }
  })
}

/**
 * Chamado aberto por e-mail recebido na caixa de atendimento — mesmas regras do
 * POST /tickets: empresa pelo domínio do
 * remetente (criada se não existir), solicitante criado/reaproveitado, anexos no
 * blob. A idempotência fica a cargo de inbound_emails (uma linha por mensagem).
 */
export async function createTicketFromEmail(input: {
  fromEmail: string
  fromName?: string | null
  subject: string
  text: string
  attachments: { name: string; contentType?: string; contentBytes: string }[]
  /** Anexos que o e-mail trazia mas não dá para importar (ex.: link de nuvem). */
  notImported?: string[]
}) {
  const email = input.fromEmail.toLowerCase()
  await assertSenderAllowed(email)
  if (!email.split('@')[1]) throw new AppError(400, 'E-mail do solicitante inválido', 'REQUESTER_EMAIL_INVALID')
  const { organization, created: createdOrganization } = await resolveOrCreateEmailOrganization(email)
  const createdUser = !(await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deleted_at: null }, select: { id: true } }))
  const requester = await resolveRequester({ email, name: input.fromName || email.split('@')[0], organizationId: organization.id })

  // Anexo inválido (tipo bloqueado, grande demais) não impede o chamado: entra sem ele.
  const skipped: string[] = [...(input.notImported ?? [])]
  const prepared = input.attachments.flatMap(a => {
    try { return [prepareAttachment({ name: a.name, content_bytes: a.contentBytes, content_type: a.contentType } as AttachmentInput)] }
    catch { skipped.push(a.name); return [] }
  })
  const uploaded = await Promise.all(prepared.map(uploadAttachment))
  const description = [
    input.text.trim() || '(e-mail sem texto)',
    skipped.length ? `\n\n[Anexos não importados (tipo, tamanho ou formato não suportado): ${skipped.join(', ')}]` : '',
  ].join('')

  const ticket = await TicketService.createTicket({
    title: input.subject.trim().slice(0, 255) || '(sem assunto)',
    description,
    priority: 'medium',
    category_id: env.MAIL_INBOUND_CATEGORY_ID ?? null,
    subcategory_id: env.MAIL_INBOUND_SUBCATEGORY_ID ?? null,
    user_id: requester.id,
    org_id: requester.org_id ?? organization.id,
    attachment_url: null,
    attachments: uploaded,
    channel: 'email',
  }, requester.id)
  return { ticket, organization: { id: organization.id, name: organization.name }, createdOrganization, createdUser }
}

export async function updateTicket(apiKey: ApiKeyContext, ticketId: string, payload: unknown, meta: { ip?: string }) {
  const data = updateTicketSchema.parse(payload)

  return runIdempotentOperation(apiKey, 'PATCH', `/tickets/${ticketId}`, data, meta, async () => {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
    assertResourceInScope(apiKey, ticket.org_id)

    let assignedToId: string | undefined
    if (data.assigned_to_email) {
      const agent = await prisma.user.findFirst({ where: { email: { equals: data.assigned_to_email, mode: 'insensitive' as const }, deleted_at: null, active: true } })
      if (!agent) throw new AppError(404, 'Usuário de assigned_to_email não encontrado', 'ASSIGNEE_NOT_FOUND')
      assignedToId = agent.id
    }

    const updateData: any = {}
    if (data.status) updateData.status = data.status
    if (data.priority) updateData.priority = data.priority
    if (data.queue) updateData.queue = data.queue
    if (assignedToId) updateData.assigned_to_id = assignedToId
    if (data.note) updateData.note = data.note

    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, 'Nenhum campo para atualizar foi informado', 'API_EMPTY_UPDATE')
    }

    await TicketService.updateTicket(ticketId, 'system', 'system', updateData)

    return {
      statusCode: 200,
      resourceType: 'ticket' as const,
      resourceId: ticketId,
      body: { duplicate: false, resource_type: 'ticket', resource_id: ticketId },
    }
  })
}

export async function addTicketAttachment(apiKey: ApiKeyContext, ticketId: string, payload: unknown, meta: { ip?: string }) {
  const data = addAttachmentSchema.parse(payload)
  const prepared = prepareAttachment(data)
  const logged = { external_request_id: data.external_request_id, ...describeAttachment(prepared) }

  return runIdempotentOperation(apiKey, 'POST', `/tickets/${ticketId}/attachments`, logged, meta, async () => {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
    assertResourceInScope(apiKey, ticket.org_id)

    const attachment = await prisma.ticketAttachment.create({
      data: { ...(await uploadAttachment(prepared)), ticket_id: ticketId },
    })

    return {
      statusCode: 201,
      resourceType: 'ticket' as const,
      resourceId: ticketId,
      body: {
        duplicate: false,
        resource_type: 'ticket',
        resource_id: ticketId,
        attachment: { id: attachment.id, name: attachment.name, size: prepared.bytes, type: attachment.type },
      },
    }
  })
}

export async function closeTicket(apiKey: ApiKeyContext, ticketId: string, payload: unknown, meta: { ip?: string }) {
  const data = closureSchema.parse(payload)

  return runIdempotentOperation(apiKey, 'POST', `/tickets/${ticketId}/closure`, data, meta, async () => {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
    assertResourceInScope(apiKey, ticket.org_id)

    const updated = await TicketService.updateTicket(ticketId, 'system', 'system', {
      status: data.status,
      note: data.note,
    })

    return {
      statusCode: 200,
      resourceType: 'ticket' as const,
      resourceId: ticketId,
      body: { duplicate: false, resource_type: 'ticket', resource_id: ticketId, ticket: updated },
    }
  })
}

export async function createExternalUser(apiKey: ApiKeyContext, payload: unknown, meta: { ip?: string }) {
  const data = createUserSchema.parse(payload)

  return runIdempotentOperation(apiKey, 'POST', '/users', data, meta, async () => {
    const orgId = apiKey.org_id ?? data.organization_id
    await validateOrgId(orgId)

    const email = data.email.toLowerCase()
    const sso = await AuthorizedDomainService.isSsoEmail(email)
    const user = await createUser({
      name: data.name,
      email,
      ...(sso ? { authProvider: 'microsoft' } : { password: randomUUID() }),
      // API externa só provisiona usuário final — nunca staff (agent/supervisor/manager/admin).
      role: 'user',
      org_id: orgId,
      queues: [],
    } as any)

    return {
      statusCode: 201,
      resourceType: 'user' as const,
      resourceId: user.id,
      body: { duplicate: false, resource_type: 'user', resource_id: user.id, user: { id: user.id, name: user.name, email: user.email, role: user.role, org_id: user.org_id, active: user.active, created_at: user.created_at } },
    }
  })
}

export async function updateExternalUser(apiKey: ApiKeyContext, idOrEmail: string, payload: unknown, meta: { ip?: string }) {
  const data = updateUserSchema.parse(payload)

  return runIdempotentOperation(apiKey, 'PATCH', `/users/${idOrEmail}`, data, meta, async () => {
    const user = UUID_RE.test(idOrEmail)
      ? await prisma.user.findFirst({ where: { id: idOrEmail, role: 'user', deleted_at: null } })
      : await prisma.user.findFirst({ where: { email: { equals: idOrEmail, mode: 'insensitive' as const }, role: 'user', deleted_at: null } })

    if (!user) throw new AppError(404, 'Usuário não encontrado', 'USER_NOT_FOUND')
    assertResourceInScope(apiKey, user.org_id)

    if (data.changes.organization_id !== undefined) {
      // O destino também precisa estar ao alcance da key, não só a empresa atual.
      assertResourceInScope(apiKey, data.changes.organization_id)
      await validateOrgId(data.changes.organization_id)
    }

    await updateUser(user.id, {
      name: data.changes.name,
      email: data.changes.email,
      active: data.changes.active,
      org_id: data.changes.organization_id,
    } as any)

    return {
      statusCode: 200,
      resourceType: 'user' as const,
      resourceId: user.id,
      body: { duplicate: false, resource_type: 'user', resource_id: user.id },
    }
  })
}

// ------------------------------------------------------------------
// Leituras de referência (sem idempotência/log — não têm efeito colateral)
// ------------------------------------------------------------------

// Escopo opcional do catálogo: mesma resolução de empresa do POST /tickets.
export const catalogScopeQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
  requester_email: z.string().trim().email().max(255).optional(),
})

/**
 * Empresa cujo plano filtra o catálogo — a mesma que receberia o chamado: key
 * travada usa a própria empresa; key multi-empresa usa organization_id ou o
 * domínio de requester_email. Sem nenhuma pista devolve null (catálogo
 * inteiro, comportamento anterior). Plano vencido bloqueia como na abertura.
 */
async function resolveCatalogOrganization(apiKey: ApiKeyContext | undefined, query: unknown) {
  if (!apiKey) return null
  const scope = catalogScopeQuerySchema.parse(query ?? {})
  if (!apiKey.org_id && !scope.organization_id && !scope.requester_email) return null

  const org = await resolveOrganization(apiKey, scope.organization_id ?? null, scope.requester_email?.toLowerCase() ?? '')
  if (org.expires_at && org.expires_at < new Date()) {
    throw new AppError(403, org.expiry_message || 'Abertura de chamados bloqueada: O plano de SLA desta empresa está vencido.', 'SLA_PLAN_EXPIRED')
  }
  return org
}

// Visual igual ao portal: image_url (URL ou data URI) tem prioridade; senão a cor da categoria.
const CATEGORY_SELECT = { id: true, name: true, description: true, icon: true, color: true, image_url: true } as const
const SUBCATEGORY_FIELDS = ['id', 'name', 'category_id', 'description', 'icon', 'image_url', 'is_special', 'special_form_schema', 'special_title_template'] as const

export async function listCategories(apiKey?: ApiKeyContext, query?: unknown) {
  const org = await resolveCatalogOrganization(apiKey, query)
  if (org) {
    return (await getAvailableCategoriesForOrg(org.id))
      .map(c => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, color: c.color, image_url: c.image_url }))
  }
  return prisma.category.findMany({ where: { active: true }, select: CATEGORY_SELECT, orderBy: { name: 'asc' } })
}

export async function listSubcategories(categoryId?: string, apiKey?: ApiKeyContext, query?: unknown) {
  const org = await resolveCatalogOrganization(apiKey, query)
  if (org) {
    return (await getAvailableCategoriesForOrg(org.id))
      .flatMap(c => c.subcategories)
      .filter(s => !categoryId || s.category_id === categoryId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => Object.fromEntries(SUBCATEGORY_FIELDS.map(field => [field, s[field]])))
  }
  return prisma.subcategory.findMany({
    where: { active: true, ...(categoryId ? { category_id: categoryId } : {}) },
    // is_special/special_form_schema: quando true, POST /tickets não usa
    // title/description — o título vem de special_title_template e os campos
    // dinâmicos declarados aqui devem ser enviados em ticket.special_data.
    select: { id: true, name: true, category_id: true, description: true, icon: true, image_url: true, is_special: true, special_form_schema: true, special_title_template: true },
    orderBy: { name: 'asc' },
  })
}

export async function listQueues() {
  return prisma.queue.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
}

export async function listOrganizations(apiKey: ApiKeyContext) {
  return prisma.organization.findMany({
    where: { active: true, deleted_at: null, ...(apiKey.org_id ? { id: apiKey.org_id } : {}) },
    select: { id: true, name: true, domains: true },
    orderBy: { name: 'asc' },
  })
}

const TICKET_SELECT = {
  id: true, display_number: true, title: true, description: true, special_data: true,
  status: true, priority: true, type: true, queue: true, pending_reason: true,
  sla_deadline: true, first_response_deadline: true, escalated: true, is_reopened: true,
  resolution_details: true, resolved_at: true, closed_at: true, created_at: true, updated_at: true,
  org: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  assigned_to: { select: { id: true, name: true, email: true } },
} as const

const csv = z.string().transform(s => s.split(',').map(v => v.trim()).filter(Boolean))

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
  status: csv.pipe(z.array(z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed']))).optional(),
  organization_id: z.string().uuid().optional(),
  updated_since: z.coerce.date().optional(),
  created_since: z.coerce.date().optional(),
  // Chamados de um solicitante (qualquer canal) — "meus chamados" de uma integração.
  requester_email: z.string().trim().email().max(255).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
})

/** Lista paginada de chamados (ordem: updated_at asc, para sync incremental via updated_since). */
export async function listTickets(apiKey: ApiKeyContext, query: unknown) {
  const q = listTicketsQuerySchema.parse(query)
  if (apiKey.org_id && q.organization_id && q.organization_id !== apiKey.org_id) {
    throw new AppError(404, 'Recurso não encontrado', 'API_KEY_OUT_OF_SCOPE')
  }
  const where: any = {
    deleted_at: null,
    ...(apiKey.org_id || q.organization_id ? { org_id: apiKey.org_id ?? q.organization_id } : {}),
    ...(q.status ? { status: { in: q.status } } : {}),
    ...(q.updated_since ? { updated_at: { gte: q.updated_since } } : {}),
    ...(q.created_since ? { created_at: { gte: q.created_since } } : {}),
    ...(q.requester_email ? { user: { email: { equals: q.requester_email, mode: 'insensitive' as const } } } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      select: TICKET_SELECT,
      orderBy: [{ updated_at: q.order }, { id: q.order }],
      skip: (q.page - 1) * q.per_page,
      take: q.per_page,
    }),
  ])
  return { data: data.map(t => ({ ...t, portal_url: portalTicketUrl(t.id) })), pagination: { page: q.page, per_page: q.per_page, total, total_pages: Math.ceil(total / q.per_page) } }
}

export async function getTicket(apiKey: ApiKeyContext, idOrNumber: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { deleted_at: null, OR: [{ id: idOrNumber }, { display_number: idOrNumber }] },
    select: { ...TICKET_SELECT, org_id: true },
  })
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
  assertResourceInScope(apiKey, ticket.org_id)
  const { org_id: _orgId, ...data } = ticket
  return { ...data, portal_url: portalTicketUrl(ticket.id), survey_url: await pendingSurveyUrl(ticket.id, ticket.status) }
}

/**
 * Link do chamado (e-mail, API externa, variáveis de macro). /c/<id> abre como
 * solicitante ou como equipe, conforme quem entra; /portal?ticket= antigo
 * continua redirecionando.
 */
export function portalTicketUrl(ticketId: string): string {
  return `${env.PORTAL_URL.replace(/\/+$/, '')}/c/${encodeURIComponent(ticketId)}`
}

/**
 * Pesquisa de satisfação ainda não respondida de um chamado encerrado. Só lê a
 * instância já disparada — não cria (a rota interna /survey-link cria sob demanda).
 */
async function pendingSurveyUrl(ticketId: string, status: string): Promise<string | null> {
  if (status !== 'resolved' && status !== 'closed') return null
  const instance = await prisma.surveyInstance.findUnique({ where: { ticket_id: ticketId }, select: { link_token: true, status: true } })
  return instance?.status === 'enviada' ? `${env.PORTAL_URL.replace(/\/+$/, '')}/survey/${instance.link_token}` : null
}

// ------------------------------------------------------------------
// Mensagens públicas do chamado (conversa solicitante ↔ atendimento)
// ------------------------------------------------------------------

const requesterEmail = z.string().trim().email().max(255)

export const ticketMessagesQuerySchema = z.object({ requester_email: requesterEmail.optional() })

export const createMessageSchema = z.object({
  external_request_id: externalId,
  // Autor da resposta: precisa ser o solicitante do chamado.
  requester_email: requesterEmail,
  text: z.string().trim().min(1).max(5000),
  attachments: z.array(z.object(attachmentFields)).max(5).optional(),
})

/**
 * Chamado no escopo da key; com requester_email, só se for desse solicitante
 * (404 em vez de 403 para não revelar chamados de terceiros).
 */
async function findRequesterTicket(apiKey: ApiKeyContext, idOrNumber: string, email?: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { deleted_at: null, OR: [{ id: idOrNumber }, { display_number: idOrNumber }] },
    select: { id: true, org_id: true, user_id: true, user: { select: { email: true } } },
  })
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
  assertResourceInScope(apiKey, ticket.org_id)
  if (email && ticket.user.email.toLowerCase() !== email.toLowerCase()) {
    throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
  }
  return ticket
}

/** Conversa pública do chamado (sem notas internas), da mais antiga para a mais nova. */
export async function listTicketMessages(apiKey: ApiKeyContext, idOrNumber: string, query: unknown) {
  const q = ticketMessagesQuerySchema.parse(query ?? {})
  const ticket = await findRequesterTicket(apiKey, idOrNumber, q.requester_email)
  const messages = await prisma.ticketMessage.findMany({
    where: { ticket_id: ticket.id, type: { not: 'internal' } },
    select: { id: true, type: true, text: true, attachment_url: true, created_at: true, user_id: true, user: { select: { name: true } } },
    orderBy: { created_at: 'asc' },
  })
  return messages.map(m => ({
    id: m.id,
    type: m.type,
    text: m.text,
    author_name: m.user?.name ?? null,
    from_requester: m.user_id === ticket.user_id,
    // O arquivo fica no blob do ISA (acesso autenticado): a integração só sabe que existe.
    has_attachment: Boolean(m.attachment_url),
    created_at: m.created_at,
  }))
}

/**
 * Resposta do solicitante vinda da integração — entra como mensagem do próprio
 * usuário (mesmas regras do portal: chamado fechado recusa, resolvido reabre).
 * Anexos extras viram mensagens "Anexo adicional", como no wizard do portal.
 */
export async function createTicketMessage(apiKey: ApiKeyContext, idOrNumber: string, payload: unknown, meta: { ip?: string }) {
  const data = createMessageSchema.parse(payload)
  const attachments = (data.attachments ?? []).map(prepareAttachment)
  const logged = { ...data, attachments: attachments.map(describeAttachment) }

  return runIdempotentOperation(apiKey, 'POST', `/tickets/${idOrNumber}/messages`, logged, meta, async () => {
    const ticket = await findRequesterTicket(apiKey, idOrNumber, data.requester_email)
    const dataUri = (a: PreparedAttachment) => `data:${a.mime};base64,${a.base64}`
    const [first, ...rest] = attachments

    const message = await TicketService.addMessage(ticket.id, ticket.user_id, data.text, 'user', first ? dataUri(first) : undefined)
    for (const extra of rest) {
      await TicketService.addMessage(ticket.id, ticket.user_id, `Anexo adicional: ${extra.name}`, 'user', dataUri(extra))
    }

    return {
      statusCode: 201,
      resourceType: 'ticket' as const,
      resourceId: ticket.id,
      body: { duplicate: false, resource_type: 'ticket', resource_id: ticket.id, message: { id: message.id, created_at: message.created_at } },
    }
  })
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Key travada numa empresa não pode ler/alterar recurso de outra. */
function assertResourceInScope(apiKey: ApiKeyContext, resourceOrgId: string | null) {
  if (apiKey.org_id && resourceOrgId !== apiKey.org_id) {
    throw new AppError(404, 'Recurso não encontrado', 'API_KEY_OUT_OF_SCOPE')
  }
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, active: true } })
  if (!category) throw new AppError(404, 'Categoria informada não existe ou está inativa', 'CATEGORY_NOT_FOUND')
}

async function assertSubcategoryExists(subcategoryId: string): Promise<void> {
  const subcategory = await prisma.subcategory.findFirst({ where: { id: subcategoryId, active: true } })
  if (!subcategory) throw new AppError(404, 'Subcategoria informada não existe ou está inativa', 'SUBCATEGORY_NOT_FOUND')
}

async function validateOrgId(orgId: string | null | undefined): Promise<void> {
  if (!orgId) return
  const org = await prisma.organization.findFirst({ where: { id: orgId, active: true, deleted_at: null } })
  if (!org) throw new AppError(400, 'Organização informada não existe ou está inativa', 'API_ORG_INVALID')
}

/**
 * Resolve a organização do chamado: key travada numa empresa sempre usa essa
 * empresa (ignora qualquer organization_id do payload); key multi-empresa usa
 * o organization_id explícito, ou resolve pelo domínio do e-mail do
 * solicitante.
 */
async function resolveOrganization(apiKey: ApiKeyContext, payloadOrgId: string | null, requesterEmail: string) {
  if (apiKey.org_id) {
    const org = await prisma.organization.findFirst({ where: { id: apiKey.org_id, active: true, deleted_at: null } })
    if (!org) throw new AppError(400, 'Organização da API key não existe ou está inativa', 'API_KEY_ORG_INVALID')
    return org
  }

  if (payloadOrgId) {
    const org = await prisma.organization.findFirst({ where: { id: payloadOrgId, active: true, deleted_at: null } })
    if (!org) throw new AppError(400, 'organization_id informado não existe ou está inativa', 'API_ORG_INVALID')
    return org
  }

  const domain = requesterEmail.split('@')[1]?.toLowerCase()
  if (!domain) throw new AppError(400, 'E-mail do solicitante inválido', 'REQUESTER_EMAIL_INVALID')

  // domains não é único entre empresas: a mais antiga com o domínio vence, sempre a mesma.
  const organization = await prisma.organization.findFirst({
    where: { active: true, deleted_at: null, OR: [{ domains: { has: domain } }, { domains: { has: `@${domain}` } }] },
    orderBy: { created_at: 'asc' },
  })
  if (!organization) {
    throw new AppError(400, 'Empresa não encontrada para o domínio do solicitante — informe organization_id ou trave a key numa empresa', 'API_ORG_NOT_FOUND')
  }
  return organization
}

async function resolveRequester(input: { email: string; name: string; organizationId: string; apiKey?: ApiKeyContext }) {
  const existing = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' as const }, deleted_at: null } })

  if (existing) {
    // O chamado segue a empresa do solicitante: key travada não abre em nome de
    // quem é de outra empresa, nem adota quem está sem empresa.
    if (input.apiKey) assertResourceInScope(input.apiKey, existing.org_id)
    if (!existing.active) throw new AppError(403, `O solicitante ${input.email} está inativo, então não pode abrir nem atualizar chamados. Reative o usuário em Cadastros › Usuários ou use outro solicitante.`, 'REQUESTER_INACTIVE')
    if (!existing.org_id) {
      return prisma.user.update({ where: { id: existing.id }, data: { org_id: input.organizationId } })
    }
    return existing
  }

  // Domínio liberado para SSO → conta 'microsoft' sem senha (igual ao auto-provisionamento do login SSO).
  const sso = await AuthorizedDomainService.isSsoEmail(input.email)
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      ...(sso ? { auth_provider: 'microsoft' } : { password: await bcrypt.hash(randomUUID(), 10) }),
      role: 'user',
      org_id: input.organizationId,
      queues: [],
      active: true,
    },
  })
}

/** Limita o payload logado (JSONB) a um tamanho seguro. */
function sanitizePayload(payload: unknown): any {
  try {
    const text = JSON.stringify(payload)
    if (text.length <= 100_000) return payload
    return { _truncated: true, preview: text.slice(0, 100_000) }
  } catch {
    return { _unserializable: true }
  }
}
