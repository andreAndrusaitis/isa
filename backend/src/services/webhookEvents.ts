/**
 * Emissão de eventos para webhooks de saída.
 *
 * `emitWebhookEvent` é chamado imperativamente nos pontos de negócio (criação/
 * atualização de tickets, usuários etc.) — mesmo padrão do NotificationService.
 * É fire-safe: nunca lança e nunca bloqueia o fluxo chamador.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { attemptDelivery } from './webhookDelivery'
import { presentAttachment } from './uploads'

export const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.resolved',
  'ticket.closed',
  'ticket.escalated',
  'ticket.inactive',
  'sla.warning',
  'ticket.message_created',
  'ticket.message_created_by_user',
  'ticket.message_created_by_agent',
  'user.created',
  'user.updated',
  'user.deleted',
  'organization.created',
  'email.ticket_opened',
  'email.not_opened',
  'ping',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]

/** Descrições em português para a UI admin montar a seleção de eventos. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, { group: string; label: string; description: string }> = {
  'ticket.created':         { group: 'Chamados', label: 'Chamado criado', description: 'Um novo chamado foi aberto por qualquer canal.' },
  'ticket.updated':         { group: 'Chamados', label: 'Chamado atualizado', description: 'Qualquer alteração em um chamado existente.' },
  'ticket.status_changed':  { group: 'Chamados', label: 'Status alterado', description: 'O chamado mudou de status (ex.: Novo → Em atendimento).' },
  'ticket.assigned':        { group: 'Chamados', label: 'Chamado atribuído', description: 'O chamado ganhou ou trocou de analista responsável.' },
  'ticket.resolved':        { group: 'Chamados', label: 'Chamado resolvido', description: 'O atendimento foi marcado como resolvido.' },
  'ticket.closed':          { group: 'Chamados', label: 'Chamado fechado', description: 'O chamado foi encerrado definitivamente.' },
  'ticket.escalated':       { group: 'SLA e escalonamento', label: 'Chamado escalonado', description: 'O chamado subiu para a fila N2 (automático ou manual).' },
  'ticket.inactive':        { group: 'SLA e escalonamento', label: 'Chamado inativo', description: 'O chamado ficou sem atuação além do limite configurado e foi redirecionado automaticamente.' },
  'sla.warning':            { group: 'SLA e escalonamento', label: 'SLA em risco', description: 'Faltam 30 minutos para o vencimento do SLA.' },
  'ticket.message_created': { group: 'Mensagens', label: 'Nova mensagem', description: 'Alguém escreveu uma mensagem pública em um chamado, de qualquer lado.' },
  'ticket.message_created_by_user': { group: 'Mensagens', label: 'Nova mensagem do usuário', description: 'O usuário (solicitante) escreveu uma mensagem pública no chamado.' },
  'ticket.message_created_by_agent': { group: 'Mensagens', label: 'Nova mensagem do analista', description: 'Um analista/atendente escreveu uma mensagem pública no chamado.' },
  'user.created':           { group: 'Usuários e empresas', label: 'Usuário criado', description: 'Um novo usuário foi cadastrado.' },
  'user.updated':           { group: 'Usuários e empresas', label: 'Usuário atualizado', description: 'Dados de um usuário foram alterados.' },
  'user.deleted':           { group: 'Usuários e empresas', label: 'Usuário excluído', description: 'Um usuário foi removido do sistema.' },
  'organization.created':   { group: 'Usuários e empresas', label: 'Empresa criada', description: 'Uma nova organização foi cadastrada.' },
  'email.ticket_opened':    { group: 'E-mail', label: 'E-mail abriu chamado', description: 'Um e-mail recebido na caixa de atendimento abriu um chamado (indica se a empresa e o usuário foram criados agora).' },
  'email.not_opened':       { group: 'E-mail', label: 'E-mail não abriu chamado', description: 'Um e-mail recebido na caixa de atendimento não virou chamado nem resposta; traz o motivo (bloqueado, resposta automática, empresa inativa, falha etc.).' },
  'ping':                   { group: 'Sistema', label: 'Ping de teste', description: 'Evento de teste disparado pelo botão Testar.' },
}

// ------------------------------------------------------------------
// Builders de payload — controlam PII e tamanho do que sai do sistema
// ------------------------------------------------------------------

/** Subconjunto seguro de um ticket já mapeado (mapTicket). Sem anexos/base64. */
export function buildTicketPayload(ticket: any): Record<string, unknown> {
  if (!ticket) return {}
  return {
    id: ticket.id,
    display_number: ticket.display_number ?? ticket.displayNumber ?? null,
    title: ticket.title,
    description: ticket.description ?? null,
    special_data: ticket.special_data ?? null,
    status: ticket.status,
    priority: ticket.priority,
    type: ticket.type ?? null,
    queue: ticket.queue ?? null,
    org_id: ticket.org_id ?? ticket.orgId ?? null,
    user_id: ticket.user_id ?? ticket.userId ?? null,
    assigned_to_id: ticket.assigned_to_id ?? ticket.assignedToId ?? null,
    category_id: ticket.category_id ?? ticket.categoryId ?? null,
    subcategory_id: ticket.subcategory_id ?? ticket.subcategoryId ?? null,
    escalated: ticket.escalated ?? false,
    sla_deadline: ticket.sla_deadline ?? ticket.slaDeadline ?? null,
    created_at: ticket.created_at ?? ticket.createdAt ?? null,
    updated_at: ticket.updated_at ?? ticket.updatedAt ?? null,
    resolved_at: ticket.resolved_at ?? ticket.resolvedAt ?? null,
    closed_at: ticket.closed_at ?? ticket.closedAt ?? null,
    user: ticket.user ?? null,
    organization: ticket.organization ?? null,
    category: ticket.category ?? null,
    subcategory: ticket.subcategory ?? null,
    attachment_url: ticket.attachment_url ?? ticket.attachmentUrl ?? null,
    attachments: ticket.attachments ?? null,
  }
}

