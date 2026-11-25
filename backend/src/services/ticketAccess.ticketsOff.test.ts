// Chamados desligado: getTicketAccess trata a equipe como solicitante. É a regra
// central — rotas, ponte com Projetos, tempo real, notificações e responsável.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const modules = vi.hoisted(() => ({ tickets: true, projects: false, documents: false }))
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  ticketParticipant: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  queue: { findUnique: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('./moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ ...modules })) }))
vi.mock('./scope', async (orig) => ({
  ...(await orig<typeof import('./scope')>()),
  getEffectiveScope: vi.fn(async () => ({ scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false })),
}))

import { getTicketAccess, assertValidAssignee } from './ticketAccess'

const ticket = { id: 'T1', user_id: 'cliente', org_id: 'acme', queue: 'geral', assigned_to_id: 'an1' }

beforeEach(() => {
  vi.clearAllMocks()
  modules.tickets = true
  prismaMock.user.findUnique.mockResolvedValue({ name: 'Ana', role: 'agent', active: true, deleted_at: null })
})

describe('getTicketAccess com Chamados desligado', () => {
  it('com Chamados ligado a equipe vê pela carteira e pela atribuição', async () => {
    expect((await getTicketAccess(ticket, { sub: 'an2', role: 'agent' })).allowed).toBe(true)
    expect((await getTicketAccess(ticket, { sub: 'an1', role: 'agent' })).allowed).toBe(true)
  })

  it('desligado: nem carteira nem atribuição dão acesso', async () => {
    modules.tickets = false
    expect((await getTicketAccess(ticket, { sub: 'an2', role: 'manager' })).allowed).toBe(false)
    expect((await getTicketAccess(ticket, { sub: 'an1', role: 'agent' })).allowed).toBe(false)
  })

  it('desligado: o próprio chamado (aberto por ela) continua', async () => {
    modules.tickets = false
    expect(await getTicketAccess({ ...ticket, user_id: 'an2' }, { sub: 'an2', role: 'agent' })).toEqual({ allowed: true, via: 'requester' })
  })

  it('admin não depende do módulo', async () => {
    modules.tickets = false
    expect((await getTicketAccess(ticket, { sub: 'adm', role: 'admin' })).allowed).toBe(true)
  })

  it('não dá para atribuir chamado a quem está com Chamados desligado', async () => {
    modules.tickets = false
    await expect(assertValidAssignee(ticket, 'an2')).rejects.toMatchObject({ code: 'ASSIGNEE_TICKETS_OFF' })
  })
})
