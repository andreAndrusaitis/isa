import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { getPortfolio, getShift, onTimeRate, suggestPerson } from './homes'
import { getSystemHealth } from './systemHealth'
import { TicketService } from './tickets'

const H = 3_600_000
const S = `home-${Date.now()}`
const ids = { org: '', otherOrg: '', boss: '', clara: '', bruno: '', client: '', eva: '', queue: '' }

const ticket = (n: string, data: Record<string, unknown>) => prisma.ticket.create({
  data: {
    id: `${S}-${n}`, display_number: `${S}-${n}`, title: `Chamado ${n}`, user_id: ids.client, org_id: ids.org, queue: ids.queue,
    sla_deadline: new Date(Date.now() + 200 * H), ...data,
  } as any,
})

beforeAll(async () => {
  ids.org = (await prisma.organization.create({ data: { name: `Geleira ${S}` } })).id
  ids.otherOrg = (await prisma.organization.create({ data: { name: `Outra ${S}` } })).id
  ids.queue = (await prisma.queue.create({ data: { name: `Fila ${S}` } })).id
  const user = (name: string, data: Record<string, unknown>) => prisma.user.create({ data: { name, email: `${name}-${S}@t.local`, password: 'x', ...data } as any })
  ids.boss = (await user('davi', { role: 'supervisor', manager_global: true })).id
  ids.clara = (await user('clara', { role: 'agent', manager_id: ids.boss, queues: [ids.queue], manager_global: true })).id
  ids.bruno = (await user('bruno', { role: 'agent', manager_id: ids.boss, queues: [ids.queue], manager_global: true })).id
  ids.eva = (await user('eva', { role: 'supervisor' })).id
  ids.client = (await user('pedro', { role: 'user', org_id: ids.org })).id
  await ticket('late', { status: 'in_progress', assigned_to_id: ids.clara, sla_deadline: new Date(Date.now() - 5 * H) })
  await ticket('a', { status: 'open', assigned_to_id: ids.clara })
  await ticket('b', { status: 'open', assigned_to_id: ids.clara })
  await ticket('free', { status: 'open' })
  await ticket('wait', { status: 'pending', pending_reason: 'pending_user', assigned_to_id: ids.clara, sla_deadline: new Date(Date.now() - 5 * H) })
  await ticket('done', { status: 'resolved', resolved_at: new Date(Date.now() - H), sla_deadline: new Date(Date.now() + H) })
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { startsWith: S } } })
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { startsWith: S } } })
  await prisma.ticket.deleteMany({ where: { id: { startsWith: S } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.clara, ids.bruno, ids.client, ids.eva] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: ids.boss } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: ids.queue } })
  await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => {})
})

describe('no prazo por período', () => {
  const now = new Date('2026-11-24T12:00:00Z')
  const from = new Date('2026-11-01T00:00:00Z')
  const at = (d: string) => new Date(`2026-11-${d}T10:00:00Z`)
  it('sem movimento não vira 100%', () => {
    expect(onTimeRate([], from, now, now)).toEqual({ rate: null, done: 0, late: 0 })
  })
  it('conta resolvidos e o que venceu aberto; pendente fica de fora', () => {
    const r = onTimeRate([
      { status: 'closed', resolved_at: at('10'), sla_deadline: at('11') },
      { status: 'resolved', resolved_at: at('12'), sla_deadline: at('11') },
      { status: 'open', resolved_at: null, sla_deadline: at('20') },
      { status: 'pending', resolved_at: null, sla_deadline: at('20') },
      { status: 'open', resolved_at: null, sla_deadline: at('30') },
    ], from, now, now)
    expect(r).toEqual({ rate: 33, done: 1, late: 2 })
  })
})

describe('sugestão de pessoa', () => {
  const people = [
    { id: 'c', queues: ['q'], active: 9, late: 3 }, { id: 'b', queues: ['q'], active: 2, late: 1 },
    { id: 't', queues: ['q'], active: 2, late: 0 }, { id: 'x', queues: [], active: 0, late: 0 },
  ]
  it('a mais livre entre as que atendem a fila, com menos vencidos no desempate', async () => {
    expect((await suggestPerson(people, 'q'))?.id).toBe('t')
    expect((await suggestPerson(people, 'q', 't'))?.id).toBe('b')
    // Quem o servidor recusaria não é sugerido.
    expect((await suggestPerson(people, 'q', null, async p => p.id === 'c'))?.id).toBe('c')
  })
  it('ninguém na fila: sem sugestão', async () => { expect(await suggestPerson(people, 'outra')).toBeNull() })
})