/** Subconjunto seguro de um usuário. Nunca inclui senha/tokens. */
export function buildUserPayload(user: any): Record<string, unknown> {
  if (!user) return {}
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    org_id: user.org_id ?? user.orgId ?? null,
    active: user.active ?? true,
    created_at: user.created_at ?? user.createdAt ?? null,
    updated_at: user.updated_at ?? user.updatedAt ?? null,
    deleted_at: user.deleted_at ?? user.deletedAt ?? null,
  }
}

const MESSAGE_TEXT_MAX = 2000

/** Subconjunto seguro de uma mensagem de ticket. Texto truncado, sem base64. */
export function buildMessagePayload(message: any): Record<string, unknown> {
  if (!message) return {}
  const text = typeof message.text === 'string' ? message.text : ''
  return {
    id: message.id,
    ticket_id: message.ticket_id ?? message.ticketId ?? null,
    user_id: message.user_id ?? message.userId ?? null,
    type: message.type ?? null,
    text: text.length > MESSAGE_TEXT_MAX ? text.slice(0, MESSAGE_TEXT_MAX) : text,
    attachment_url: message.attachment_url ?? message.attachmentUrl ?? null,
    created_at: message.created_at ?? message.createdAt ?? null,
  }
}

// ------------------------------------------------------------------
// Emissão
// ------------------------------------------------------------------

/**
 * Cria deliveries para todos os endpoints ativos que assinam o evento e dispara
 * a primeira tentativa de entrega. Retorna os ids das deliveries criadas.
 */
