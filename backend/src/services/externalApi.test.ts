import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'

// createUser dispara e-mail de boas-vindas real via ACS — mockado para o teste
// não depender de rede nem enviar e-mail de verdade para domínios fictícios.
vi.mock('./email/mailer', () => ({
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SUCCESS' as const })),
}))
import {
  createTicket, updateTicket, createExternalUser, updateExternalUser,
  listCategories, listSubcategories, listQueues, listOrganizations, closeTicket,
  listTickets, getTicket,
} from './externalApi'
import type { ApiKeyContext } from '../middlewares/apiKeyAuth'

const SUFFIX = `extapi-${Date.now()}`
const domainA = `${SUFFIX}-a.example.com`
const domainB = `${SUFFIX}-b.example.com`

let orgAId: string
let orgBId: string
let categoryId: string
let subcategoryId: string
let specialSubcategoryId: string
let lockedKeyId: string
let multiKeyId: string

async function setup() {
  const orgA = await prisma.organization.create({ data: { name: `Org A ${SUFFIX}`, domains: [domainA] } })
  const orgB = await prisma.organization.create({ data: { name: `Org B ${SUFFIX}`, domains: [domainB] } })
  orgAId = orgA.id
  orgBId = orgB.id

  const category = await prisma.category.create({ data: { name: `Categoria ${SUFFIX}` } })
  categoryId = category.id
  const subcategory = await prisma.subcategory.create({ data: { name: `Subcategoria ${SUFFIX}`, category_id: categoryId } })
  subcategoryId = subcategory.id
  const specialSubcategory = await prisma.subcategory.create({
    data: {
      name: `Subcategoria Especial ${SUFFIX}`,
      category_id: categoryId,
      is_special: true,
      special_form_schema: [
        {
          key: 'ambientes',
          label: 'Ambientes',
          type: 'select',
          required: true,
          multiple: true,
          options: [
            { value: 'production', label: 'Produção' },
            { value: 'homologation', label: 'Homologação' },
          ],
        },
      ],
      special_title_template: 'Acesso — {ambientes}',
    },
  })
  specialSubcategoryId = specialSubcategory.id

  const lockedKey = await prisma.apiKey.create({
    data: { name: `Key travada ${SUFFIX}`, key_hash: `hash-${SUFFIX}-locked`, key_prefix: 'isakey_lock', scopes: ['create_ticket', 'update_ticket', 'close_ticket', 'create_user', 'update_user'], org_id: orgAId },
  })
  lockedKeyId = lockedKey.id

  const multiKey = await prisma.apiKey.create({
    data: { name: `Key multi ${SUFFIX}`, key_hash: `hash-${SUFFIX}-multi`, key_prefix: 'isakey_mult', scopes: ['create_ticket', 'update_ticket', 'create_user', 'update_user', 'read_categories', 'read_subcategories', 'read_queues', 'read_organizations'], org_id: null },
  })
  multiKeyId = multiKey.id
}

function lockedCtx(): ApiKeyContext {
  return { id: lockedKeyId, scopes: ['create_ticket', 'update_ticket', 'close_ticket', 'create_user', 'update_user'], org_id: orgAId }
}
function multiCtx(): ApiKeyContext {
  return { id: multiKeyId, scopes: ['create_ticket', 'update_ticket', 'create_user', 'update_user', 'read_categories', 'read_subcategories', 'read_queues', 'read_organizations'], org_id: null }
}

beforeAll(setup)

