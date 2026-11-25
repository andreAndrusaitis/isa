import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

// Analista que é o próprio solicitante põe o chamado em Pendente,
// o sistema grava a nota interna de log em nome dele e o chamado voltava
// sozinho para Em atendimento ("por nova mensagem").
const SUFFIX = `pend-int-${Date.now()}`
let orgId: string
let selfId: string
const ticketIds: string[] = []

async function pendingTicket(n: number) {
  const id = `TKT-${SUFFIX}-${n}`
  ticketIds.push(id)
  await prisma.ticket.create({
    data: {
      id,
      display_number: `INC-${SUFFIX}-${n}`,
      title: 'Pendente com solicitante = responsável',
      user_id: selfId,
      assigned_to_id: selfId,
      org_id: orgId,
      queue: 'geral',
      status: 'pending',
      pending_reason: 'pending_user',
      sla_deadline: new Date(Date.now() + 86400000),
    },
  })
  return id
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `OrgPendInt ${SUFFIX}` } })
  orgId = org.id
  const self = await prisma.user.create({
    data: { name: `Self ${SUFFIX}`, email: `self-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId, queues: ['geral'] },
  })
  selfId = self.id
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: selfId } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: selfId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Pendente: nota interna do solicitante', () => {
  it('nota interna do próprio solicitante não tira o chamado de Pendente', async () => {
    const id = await pendingTicket(1)
    await TicketService.addMessage(id, selfId, 'Status alterado para "Pendente". Motivo: monitoração', 'internal')

    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t?.status).toBe('pending')
    const reverted = await prisma.ticketEvent.count({ where: { ticket_id: id, to_status: 'in_progress' } })
    expect(reverted).toBe(0)
  }, 30000)

  // A tela "Responder ao Cliente" com status Pendente grava o status e depois envia a
  // resposta (tipo 'agent'): no próprio chamado ela voltava na hora para Em atendimento.
  it('resposta de atendimento do próprio analista-solicitante não tira de Pendente', async () => {
    const id = await pendingTicket(3)
    await TicketService.addMessage(id, selfId, 'Preciso do print da tela de erro.', 'agent')

    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t?.status).toBe('pending')
    expect(t?.pending_reason).toBe('pending_user')
  }, 30000)

  it('resposta de atendimento no próprio chamado Aberto conta como atendimento', async () => {
    const id = await pendingTicket(4)
    await prisma.ticket.update({ where: { id }, data: { status: 'open', pending_reason: null } })
    await TicketService.addMessage(id, selfId, 'Já estou verificando.', 'agent')

    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t?.status).toBe('in_progress')
  }, 30000)

  it('resposta pública do solicitante continua tirando de Pendente', async () => {
    const id = await pendingTicket(2)
    await TicketService.addMessage(id, selfId, 'Segue o retorno solicitado.', 'user')

    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t?.status).toBe('in_progress')
    expect(t?.pending_reason).toBeNull()
    expect(t?.sla_paused_at).toBeNull()
  }, 30000)
})