export async function emitWebhookEventInternal(
  event: WebhookEventType,
  data: Record<string, unknown>,
  onlyEndpointId?: string, // disparo direcionado (ação de regra de automação): ignora assinatura e filtros
): Promise<string[]> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: onlyEndpointId ? { id: onlyEndpointId, active: true } : { active: true, events: { has: event } },
    select: { id: true, filters: true },
  })
  if (endpoints.length === 0) return []

  // Se o evento envolver um chamado, buscar os dados ricos para envio e validação
  let richData = { ...data }
  let ticketSnapshot: any = data.ticket

  if (ticketSnapshot && ticketSnapshot.id) {
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticketSnapshot.id },
      include: {
        org: true,
        user: true,
        category: true,
        subcategory: true,
        attachments: true,
        assigned_to: { select: { id: true, name: true, manager_id: true } },
      },
    })
    
    if (fullTicket) {
      const attachments = fullTicket.attachments?.map(a => ({ id: a.id, filename: a.name, url: presentAttachment(a.url) ?? a.url })) || []
      if (fullTicket.attachment_url) {
        const filename = fullTicket.attachment_url.split('/').pop() || 'anexo'
        if (!attachments.some(a => a.url === fullTicket.attachment_url)) {
          attachments.unshift({
            id: 'main',
            filename,
            url: fullTicket.attachment_url,
          })
        }
      }

      richData.ticket = {
        ...ticketSnapshot,
        description: fullTicket.description ?? ticketSnapshot.description ?? null,
        organization: fullTicket.org ? { id: fullTicket.org.id, name: fullTicket.org.name } : null,
        user: fullTicket.user ? { id: fullTicket.user.id, name: fullTicket.user.name, email: fullTicket.user.email } : null,
        category: fullTicket.category ? { id: fullTicket.category.id, name: fullTicket.category.name } : null,
        subcategory: fullTicket.subcategory ? { id: fullTicket.subcategory.id, name: fullTicket.subcategory.name } : null,
        attachment_url: fullTicket.attachment_url || null,
        attachments,
        assigned_to: fullTicket.assigned_to
          ? { id: fullTicket.assigned_to.id, name: fullTicket.assigned_to.name, manager_id: fullTicket.assigned_to.manager_id }
          : null,
      }

      // Gestor do analista responsável — resolvido aqui para que o filtro
      // manager_ids valha para qualquer evento de chamado, sem o chamador informar.
      if (richData.manager_id == null) {
        richData.manager_id = fullTicket.assigned_to?.manager_id ?? null
      }
    }
  }

  const timestamp = new Date().toISOString()
  const ids: string[] = []
  for (const endpoint of endpoints) {
    // Avaliar filtros
    if (!onlyEndpointId && endpoint.filters && richData.ticket) {
      const f = endpoint.filters as any
      const t = richData.ticket as any
      
      if (f.types?.length > 0 && (!t.type || !f.types.includes(t.type))) continue
      if (f.priorities?.length > 0 && (!t.priority || !f.priorities.includes(t.priority))) continue
      if (f.queues?.length > 0 && (!t.queue || !f.queues.includes(t.queue))) continue
      if (f.category_ids?.length > 0 && (!t.category_id || !f.category_ids.includes(t.category_id))) continue
      if (f.subcategory_ids?.length > 0 && (!t.subcategory_id || !f.subcategory_ids.includes(t.subcategory_id))) continue
      if (f.org_ids?.length > 0 && (!t.org_id || !f.org_ids.includes(t.org_id))) continue
      // Gestor do analista responsável — aceita o gestor atual ou o anterior
      // (num redirecionamento o chamado muda de dono, e quem acompanha é qualquer um dos dois).
      if (f.manager_ids?.length > 0) {
        const managerIds = [richData.manager_id, richData.previous_manager_id].filter(Boolean)
        if (!managerIds.some((id: any) => f.manager_ids.includes(id))) continue
      }
    }

    const deliveryId = randomUUID()
    await prisma.webhookDelivery.create({
      data: {
        id: deliveryId,
        endpoint_id: endpoint.id,
        event,
        payload: { event, timestamp, delivery_id: deliveryId, data: richData } as any,
        status: 'pending',
        next_retry_at: null,
      },
    })
    ids.push(deliveryId)
  }

  for (const id of ids) {
    attemptDelivery(id).catch((error) => {
      logger.error('[Webhooks] Falha na tentativa imediata de entrega', { deliveryId: id, error: error?.message })
    })
  }

  return ids
}

/**
 * Versão fire-safe usada nos pontos de negócio: nunca lança, nunca bloqueia.
 * Em ambiente de teste não emite (os testes usam emitWebhookEventInternal).
 */
export function emitWebhookEvent(event: WebhookEventType, data: Record<string, unknown>, onlyEndpointId?: string): void {
  if (env.NODE_ENV === 'test') return

  setImmediate(() => {
    emitWebhookEventInternal(event, data, onlyEndpointId).catch((error) => {
      logger.error('[Webhooks] Falha ao emitir evento', { event, error: error?.message })
    })
  })
}