afterEach(async () => {
  await prisma.ticket.deleteMany({ where: { org_id: { in: [orgAId, orgBId] } } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${domainA}` } } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${domainB}` } } }).catch(() => undefined)
  await prisma.apiRequestLog.deleteMany({ where: { api_key_id: { in: [lockedKeyId, multiKeyId] } } }).catch(() => undefined)
})

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { id: { in: [lockedKeyId, multiKeyId] } } }).catch(() => undefined)
  await prisma.subcategory.deleteMany({ where: { id: subcategoryId } }).catch(() => undefined)
  await prisma.subcategory.deleteMany({ where: { id: specialSubcategoryId } }).catch(() => undefined)
  await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => undefined)
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe.sequential('externalApi', () => {
  describe('createTicket', () => {
    it('persiste múltiplas opções de um formulário especial como array', async () => {
      const result = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:create:special-multiple`,
        requester: { email: `special@${domainA}` },
        ticket: {
          category_id: categoryId,
          subcategory_id: specialSubcategoryId,
          special_data: { ambientes: ['production', 'homologation'] },
        },
      }, {})

      const ticket = await prisma.ticket.findUnique({ where: { id: (result.body as any).resource_id } })
      expect(ticket?.special_data).toEqual({ ambientes: ['production', 'homologation'] })
    })

    it('rejeita opção que não está configurada no formulário especial', async () => {
      await expect(createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:create:special-invalid-option`,
        requester: { email: `special-invalid@${domainA}` },
        ticket: {
          subcategory_id: specialSubcategoryId,
          special_data: { ambientes: ['production', 'development'] },
        },
      }, {})).rejects.toThrow(/Opção inválida/)
    })

    it('rejeita lista obrigatória vazia', async () => {
      await expect(createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:create:special-empty`,
        requester: { email: `special-empty@${domainA}` },
        ticket: {
          subcategory_id: specialSubcategoryId,
          special_data: { ambientes: [] },
        },
      }, {})).rejects.toThrow(/Campos obrigatórios não preenchidos/)
    })

    it('cria o chamado com categoria/subcategoria preenchidas — key travada ignora organization_id do payload', async () => {
      const result = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:create:1`,
        organization_id: orgBId, // deve ser ignorado — key travada em orgA
        requester: { email: `maria@${domainA}`, name: 'Maria' },
        ticket: { title: 'Erro no sistema', description: 'Detalhes...', category_id: categoryId, subcategory_id: subcategoryId },
      }, {})

      expect(result.statusCode).toBe(201)
      const body = result.body as any
      expect(body.duplicate).toBe(false)
      const ticket = await prisma.ticket.findUnique({ where: { id: body.resource_id } })
      expect(ticket?.org_id).toBe(orgAId)
      expect(ticket?.category_id).toBe(categoryId)
      expect(ticket?.subcategory_id).toBe(subcategoryId)
    })

    it('rejeita category_id inexistente', async () => {
      await expect(createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:create:badcat`,
        requester: { email: `joao@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição', category_id: '00000000-0000-0000-0000-000000000000' },
      }, {})).rejects.toThrow(/Categoria informada não existe/)
    })

    it('key multi-empresa resolve organização pelo domínio do e-mail quando organization_id não é enviado', async () => {
      const result = await createTicket(multiCtx(), {
        external_request_id: `${SUFFIX}:create:multi`,
        requester: { email: `ana@${domainB}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})

      const body = result.body as any
      const ticket = await prisma.ticket.findUnique({ where: { id: body.resource_id } })
      expect(ticket?.org_id).toBe(orgBId)
    })

    it('é idempotente por external_request_id — não cria duas vezes', async () => {
      const payload = {
        external_request_id: `${SUFFIX}:create:idem`,
        requester: { email: `bia@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }

      const first = await createTicket(lockedCtx(), payload, {})
      const second = await createTicket(lockedCtx(), payload, {})

      expect((first.body as any).duplicate).toBe(false)
      expect((second.body as any).duplicate).toBe(true)
      expect((second.body as any).resource_id).toBe((first.body as any).resource_id)

      const count = await prisma.ticket.count({ where: { id: (first.body as any).resource_id } })
      expect(count).toBe(1)
    })
  })

  describe('updateTicket', () => {
    it('atualiza um chamado da mesma empresa da key travada', async () => {
      const created = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:update:setup`,
        requester: { email: `carla@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (created.body as any).resource_id as string

      const result = await updateTicket(lockedCtx(), ticketId, { status: 'resolved', note: 'Resolvido via API' }, {})
      expect(result.statusCode).toBe(200)

      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
      expect(ticket?.status).toBe('resolved')
    })

    it('bloqueia key travada tentando alterar chamado de outra empresa', async () => {
      const createdInB = await createTicket(multiCtx(), {
        external_request_id: `${SUFFIX}:update:other-org`,
        organization_id: orgBId,
        requester: { email: `duda@${domainB}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (createdInB.body as any).resource_id as string

      await expect(
        updateTicket(lockedCtx(), ticketId, { status: 'resolved' }, {}),
      ).rejects.toThrow(/não encontrado/)
    })
  })

  describe('usuários', () => {
    it('cria usuário final vinculado à empresa da key travada', async () => {
      const result = await createExternalUser(lockedCtx(), {
        external_request_id: `${SUFFIX}:user:create`,
        name: 'Novo Usuário',
        email: `novo@${domainA}`,
      }, {})

      expect(result.statusCode).toBe(201)
      const user = await prisma.user.findUnique({ where: { email: `novo@${domainA}` } })
      expect(user?.role).toBe('user')
      expect(user?.org_id).toBe(orgAId)
    })

    it('atualiza usuário por e-mail', async () => {
      await createExternalUser(lockedCtx(), {
        external_request_id: `${SUFFIX}:user:update-setup`,
        name: 'Fulano',
        email: `fulano@${domainA}`,
      }, {})

      const result = await updateExternalUser(lockedCtx(), `fulano@${domainA}`, {
        external_request_id: `${SUFFIX}:user:update`,
        changes: { active: false },
      }, {})

      expect(result.statusCode).toBe(200)
      const user = await prisma.user.findUnique({ where: { email: `fulano@${domainA}` } })
      expect(user?.active).toBe(false)
    })

    it('solicitante novo de domínio liberado para SSO é criado como conta microsoft, sem senha', async () => {
      const sso = await prisma.authorizedDomain.create({ data: { domain: domainB, org_id: orgBId } })
      try {
        await createTicket(multiCtx(), {
          external_request_id: `${SUFFIX}:ticket:sso-requester`,
          requester: { email: `sso@${domainB}` },
          ticket: { title: 'Chamado SSO', description: 'Desc' },
        }, {})
        await createTicket(lockedCtx(), {
          external_request_id: `${SUFFIX}:ticket:local-requester`,
          requester: { email: `local@${domainA}` },
          ticket: { title: 'Chamado local', description: 'Desc' },
        }, {})

        const ssoUser = await prisma.user.findUnique({ where: { email: `sso@${domainB}` } })
        expect(ssoUser?.auth_provider).toBe('microsoft')
        expect(ssoUser?.password).toBeNull()
        const localUser = await prisma.user.findUnique({ where: { email: `local@${domainA}` } })
        expect(localUser?.auth_provider).toBe('local')
      } finally {
        await prisma.authorizedDomain.delete({ where: { id: sso.id } })
      }
    })
  })

  describe('leituras de referência', () => {
    it('lista categorias e subcategorias (filtrável por categoria)', async () => {
      const categories = await listCategories()
      expect(categories.some(c => c.id === categoryId)).toBe(true)

      const subcategories = await listSubcategories(categoryId)
      expect(subcategories.every(s => s.category_id === categoryId)).toBe(true)
      expect(subcategories.some(s => s.id === subcategoryId)).toBe(true)
    })

    it('lista filas', async () => {
      const queues = await listQueues()
      expect(Array.isArray(queues)).toBe(true)
    })

    it('key travada numa empresa só enxerga a própria organização em listOrganizations', async () => {
      const orgs = await listOrganizations(lockedCtx())
      expect(orgs).toHaveLength(1)
      expect(orgs[0].id).toBe(orgAId)
    })

    it('key multi-empresa enxerga organizações ativas em geral', async () => {
      const orgs = await listOrganizations(multiCtx())
      expect(orgs.some(o => o.id === orgAId)).toBe(true)
      expect(orgs.some(o => o.id === orgBId)).toBe(true)
    })
  })

  describe('leitura de chamados', () => {
    it('key travada só lista/consulta chamados da própria empresa', async () => {
      const mk = (domain: string, id: string) => createTicket(multiCtx(), {
        external_request_id: `${SUFFIX}:read:${id}`,
        requester: { email: `read-${id}@${domain}` },
        ticket: { title: `Leitura ${id}`, description: 'x', category_id: categoryId, subcategory_id: subcategoryId },
      }, {})
      const a = (await mk(domainA, 'a')).body as any
      const b = (await mk(domainB, 'b')).body as any

      const locked = await listTickets(lockedCtx(), { per_page: '100' })
      expect(locked.data.every(t => t.org?.id === orgAId)).toBe(true)
      expect(locked.data.some(t => t.id === a.resource_id)).toBe(true)
      await expect(listTickets(lockedCtx(), { organization_id: orgBId })).rejects.toMatchObject({ statusCode: 404 })

      const multi = await listTickets(multiCtx(), { organization_id: orgBId, status: 'open,in_progress' })
      expect(multi.data.map(t => t.id)).toEqual([b.resource_id])
      expect(multi.pagination.total).toBe(1)

      expect((await getTicket(lockedCtx(), a.resource_id)).id).toBe(a.resource_id)
      await expect(getTicket(lockedCtx(), b.resource_id)).rejects.toMatchObject({ statusCode: 404 })
      await expect(listTickets(multiCtx(), { status: 'bogus' })).rejects.toThrow()
    })
  })

  describe('closeTicket', () => {
    it('marca o chamado como resolvido e registra nota opcional', async () => {
      const created = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:closure:resolved-setup`,
        requester: { email: `closure-resolved@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (created.body as any).resource_id as string

      const result = await closeTicket(lockedCtx(), ticketId, {
        status: 'resolved',
        note: 'Resolvido pelo sistema externo',
        external_request_id: `${SUFFIX}:closure:resolved`,
      }, {})

      expect(result.statusCode).toBe(200)
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
      expect(ticket?.status).toBe('resolved')
    })

    it('aceita o desfecho fechado', async () => {
      const created = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:closure:closed-setup`,
        requester: { email: `closure-closed@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (created.body as any).resource_id as string

      await closeTicket(lockedCtx(), ticketId, { status: 'closed' }, {})
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
      expect(ticket?.status).toBe('closed')
    })

    it('rejeita status diferente de resolvido ou fechado', async () => {
      await expect(closeTicket(lockedCtx(), 'missing-ticket', { status: 'pending' as any }, {})).rejects.toThrow()
    })

    it('não permite encerrar chamado de outra organização', async () => {
      const created = await createTicket(multiCtx(), {
        external_request_id: `${SUFFIX}:closure:other-org`,
        organization_id: orgBId,
        requester: { email: `closure-other@${domainB}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (created.body as any).resource_id as string

      await expect(closeTicket(lockedCtx(), ticketId, { status: 'closed' }, {})).rejects.toThrow(/não encontrado/)
    })

    it('é idempotente por external_request_id', async () => {
      const created = await createTicket(lockedCtx(), {
        external_request_id: `${SUFFIX}:closure:idem-setup`,
        requester: { email: `closure-idem@${domainA}` },
        ticket: { title: 'Título', description: 'Descrição' },
      }, {})
      const ticketId = (created.body as any).resource_id as string
      const payload = { status: 'resolved' as const, external_request_id: `${SUFFIX}:closure:idem` }

      const first = await closeTicket(lockedCtx(), ticketId, payload, {})
      const second = await closeTicket(lockedCtx(), ticketId, payload, {})

      expect((first.body as any).duplicate).toBe(false)
      expect((second.body as any).duplicate).toBe(true)
    })
  })
})
