import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { EscalationService } from './escalation'
import { TicketService, buildTicketListWhere } from './tickets'
import { getTicketAccess, TICKET_ACCESS_SELECT } from './ticketAccess'
import { getTicketFamily } from './ticketFamily'

// Opções das regras de escalonamento: transferir chamado sem responsável,
// transferir para um analista sem a empresa na carteira, manter quem transferiu,
// justificativa obrigatória, regra restrita a filas, prioridade e chamado filho.

const SUFFIX = `escr-${Date.now()}`
const Q_ORIG = `orig-${SUFFIX}`
const Q_DEST = `dest-${SUFFIX}`
const Q_OTHER = `outra-${SUFFIX}`
let orgId: string
let otherOrgId: string
let requesterId: string
let originId: string // analista da origem (empresa na carteira, fila de origem)
let destId: string // analista da fila de destino, SEM a empresa na carteira
let outsiderId: string // analista de outra fila e outra empresa
const ruleIds: string[] = []
const ticketIds: string[] = []

const userIds = () => [requesterId, originId, destId, outsiderId]

async function newTicket(data: Partial<{ assigned_to_id: string | null; queue: string; priority: 'low' | 'medium' | 'high' }> = {}) {
  const id = `TST-${SUFFIX}-${ticketIds.length}`
  ticketIds.push(id)
  await prisma.ticket.create({
    data: {
      id,
      display_number: `INC-${id}`,
      title: `Chamado ${id}`,
      description: 'Descrição original do chamado',
      user_id: requesterId,
      org_id: orgId,
      assigned_to_id: data.assigned_to_id ?? null,
      queue: data.queue ?? Q_ORIG,
      priority: data.priority ?? 'medium',
      status: data.assigned_to_id ? 'in_progress' : 'open',
      sla_deadline: new Date(Date.now() + 86400000),
    },
  })
  return id
}

async function rule(data: Parameters<typeof EscalationService.createRule>[0]) {
  const r = await EscalationService.createRule(data)
  ruleIds.push(r.id)
  return r.id
}

