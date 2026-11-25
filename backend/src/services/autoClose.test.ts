import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { getAutoCloseConfig, upsertAutoCloseConfig, runAutoCloseJob, getAutoCloseLogs } from './autoClose'

const SUFFIX = `autoclose-${Date.now()}`
let orgId: string, reqId: string
const [idle, answered] = [`AC-${SUFFIX}`, `AB-${SUFFIX}`]
const DAY = 86400000
let original: { enabled: boolean; inactive_days: number }

beforeAll(async () => {
  const cfg = await getAutoCloseConfig()
  original = { enabled: cfg.enabled, inactive_days: cfg.inactive_days }
  await upsertAutoCloseConfig({ enabled: true, inactive_days: 3 })

  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  reqId = req.id
  const old = new Date(Date.now() - 5 * DAY)
  for (const id of [idle, answered]) {
    await prisma.ticket.create({ data: { id, display_number: `INC-${id}`, title: `t ${id}`, description: 'd', user_id: reqId, org_id: orgId, status: 'resolved', resolved_at: old, sla_deadline: old } })
    await prisma.ticket.update({ where: { id }, data: { updated_at: old } })
  }
  // Cliente respondeu dentro do período: não pode fechar.
  await prisma.ticketMessage.create({ data: { ticket_id: answered, user_id: reqId, type: 'user', text: 'ainda com problema', created_at: new Date(Date.now() - DAY) } })
  await prisma.ticket.update({ where: { id: answered }, data: { updated_at: old } })
})

afterAll(async () => {
  await upsertAutoCloseConfig(original)
  await prisma.ticket.deleteMany({ where: { id: { in: [idle, answered] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: reqId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Fechamento automático', () => {
  it('desativado não fecha nada', async () => {
    await upsertAutoCloseConfig({ enabled: false })
    expect(await runAutoCloseJob()).toEqual({ checked: 0, closed: 0 })
    expect((await prisma.ticket.findUnique({ where: { id: idle } }))!.status).toBe('resolved')
    await upsertAutoCloseConfig({ enabled: true })
  })

  it('fecha o resolvido inativo, poupa o que teve resposta do cliente e registra log', async () => {
    await runAutoCloseJob()
    expect((await prisma.ticket.findUnique({ where: { id: idle } }))!.status).toBe('closed')
    expect((await prisma.ticket.findUnique({ where: { id: answered } }))!.status).toBe('resolved')

    const { items } = await getAutoCloseLogs({ page: 1, limit: 10, ticketId: SUFFIX })
    expect(items.map(l => l.ticket_id)).toEqual([idle])
    expect(items[0].inactive_days).toBe(3)
    expect(items[0].ticket.title).toBe(`t ${idle}`)
  })
})

describe('Histórico do fechamento automático', () => {
  it('respeita a carteira de quem consulta', async () => {
    await upsertAutoCloseConfig({ enabled: true, inactive_days: 3 })
    await runAutoCloseJob()
    const outsideOrg = await prisma.organization.create({ data: { name: `Fora ${SUFFIX}` } })
    const outsider = await prisma.user.create({
      data: { name: `TM ${SUFFIX}`, email: `tm-${SUFFIX}@t.com`, password: 'x', role: 'supervisor', org_scopes: { create: { org_id: outsideOrg.id } } },
    })
    try {
      const params = { page: 1, limit: 10, ticketId: SUFFIX }
      expect((await getAutoCloseLogs(params, { sub: outsider.id, role: 'supervisor' })).total).toBe(0)
      expect((await getAutoCloseLogs(params, { sub: 'admin', role: 'admin' })).total).toBeGreaterThan(0)
    } finally {
      await prisma.user.delete({ where: { id: outsider.id } })
      await prisma.organization.delete({ where: { id: outsideOrg.id } })
    }
  })
})