// ------------------------------------------------------------------
// Payload de exemplo — usado pela UI admin para o operador copiar e colar
// em sistemas externos (ex.: "Usar conteúdo de exemplo para gerar o
// esquema" no Power Automate, ou o schema JSON de um trigger HTTP).
// ------------------------------------------------------------------

export function buildExamplePayload(event: WebhookEventType): Record<string, unknown> {
  const now = Date.now()
  const iso = (offsetMinutes = 0) => new Date(now + offsetMinutes * 60_000).toISOString()

  const subcategoryId = randomUUID()

  const sampleTicket = {
    id: 'ISA-1042',
    display_number: null,
    title: 'Não consigo acessar o sistema financeiro',
    status: 'open',
    priority: 'high',
    type: 'incident',
    queue: 'N1',
    org_id: randomUUID(),
    user_id: randomUUID(),
    assigned_to_id: null as string | null,
    category_id: randomUUID(),
    // Preenchido (em vez de null) para que a inferência de JSON Schema capture
    // o formato do objeto aninhado — subcategory pode ser null na realidade,
    // mas um exemplo nulo aqui esconderia suas propriedades do schema gerado.
    subcategory_id: subcategoryId,
    // Exemplo de chamado especial (ex: onboarding). As chaves são definidas
    // pelo Admin por subcategoria — o schema gerado trata isto como objeto
    // de chaves dinâmicas (ver inferJsonSchema), não como estes campos fixos.
    special_data: { nome_completo: 'Maria Souza', cargo: 'Analista de Suporte', data_admissao: '2026-08-01' } as Record<string, string> | null,
    escalated: false,
    sla_deadline: iso(180),
    created_at: iso(-10),
    updated_at: iso(-10),
    resolved_at: null as string | null,
    closed_at: null as string | null,
    organization: { id: randomUUID(), name: 'ACME Corp' },
    user: { id: randomUUID(), name: 'Maria Souza', email: 'maria@acme.com' },
    category: { id: randomUUID(), name: 'Sistemas ERP' },
    subcategory: { id: subcategoryId, name: 'Acesso a sistemas' },
    attachments: [
      { id: randomUUID(), filename: 'erro.png', url: 'https://exemplo.com/erro.png' }
    ]
  }

  const sampleUser = {
    id: randomUUID(),
    name: 'Maria Souza',
    email: 'maria.souza@empresa.com.br',
    role: 'user',
    org_id: randomUUID(),
    active: true,
    created_at: iso(-1440),
    updated_at: iso(-1440),
  }

  const sampleMessage = {
    id: randomUUID(),
    ticket_id: sampleTicket.id,
    user_id: sampleUser.id,
    type: 'public',
    text: 'Já tentei reiniciar o computador, mas o erro persiste.',
    attachment_url: null,
    created_at: iso(-2),
  }

  const sampleEmail = {
    id: randomUUID(),
    from_email: 'maria@acme.com.br',
    // null no exemplo: o schema gerado aceita remetente sem nome de exibição.
    from_name: null as string | null,
    subject: 'Impressora do financeiro parou',
    received_at: iso(-1),
    body_text: 'Bom dia, a impressora do financeiro parou de imprimir desde cedo. Segue o print do erro.',
    attachments: [
      { id: randomUUID(), filename: 'erro-impressora.png', content_type: 'image/png', url: 'https://exemplo.com/erro-impressora.png' },
    ],
  }

  let data: Record<string, unknown>
  switch (event) {
    case 'ticket.created':
    case 'ticket.updated':
      data = { ticket: buildTicketPayload(sampleTicket) }
      break
    case 'ticket.status_changed':
      data = { ticket: buildTicketPayload({ ...sampleTicket, status: 'in_progress' }), from: 'open', to: 'in_progress' }
      break
    case 'ticket.assigned': {
      const assignedToId = randomUUID()
      data = {
        ticket: buildTicketPayload({ ...sampleTicket, assigned_to_id: assignedToId }),
        previous_assigned_to_id: null,
        assigned_to_id: assignedToId,
      }
      break
    }
    case 'ticket.resolved':
      data = { ticket: buildTicketPayload({ ...sampleTicket, status: 'resolved', resolved_at: iso() }) }
      break
    case 'ticket.closed':
      data = { ticket: buildTicketPayload({ ...sampleTicket, status: 'closed', closed_at: iso() }) }
      break
    case 'ticket.escalated':
      data = {
        ticket: buildTicketPayload({ ...sampleTicket, escalated: true, priority: 'high' }),
        trigger: 'sla_auto',
        previous_queue: 'N1',
        escalation_queue: 'N2',
      }
      break
    case 'ticket.inactive': {
      const inactiveAgentId = randomUUID()
      data = {
        ticket: buildTicketPayload({ ...sampleTicket, assigned_to_id: inactiveAgentId, priority: 'high' }),
        inactive_hours: 8,
        previous_assigned_to_id: randomUUID(),
        assigned_to_id: inactiveAgentId,
        manager_id: randomUUID(),
        previous_manager_id: randomUUID(),
      }
      break
    }
    case 'sla.warning':
      data = { ticket: buildTicketPayload(sampleTicket), sla_deadline: sampleTicket.sla_deadline, escalation_minutes: 30 }
      break
    case 'ticket.message_created':
    case 'ticket.message_created_by_user':
    case 'ticket.message_created_by_agent':
      data = { ticket: buildTicketPayload(sampleTicket), message: buildMessagePayload(sampleMessage) }
      break
    case 'user.created':
    case 'user.updated':
      data = { user: buildUserPayload(sampleUser) }
      break
    case 'organization.created':
      data = { organization: { id: randomUUID(), name: 'ACME S.A.', tier: 'gold', created_at: iso(-4320) } }
      break
    case 'email.ticket_opened':
      data = {
        email: sampleEmail,
        ticket: buildTicketPayload(sampleTicket),
        organization: { id: sampleTicket.org_id, name: 'acme.com.br' },
        created_organization: true,
        created_user: true,
      }
      break
    case 'email.not_opened':
      data = {
        email: sampleEmail,
        status: 'ignored',
        reason: 'sender_blocked',
        detail: 'remetente bloqueado (domínio acme.com.br)',
        ticket_id: null,
      }
      break
    case 'ping':
    default:
      data = { message: 'Evento de teste disparado pelo painel do ISA' }
  }

  return {
    event,
    timestamp: iso(),
    delivery_id: randomUUID(),
    data,
  }
}

