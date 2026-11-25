import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { EscalationService } from './escalation'
import { TicketService } from './tickets'
import { getTicketAccess } from './ticketAccess'

// Escalonamento do tipo "transfer": o chamado sai de quem transferiu e vai, sem
// responsável, para a fila de destino; a fila de destino atua sem ter a empresa
// na carteira. Cenário real: grupo da origem pede ajuda ao grupo da Mesa Especializada.

const SUFFIX = `xfer-${Date.now()}`
const Q_ORIG = `orig-${SUFFIX}`
const Q_DEST = `dest-${SUFFIX}`
let orgId: string
let otherOrgId: string
let requesterId: string
let originId: string // analista da origem (responsável, empresa na carteira)
let destId: string // analista do destino (fila destino, empresa FORA da carteira)
let strangerId: string // analista da origem que não é o responsável
let ruleId: string
let ticketId: string

const userIds = () => [requesterId, originId, destId, strangerId]

beforeAll(async () => {
  const [org, other] = await Promise.all([
    prisma.organization.create({ data: { name: `Org ${SUFFIX}` } }),
    prisma.organization.create({ data: { name: `Outra ${SUFFIX}` } }),
  ])
  orgId = org.id
  otherOrgId = other.id
  await prisma.queue.createMany({
    data: [
      { id: Q_ORIG, name: `Diagnóstico ${SUFFIX}`, color: '#000000' },
      { id: Q_DEST, name: `Mesa ${SUFFIX}`, color: '#000000' },
    ],
  })

  const [requester, origin, dest, stranger] = await Promise.all([
    prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `Origem ${SUFFIX}`, email: `o-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_ORIG] } }),
    prisma.user.create({ data: { name: `Destino ${SUFFIX}`, email: `d-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_DEST] } }),
    prisma.user.create({ data: { name: `Outro ${SUFFIX}`, email: `s-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_ORIG] } }),
  ])
  requesterId = requester.id
  originId = origin.id
  destId = dest.id
  strangerId = stranger.id
  await prisma.userOrgScope.createMany({
    data: [
      { user_id: originId, org_id: orgId },
      { user_id: strangerId, org_id: orgId },
      { user_id: destId, org_id: otherOrgId }, // carteira configurada, mas sem a empresa do chamado
    ],
  })

  ruleId = (await EscalationService.createRule({ name: `Transferir Mesa ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST })).id

  ticketId = (await prisma.ticket.create({
    data: {
      id: `TST-${SUFFIX}`,
      display_number: `INC-TST-${SUFFIX}`,
      title: 'Chamado de teste (transferência)',
      description: 'desc',
      user_id: requesterId,
      org_id: orgId,
      assigned_to_id: originId,
      queue: Q_ORIG,
      status: 'in_progress',
      sla_deadline: new Date(Date.now() + 86400000),
    },
  })).id
})

afterAll(async () => {
  // Limpeza restrita ao que este teste criou.
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds() } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.escalationRule.deleteMany({ where: { id: ruleId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds() } } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: { in: [Q_ORIG, Q_DEST] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {})
  await prisma.$disconnect()
})

const access = async (userId: string) => {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId } })
  return getTicketAccess(t!, { sub: userId, role: 'agent' })
}

describe.sequential('EscalationService - transferência (transfer)', () => {
  it('regra de transferência exige fila de destino', async () => {
    await expect(EscalationService.createRule({ name: `Sem fila ${SUFFIX}`, type: 'transfer' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(EscalationService.updateRule(ruleId, { target_queue_id: null }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('antes da transferência a fila de destino não enxerga o chamado (empresa fora da carteira)', async () => {
    expect((await access(destId)).allowed).toBe(false)
  })

  it('analista que não é o responsável não transfere — e a flag não fica marcada', async () => {
    await expect(EscalationService.executeEscalation(ticketId, ruleId, strangerId, null, 'agent'))
      .rejects.toMatchObject({ code: 'NOT_TICKET_OWNER' })
    const t = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(t?.escalated).toBe(false)
    expect(t?.queue).toBe(Q_ORIG)
  })

  it('transfere: fila de destino, sem responsável, sem participantes, escalonado e registrado', async () => {
    // Um colaborador antigo também deve ser desvinculado.
    await prisma.ticketParticipant.create({ data: { ticket_id: ticketId, agent_id: strangerId, role: 'collaborator', added_by_id: originId } })

    const result = await EscalationService.executeEscalation(ticketId, ruleId, originId, null, 'agent')
    expect(result.type).toBe('transfer')

    const t = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(t?.queue).toBe(Q_DEST)
    expect(t?.assigned_to_id).toBeNull()
    expect(t?.escalated).toBe(true)
    expect(t?.collab_queue).toBeNull()
    expect(await prisma.ticketParticipant.count({ where: { ticket_id: ticketId, active: true } })).toBe(0)

    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: ticketId, type: 'internal' } })
    expect(msgs.some(m => m.text.includes('[ESCALONAMENTO]') && m.text.includes('Transferência'))).toBe(true)
    const notes = (await prisma.ticketEvent.findMany({ where: { ticket_id: ticketId } })).map(e => e.note ?? '')
    expect(notes.some(n => n.startsWith('Escalonamento (transferência)'))).toBe(true)
    expect(notes.some(n => n.startsWith('Alteração de fila'))).toBe(true)
    const audit = await prisma.auditLog.findFirst({ where: { user_id: originId, action: 'ESCALATE_TICKET' } })
    expect(audit).toBeTruthy()
  })

  it('quem transferiu (e o antigo colaborador) perdem o acesso', async () => {
    expect((await access(originId)).allowed).toBe(false)
    expect((await access(strangerId)).allowed).toBe(false)
  })

  it('analista da fila de destino acessa sem a empresa na carteira, assume, altera e resolve', async () => {
    expect(await access(destId)).toEqual({ allowed: true, via: 'escalated_queue' })

    const assumed = await TicketService.updateTicket(ticketId, destId, 'agent', { assigned_to_id: destId })
    expect(assumed.assignedToId ?? (assumed as any).assigned_to_id).toBe(destId)

    const changed = await TicketService.updateTicket(ticketId, destId, 'agent', { priority: 'low' })
    expect(changed.priority).toBe('low')

    await TicketService.updateTicket(ticketId, destId, 'agent', { status: 'resolved', resolution_details: 'Resolvido pela Mesa' })
    const t = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(t?.status).toBe('resolved')
    expect(t?.assigned_to_id).toBe(destId)
  })

  it('não transfere chamado resolvido nem para a fila em que já está', async () => {
    await expect(EscalationService.executeEscalation(ticketId, ruleId, destId, null, 'agent'))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'in_progress' } })
    await expect(EscalationService.executeEscalation(ticketId, ruleId, destId, null, 'agent'))
      .rejects.toThrow('já está na fila de destino')
  })

  it('admin continua somente leitura', async () => {
    await expect(EscalationService.executeEscalation(ticketId, ruleId, originId, null, 'admin'))
      .rejects.toMatchObject({ code: 'ADMIN_READ_ONLY' })
  })
})
