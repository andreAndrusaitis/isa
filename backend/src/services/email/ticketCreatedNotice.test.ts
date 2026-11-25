import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findUnique, send, env } = vi.hoisted(() => ({
  findUnique: vi.fn(), send: vi.fn(), env: { NODE_ENV: 'production' as string },
}))
vi.mock('../../config/prisma', () => ({ default: { ticket: { findUnique } } }))
vi.mock('../../config/env', () => ({ env }))
vi.mock('./mailer', () => ({ sendTicketCreatedEmail: send }))

import { notifyTicketCreated } from './ticketCreatedNotice'

const requester = { id: 'u1', name: 'Ana', email: 'ana@cli.com', active: true, deleted_at: null }
const ticket = {
  id: 'ISA-1', display_number: 'INC-1', title: 'T', description: 'D', created_at: new Date(), created_by_id: null,
  deleted_at: null, user: requester, category: { name: 'Infra' },
}

describe('confirmação de abertura ao solicitante', () => {
  beforeEach(() => {
    env.NODE_ENV = 'production'
    findUnique.mockReset().mockResolvedValue(ticket)
    send.mockReset().mockResolvedValue({ status: 'SUCCESS' })
  })

  it('envia ao solicitante com número, título e categoria', async () => {
    await notifyTicketCreated('ISA-1')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ana@cli.com', ticketId: 'ISA-1', ticketNumber: 'INC-1', ticketTitle: 'T', categoryName: 'Infra', openedOnBehalf: false,
    }))
  })

  it('marca a abertura em nome do cliente', async () => {
    findUnique.mockResolvedValue({ ...ticket, created_by_id: 'agente' })
    await notifyTicketCreated('ISA-1')
    expect(send.mock.calls[0][0].openedOnBehalf).toBe(true)
  })

  it.each([
    ['sem e-mail', { ...ticket, user: { ...requester, email: '' } }],
    ['solicitante inativo', { ...ticket, user: { ...requester, active: false } }],
    ['solicitante excluído', { ...ticket, user: { ...requester, deleted_at: new Date() } }],
    ['chamado excluído', { ...ticket, deleted_at: new Date() }],
    ['usuário Sistema', { ...ticket, user: { ...requester, id: '00000000-0000-0000-0000-000000000000' } }],
  ])('não envia: %s', async (_caso, t) => {
    findUnique.mockResolvedValue(t)
    await notifyTicketCreated('ISA-1')
    expect(send).not.toHaveBeenCalled()
  })

  it('nunca envia na suíte de testes', async () => {
    env.NODE_ENV = 'test'
    await notifyTicketCreated('ISA-1')
    expect(findUnique).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