// ------------------------------------------------------------------
// JSON Schema — derivado do payload de exemplo. Usado pela UI admin para
// o operador colar direto em ferramentas que pedem o esquema do corpo da
// requisição (ex.: campo "Solicitar Esquema JSON do Corpo" de um gatilho
// HTTP no Power Automate), sem precisar da etapa "gerar a partir de exemplo".
// ------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/**
 * Infere um fragmento de JSON Schema (draft-07) a partir de um valor de
 * exemplo. Heurística de domínio: um valor nulo no exemplo vira string
 * anulável (["string","null"]) — todo campo nulo neste sistema é um
 * id/timestamp opcional; campos-objeto nulos são preenchidos no exemplo
 * (ver buildExamplePayload) para não perder as propriedades no schema.
 */
export function inferJsonSchema(value: unknown, key?: string): Record<string, unknown> {
  // special_data vem de formulários especiais configuráveis por Admin (chaves
  // variam por subcategoria) — descrever como objeto de chaves dinâmicas em
  // vez de travar no exemplo de uma subcategoria específica.
  if (key === 'special_data') {
    return {
      type: ['object', 'null'],
      description: 'Campos do formulário especial da subcategoria (chaves definidas pelo Admin).',
      additionalProperties: { type: 'string' },
    }
  }

  if (value === null) return { type: ['string', 'null'] }

  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferJsonSchema(value[0]) : {} }
  }

  switch (typeof value) {
    case 'string':
      return ISO_DATE_RE.test(value) ? { type: 'string', format: 'date-time' } : { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object': {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
        properties[k] = inferJsonSchema(val, k)
        required.push(k)
      }
      return { type: 'object', properties, required }
    }
    default:
      return {}
  }
}

/** JSON Schema (draft-07) do envelope completo enviado para um evento. */
export function buildEventJsonSchema(event: WebhookEventType): Record<string, unknown> {
  const example = buildExamplePayload(event)
  const schema = inferJsonSchema(example)
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `ISA — evento ${event}`,
    ...schema,
  }
}