describe('Turno', () => {
  it('números, decisões na ordem e carga da equipe do supervisor', async () => {
    const r = await getShift('supervisor', ids.boss)
    expect(r.people.map(p => [p.id, p.active, p.late])).toEqual([[ids.clara, 4, 1], [ids.bruno, 0, 0]])
    const mine = r.decisions.filter(d => d.org?.id === ids.org)
    expect(mine.map(d => d.number)).toEqual([`${S}-free`, `${S}-late`])
    expect(mine[0].suggestion?.id).toBe(ids.bruno)
    // Vencido com a Clara: passar ao Bruno alivia, e o cliente está sem data.
    expect(mine[1]).toMatchObject({ state: 'late', needsForecast: true, suggestion: { id: ids.bruno } })
    // Esperando cliente não conta como vencido.
    expect(r.numbers.waiting).toBeGreaterThanOrEqual(1)
    expect(r.decisions.some(d => d.number === `${S}-wait`)).toBe(false)
  })

  it('supervisor sem carteira não traz empresa alheia', async () => {
    const r = await getShift('supervisor', ids.eva)
    expect(r.decisions).toEqual([])
    expect(r.people).toEqual([])
  })
})

describe('Carteira', () => {
  it('cliente com taxa, vencidos e oito semanas', async () => {
    const r = await getPortfolio('supervisor', ids.boss)
    const c = r.clients.find(x => x.org.id === ids.org)!
    expect(c).toMatchObject({ active: 5, overdue: 1, paused: 1, done: 1, late: 1, rate: 50 })
    expect(c.weeks).toHaveLength(8)
    expect(c.weeks[7]).toBe(50)
    // Cliente sem movimento não aparece.
    expect(r.clients.some(x => x.org.id === ids.otherOrg)).toBe(false)
  })

  it('quem não tem carteira não vê clientes', async () => {
    expect((await getPortfolio('manager', ids.client)).clients).toEqual([])
  })
})

describe('nova previsão para o cliente', () => {
  it('grava, registra no histórico e não mexe no prazo do plano', async () => {
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: `${S}-late` } })
    const when = new Date(Date.now() + 6 * H)
    const r: any = await TicketService.updateTicket(`${S}-late`, ids.boss, 'supervisor', { client_forecast_at: when.toISOString() })
    expect(new Date(r.clientForecastAt).getTime()).toBe(when.getTime())
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: `${S}-late` }, include: { events: true } })
    expect(after.sla_deadline).toEqual(before.sla_deadline)
    expect(after.events.some(e => e.note?.startsWith('Nova previsão para o cliente'))).toBe(true)
    const shift = await getShift('supervisor', ids.boss)
    expect(shift.decisions.find(d => d.number === `${S}-late`)?.needsForecast).toBe(false)
  })
  it('recusa data passada e chamado encerrado', async () => {
    await expect(TicketService.updateTicket(`${S}-a`, ids.boss, 'supervisor', { client_forecast_at: new Date(0).toISOString() })).rejects.toMatchObject({ code: 'FORECAST_IN_PAST' })
    await expect(TicketService.updateTicket(`${S}-done`, ids.boss, 'supervisor', { client_forecast_at: new Date(Date.now() + H).toISOString() })).rejects.toMatchObject({ code: 'TICKET_FINISHED' })
  })
  it('analista que não é o responsável não muda', async () => {
    await expect(TicketService.updateTicket(`${S}-a`, ids.bruno, 'agent', { client_forecast_at: new Date(Date.now() + H).toISOString() })).rejects.toMatchObject({ code: 'NOT_TICKET_OWNER' })
  })
})

describe('cliente confirma que resolveu', () => {
  it('só quem abriu, só resolvido, e fecha com o registro', async () => {
    await expect(TicketService.confirmResolution(`${S}-done`, ids.bruno)).rejects.toMatchObject({ code: 'NOT_REQUESTER' })
    await expect(TicketService.confirmResolution(`${S}-a`, ids.client)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await TicketService.confirmResolution(`${S}-done`, ids.client)
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: `${S}-done` }, include: { events: true } })
    expect(t.status).toBe('closed')
    expect(t.closed_at).toBeTruthy()
    expect(t.events.some(e => e.note?.includes('confirmada pelo solicitante') && e.user_id === ids.client)).toBe(true)
  })
})

describe('Saúde', () => {
  it('cada item diz o estado e a tela que resolve; sem segredo no retorno', async () => {
    const r = await getSystemHealth()
    expect(r.checks.map(c => c.id)).toEqual(['hours', 'plans', 'queues', 'categories', 'routing', 'email', 'sso', 'ai'])
    for (const c of r.checks) { expect(['ok', 'todo', 'alert']).toContain(c.state); expect(c.detail).toBeTruthy() }
    expect(JSON.stringify(r)).not.toMatch(/apiKey|clientSecret|privateKey/)
  })
})