async function access(ticketId: string, userId: string) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: TICKET_ACCESS_SELECT })
  return getTicketAccess(t!, { sub: userId, role: 'agent' })
}

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
      { id: Q_DEST, name: `Segurança ${SUFFIX}`, color: '#000000' },
      { id: Q_OTHER, name: `Outra ${SUFFIX}`, color: '#000000' },
    ],
  })
  const [requester, origin, dest, outsider] = await Promise.all([
    prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `Origem ${SUFFIX}`, email: `o-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_ORIG] } }),
    prisma.user.create({ data: { name: `Destino ${SUFFIX}`, email: `d-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_DEST] } }),
    prisma.user.create({ data: { name: `Fora ${SUFFIX}`, email: `f-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_OTHER] } }),
  ])
  requesterId = requester.id
  originId = origin.id
  destId = dest.id
  outsiderId = outsider.id
  await prisma.userOrgScope.createMany({
    data: [
      { user_id: originId, org_id: orgId },
      { user_id: destId, org_id: otherOrgId },
      { user_id: outsiderId, org_id: otherOrgId },
    ],
  })
})

afterAll(async () => {
  // Limpeza restrita ao que este teste criou.
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds() } } }).catch(() => {})
  const children = await prisma.ticketLink.findMany({ where: { related_id: { in: ticketIds } }, select: { ticket_id: true } })
  const all = [...ticketIds, ...children.map(c => c.ticket_id)]
  await prisma.notification.deleteMany({ where: { ticket_id: { in: all } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: all } } }).catch(() => {})
  await prisma.escalationRule.deleteMany({ where: { id: { in: ruleIds } } }).catch(() => {})
  await prisma.userOrgScope.deleteMany({ where: { user_id: { in: userIds() } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds() } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: { in: [Q_ORIG, Q_DEST, Q_OTHER] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe.sequential('regras de escalonamento — transferência', () => {
  it('transfere chamado SEM responsável (antes recusava com NOT_TICKET_OWNER)', async () => {
    const ruleId = await rule({ name: `Transferir Segurança ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST })
    const t = await newTicket()
    expect((await access(t, destId)).allowed).toBe(false)

    const r = await EscalationService.executeEscalation(t, ruleId, originId, null, 'agent')
    expect(r.type).toBe('transfer')
    const row = await prisma.ticket.findUnique({ where: { id: t } })
    expect(row?.queue).toBe(Q_DEST)
    expect(row?.assigned_to_id).toBeNull()
    expect(await access(t, destId)).toEqual({ allowed: true, via: 'escalated_queue' })

    // Aparece na lista da fila de destino para quem é da fila (sem a empresa na carteira).
    const where = buildTicketListWhere({ queueId: [Q_DEST] } as any, {}, destId)
    expect((await prisma.ticket.findMany({ where, select: { id: true } })).map(x => x.id)).toContain(t)
  })

  it('transfere para um analista escolhido na hora, mesmo fora da carteira e da fila', async () => {
    const ruleId = await rule({ name: `Transferir p/ analista ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST, target_mode: 'agent_pick' })
    const t = await newTicket({ assigned_to_id: originId })

    await expect(EscalationService.executeEscalation(t, ruleId, originId, null, 'agent'))
      .rejects.toThrow('Escolha o analista')

    await EscalationService.executeEscalation(t, ruleId, originId, outsiderId, 'agent')
    const row = await prisma.ticket.findUnique({ where: { id: t } })
    expect(row?.queue).toBe(Q_DEST)
    expect(row?.assigned_to_id).toBe(outsiderId)
    expect(await access(t, outsiderId)).toEqual({ allowed: true, via: 'assigned' })
    expect((await access(t, originId)).allowed).toBe(false)

    // Atua e resolve normalmente.
    await TicketService.updateTicket(t, outsiderId, 'agent', { status: 'resolved', resolution_details: 'Resolvido pelo analista de destino' })
    expect((await prisma.ticket.findUnique({ where: { id: t } }))?.status).toBe('resolved')
  })

  it('mantém quem transferiu como colaborador quando a regra pede', async () => {
    const ruleId = await rule({ name: `Transferir acompanhando ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST, keep_origin: true })
    const t = await newTicket({ assigned_to_id: originId })
    const r = await EscalationService.executeEscalation(t, ruleId, originId, null, 'agent')
    expect(r.keptOrigin).toBe(true)
    expect(await access(t, originId)).toEqual({ allowed: true, via: 'collaborator' })
    const p = await prisma.ticketParticipant.findUnique({ where: { ticket_id_agent_id: { ticket_id: t, agent_id: originId } } })
    expect(p).toMatchObject({ role: 'collaborator', active: true })
  })

  it('analista fixo + prioridade da regra', async () => {
    await expect(rule({ name: `Fixo sem analista ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST, target_mode: 'agent_fixed' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const ruleId = await rule({ name: `Fixo ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST, target_mode: 'agent_fixed', target_agent_id: destId, target_priority: 'high' })
    const t = await newTicket({ assigned_to_id: originId, priority: 'low' })
    await EscalationService.executeEscalation(t, ruleId, originId, null, 'agent')
    const row = await prisma.ticket.findUnique({ where: { id: t } })
    expect(row).toMatchObject({ queue: Q_DEST, assigned_to_id: destId, priority: 'high' })
  })

  it('justificativa obrigatória e regra restrita às filas de origem', async () => {
    const ruleId = await rule({ name: `Com justificativa ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST, require_note: true, source_queue_ids: [Q_ORIG] })
    const t = await newTicket({ assigned_to_id: originId })
    await expect(EscalationService.executeEscalation(t, ruleId, originId, null, 'agent'))
      .rejects.toMatchObject({ code: 'ESCALATION_NOTE_REQUIRED' })
    await EscalationService.executeEscalation(t, ruleId, originId, null, 'agent', { note: 'Suspeita de phishing confirmada' })
    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: t, type: 'internal' } })
    expect(msgs.some(m => m.text.includes('Suspeita de phishing confirmada'))).toBe(true)

    const elsewhere = await newTicket({ assigned_to_id: outsiderId, queue: Q_OTHER })
    await expect(EscalationService.executeEscalation(elsewhere, ruleId, outsiderId, null, 'agent', { note: 'qualquer coisa' }))
      .rejects.toMatchObject({ code: 'RULE_NOT_FOR_QUEUE' })
  })

  it('analista que não é o responsável nem colaborador não escalona chamado com dono', async () => {
    const ruleId = await rule({ name: `Bloqueio ${SUFFIX}`, type: 'transfer', target_queue_id: Q_DEST })
    const t = await newTicket({ assigned_to_id: outsiderId })
    await expect(EscalationService.executeEscalation(t, ruleId, originId, null, 'agent'))
      .rejects.toMatchObject({ code: 'NOT_TICKET_OWNER' })
    expect((await prisma.ticket.findUnique({ where: { id: t } }))?.escalated).toBe(false)
  })
})

describe.sequential('regras de escalonamento — dois analistas e chamado filho', () => {
  it('atuação conjunta exige a fila para onde o chamado vai', async () => {
    await expect(rule({ name: `Conjunta sem fila ${SUFFIX}`, type: 'same_ticket', target_mode: 'agent_pick' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('atuação conjunta move para a fila da regra; o responsável fica e o analista fora da carteira atua junto', async () => {
    const ruleId = await rule({ name: `Conjunta ${SUFFIX}`, type: 'same_ticket', target_mode: 'agent_pick', target_queue_id: Q_DEST })
    const t = await newTicket({ assigned_to_id: originId })
    const r = await EscalationService.executeEscalation(t, ruleId, originId, outsiderId, 'agent')
    expect(r.movedTo).toBe(Q_DEST)
    expect(await access(t, outsiderId)).toEqual({ allowed: true, via: 'collaborator' })
    const row = await prisma.ticket.findUnique({ where: { id: t } })
    expect(row).toMatchObject({ queue: Q_DEST, assigned_to_id: originId })
    expect(await access(t, originId)).toEqual({ allowed: true, via: 'assigned' })
    expect(await access(t, destId)).toEqual({ allowed: true, via: 'escalated_queue' })
    const changed = await TicketService.updateTicket(t, outsiderId, 'agent', { priority: 'high' })
    expect(changed.priority).toBe('high')
  })

  it('atuação conjunta via fila: o chamado vai para a fila e qualquer analista dela atua junto', async () => {
    const ruleId = await rule({ name: `Conjunta fila ${SUFFIX}`, type: 'same_ticket', target_queue_id: Q_DEST })
    const t = await newTicket({ assigned_to_id: originId })
    await EscalationService.executeEscalation(t, ruleId, originId, null, 'agent')
    expect(await prisma.ticket.findUnique({ where: { id: t } })).toMatchObject({ queue: Q_DEST, collab_queue: Q_DEST, assigned_to_id: originId })
    const where = buildTicketListWhere({ queueId: [Q_DEST] } as any, {}, destId)
    expect((await prisma.ticket.findMany({ where, select: { id: true } })).map(x => x.id)).toContain(t)
    expect(await access(t, destId)).toEqual({ allowed: true, via: 'collab_queue' })
  })

  it('atuação conjunta em chamado sem responsável: quem escalonou segue no chamado', async () => {
    const ruleId = await rule({ name: `Conjunta sem dono ${SUFFIX}`, type: 'same_ticket', target_mode: 'agent_pick', target_queue_id: Q_DEST })
    const t = await newTicket()
    await EscalationService.executeEscalation(t, ruleId, originId, destId, 'agent')
    expect(await prisma.ticket.findUnique({ where: { id: t } })).toMatchObject({ queue: Q_DEST, assigned_to_id: null })
    expect(await access(t, originId)).toEqual({ allowed: true, via: 'collaborator' })
    expect(await access(t, destId)).toMatchObject({ allowed: true })
  })

  it('chamado filho: abre vinculado na fila de destino, o pai segue com a origem', async () => {
    const ruleId = await rule({ name: `Filho Segurança ${SUFFIX}`, type: 'child_ticket', target_queue_id: Q_DEST, keep_origin: true })
    const parent = await newTicket({ assigned_to_id: originId })
    const r = await EscalationService.executeEscalation(parent, ruleId, originId, null, 'agent', { note: 'Precisa de análise forense' })
    expect(r.type).toBe('child_ticket')
    const childId = r.childTicketId as string
    expect(childId).toMatch(/^ISA-\d+$/)

    const [p, c] = await Promise.all([
      prisma.ticket.findUnique({ where: { id: parent } }),
      prisma.ticket.findUnique({ where: { id: childId } }),
    ])
    expect(p).toMatchObject({ queue: Q_ORIG, assigned_to_id: originId })
    expect(c).toMatchObject({ queue: Q_DEST, assigned_to_id: null, escalated: true, user_id: requesterId, org_id: orgId, created_by_id: originId })
    expect(c?.description).toContain(`Chamado filho de ${parent}`)
    expect(c?.description).toContain('Precisa de análise forense')

    // Fila de destino atua no filho sem a empresa; quem escalonou acompanha o filho.
    expect(await access(childId, destId)).toEqual({ allowed: true, via: 'escalated_queue' })
    expect(await access(childId, originId)).toMatchObject({ allowed: true })

    const fam = await getTicketFamily(parent)
    expect(fam.children.map(x => x.id)).toEqual([childId])
    expect((await getTicketFamily(childId)).parent?.id).toBe(parent)

    // Filho resolvido avisa o pai.
    await TicketService.updateTicket(childId, destId, 'agent', { assigned_to_id: destId })
    await TicketService.updateTicket(childId, destId, 'agent', { status: 'resolved', resolution_details: 'Análise forense concluída' })
    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: parent, type: 'internal' } })
    expect(msgs.some(m => m.text.includes(`[CHAMADO FILHO]** ${childId}`) && m.text.includes('Todos os chamados filhos foram concluídos'))).toBe(true)
  })
})
