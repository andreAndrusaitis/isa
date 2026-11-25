// Prisma real contra o banco de teste. Cleanup restrito aos IDs criados aqui.
// Regras de automação, auditoria e painéis pela rota: a carteira de quem pede limita
// o que ele escreve e o que ele lê; admin continua sem restrição.
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import { runRoutingRules } from '../services/routing'
import routingRoutes from './routing'
import auditRoutes from './audit'
import dashboardRoutes from './dashboard'
import surveyRoutes from './survey'
import managerLinksRoutes from './managerLinks'

const app = express()
app.use(express.json())
app.use('/api/routing', routingRoutes)
app.use('/api/audit', auditRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/survey', surveyRoutes)
app.use('/api/manager-links', managerLinksRoutes)
app.use(errorHandler)

const tag = `cart-${Date.now()}`
const ACTION = `TESTE_${tag}`
const userIds: string[] = []
const ruleIds: string[] = []
const ticketIds: string[] = []
let orgA: string, orgB: string
let admin: U, tm: U, tmDelete: U, tmOpen: U, tmEmpty: U, gerente: U, analyst: U, stranger: U, clientA: U, clientB: U
let ticketA: string, ticketB: string, ticketBNumber: string

type U = { id: string; role: string; permissions: string[] }

async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}, carteira: string[] = []): Promise<U> {
  const u = await prisma.user.create({
    data: { name: `${name} ${tag}`, email: `${name}-${tag}@t.com`, password: 'x', role: role as any, ...extra },
  })
  userIds.push(u.id)
  if (carteira.length) await prisma.userOrgScope.createMany({ data: carteira.map(org_id => ({ user_id: u.id, org_id })) })
  return { id: u.id, role, permissions: u.permissions }
}

async function makeTicket(n: string, orgId: string, userId: string, data: Record<string, unknown> = {}) {
  const id = `${tag}-${n}`
  await prisma.ticket.create({
    data: { id, display_number: `TST-${tag}-${n}`.toUpperCase(), title: `titulo ${n}`, description: `segredo ${n}`, user_id: userId, org_id: orgId, sla_deadline: new Date(Date.now() + 864e5), ...data },
  })
  ticketIds.push(id)
  return id
}

const as = (u: U) => `Bearer ${jwt.sign({ sub: u.id, role: u.role, orgId: null, permissions: u.permissions }, env.JWT_SECRET, { algorithm: 'HS256' })}`
const post = (u: U, path: string, body: object) => request(app).post(path).set('Authorization', as(u)).send(body)
const patch = (u: U, path: string, body: object) => request(app).patch(path).set('Authorization', as(u)).send(body)
const get = (u: U, path: string) => request(app).get(path).set('Authorization', as(u))

const inOrg = (id: string) => ({ field: 'organization', operator: 'equals', value: id })
const rule = (over: Record<string, unknown> = {}) => ({
  name: `R ${tag}`, priority: -500, enabled: false,
  conditions: [inOrg(orgA)], actions: [{ type: 'set_priority', value: 'high' }], ...over,
})
async function adminRule(over: Record<string, unknown> = {}) {
  const res = await post(admin, '/api/routing', rule(over))
  expect(res.status).toBe(201)
  ruleIds.push(res.body.data.id)
  return res.body.data
}

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `A ${tag}` } })).id
  orgB = (await prisma.organization.create({ data: { name: `B ${tag}`, manager_global: true } })).id
  admin = await makeUser('admin', 'admin')
  tm = await makeUser('tm', 'supervisor', {}, [orgA])
  tmDelete = await makeUser('tmdel', 'supervisor', { permissions: ['delete_tickets'] }, [orgA])
  tmOpen = await makeUser('tmopen', 'supervisor', { manager_global: true })
  tmEmpty = await makeUser('tmempty', 'supervisor')
  gerente = await makeUser('gerente', 'manager', {}, [orgA])
  analyst = await makeUser('analista', 'agent', { manager_id: gerente.id, queues: ['q'] })
  stranger = await makeUser('outro', 'agent', { queues: ['q'] }, [orgB])
  clientA = await makeUser('clia', 'user', { org_id: orgA })
  clientB = await makeUser('clib', 'user', { org_id: orgB })
  ticketA = await makeTicket('a', orgA, clientA.id, { assigned_to_id: analyst.id })
  ticketB = await makeTicket('b', orgB, clientB.id, { assigned_to_id: analyst.id })
  ticketBNumber = `TST-${tag}-b`.toUpperCase()
  await prisma.auditLog.createMany({
    data: [
      { user_id: analyst.id, action: ACTION, resource: 'TICKET', details: { ticketId: ticketA, text: 'nota de A' } },
      { user_id: analyst.id, action: ACTION, resource: 'TICKET', details: { ticketId: ticketB, text: 'nota de B' } },
      { user_id: analyst.id, action: ACTION, resource: 'AUTH', details: { via: 'equipe' } },
      { user_id: clientA.id, action: ACTION, resource: 'AUTH', details: { via: 'cliente A' } },
      { user_id: clientB.id, action: ACTION, resource: 'AUTH', details: { via: 'cliente B' } },
      { user_id: stranger.id, action: ACTION, resource: 'AUTH', details: { via: 'outra equipe' } },
      { user_id: null, action: ACTION, resource: 'AUTH', details: { via: 'sem autor' } },
    ],
  })
})

afterAll(async () => {
  // Pelo nome também: se a validação falhar, a regra "recusada" fica salva e ativa.
  await prisma.routingRule.deleteMany({ where: { OR: [{ id: { in: ruleIds } }, { name: `R ${tag}` }] } })
  await prisma.auditLog.deleteMany({ where: { action: ACTION } })
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } })
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
  await prisma.orgManagerLink.deleteMany({ where: { org_id: { in: [orgA, orgB] } } })
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  await prisma.$disconnect()
})

describe('regra de automação: ação que exige permissão', () => {
  it('Ticket Manager sem a permissão não salva "excluir chamado", nem dentro da carteira', async () => {
    const res = await post(tm, '/api/routing', rule({ actions: [{ type: 'delete_ticket', value: '' }] }))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
    expect(await prisma.routingRule.count({ where: { name: `R ${tag}` } })).toBe(0)
  })

  it('a ação no "senão" também é barrada', async () => {
    const res = await post(tm, '/api/routing', rule({ elseActions: [{ type: 'delete_ticket', value: '' }] }))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('com a permissão de excluir, salva desde que limitada à carteira', async () => {
    const data = rule({ actions: [{ type: 'delete_ticket', value: '' }] })
    const ok = await post(tmDelete, '/api/routing', data)
    expect(ok.status).toBe(201)
    ruleIds.push(ok.body.data.id)
    const global = await post(tmDelete, '/api/routing', { ...data, conditions: [{ field: 'subject_contains', operator: 'is_not_empty', value: '' }] })
    expect(global.status).toBe(403)
    expect(global.body.code).toBe('ROUTING_SCOPE_REQUIRED')
  })

  it('disparar webhook exige a área de integrações', async () => {
    const res = await post(tmOpen, '/api/routing', rule({ actions: [{ type: 'send_webhook', value: 'qualquer' }] }))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('carteira aberta dispensa a condição de empresa, mas não a permissão', async () => {
    const free = await post(tmOpen, '/api/routing', rule({ conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] }))
    expect(free.status).toBe(201)
    ruleIds.push(free.body.data.id)
    expect((await post(tmOpen, '/api/routing', rule({ actions: [{ type: 'delete_ticket', value: '' }] }))).status).toBe(403)
  })

  it('admin não tem restrição', async () => {
    await adminRule({ conditions: [{ field: 'subject_contains', operator: 'is_not_empty', value: '' }], actions: [{ type: 'delete_ticket', value: '' }] })
  })
})

describe('regra de automação: limite da carteira', () => {
  const refused = async (over: Record<string, unknown>, code = 'ROUTING_SCOPE_REQUIRED', who: () => U = () => tm) => {
    const res = await post(who(), '/api/routing', rule(over))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe(code)
  }

  it('aceita "é igual a" e "está em" dentro da carteira', async () => {
    for (const c of [inOrg(orgA), { field: 'organization', operator: 'in', value: orgA }]) {
      const res = await post(tm, '/api/routing', rule({ conditions: [c, { field: 'priority', operator: 'equals', value: 'high' }] }))
      expect(res.status).toBe(201)
      ruleIds.push(res.body.data.id)
    }
  })

  it('recusa regra sem condição de empresa', () => refused({ conditions: [{ field: 'subject_contains', operator: 'is_not_empty', value: '' }] }))
  it('recusa empresa fora da carteira', () => refused({ conditions: [inOrg(orgB)] }))
  it('recusa lista com empresa fora da carteira', () => refused({ conditions: [{ field: 'organization', operator: 'in', value: `${orgA}, ${orgB}` }] }))
  it('recusa condição negativa de empresa', () => refused({ conditions: [{ field: 'organization', operator: 'not_equals', value: orgB }] }))
  it('recusa "qualquer condição": a de empresa deixa de limitar', () => refused({ matchType: 'any', conditions: [inOrg(orgA), { field: 'priority', operator: 'equals', value: 'high' }] }))
  it('recusa "senão": ele roda nos chamados das outras empresas', () => refused({ elseActions: [{ type: 'set_priority', value: 'low' }] }, 'ROUTING_ELSE_OUT_OF_SCOPE'))
  it('sem carteira nenhuma não há empresa que limite a regra', () => refused({}, 'ROUTING_SCOPE_REQUIRED', () => tmEmpty))

  it('a regra do PoC não chega ao chamado de outra empresa', async () => {
    await refused({ enabled: true, conditions: [{ field: 'subject_contains', operator: 'is_not_empty', value: '' }], actions: [{ type: 'delete_ticket', value: '' }] }, 'PERMISSION_REQUIRED')
    await runRoutingRules(ticketB, 'ticket_created')
    expect((await prisma.ticket.findUnique({ where: { id: ticketB } }))?.deleted_at).toBeNull()
  })
})

describe('regra já salva, editada por não-admin', () => {
  const deleteAll = () => ({ conditions: [{ field: 'subject_contains', operator: 'contains', value: 'spam' }], actions: [{ type: 'delete_ticket', value: '' }] })

  it('renomear passa, com o formulário reenviando a regra inteira', async () => {
    const saved = await adminRule(deleteAll())
    const full = { name: 'Renomeada', enabled: saved.enabled, priority: saved.priority, conditions: saved.conditions, matchType: saved.matchType, actions: saved.actions, elseActions: saved.elseActions, trigger: saved.trigger, triggerHours: saved.triggerHours, stopProcessing: saved.stopProcessing }
    const res = await patch(tm, `/api/routing/${saved.id}`, full)
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Renomeada')
  })

  it('ligar, desligar e tirar ação passam', async () => {
    const saved = await adminRule({ conditions: [{ field: 'priority', operator: 'equals', value: 'high' }], actions: [{ type: 'set_priority', value: 'low' }, { type: 'stop', value: '' }] })
    expect((await patch(tm, `/api/routing/${saved.id}`, { enabled: true })).status).toBe(200)
    expect((await patch(tm, `/api/routing/${saved.id}`, { enabled: false })).status).toBe(200)
    expect((await patch(tm, `/api/routing/${saved.id}`, { actions: [{ type: 'stop', value: '' }] })).status).toBe(200)
  })

  it('reescrever as condições de quem exclui não passa, mesmo dentro da carteira', async () => {
    const saved = await adminRule(deleteAll())
    const res = await patch(tm, `/api/routing/${saved.id}`, { conditions: [inOrg(orgA)] })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('levar a exclusão para o "senão" não passa', async () => {
    const saved = await adminRule(deleteAll())
    const res = await patch(tm, `/api/routing/${saved.id}`, { actions: [{ type: 'stop', value: '' }], elseActions: saved.actions })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('trocar o gatilho reposiciona a regra e também não passa', async () => {
    const saved = await adminRule(deleteAll())
    expect((await patch(tm, `/api/routing/${saved.id}`, { trigger: 'ticket_idle', triggerHours: 1 })).status).toBe(403)
  })

  it('ação nova em regra global exige limitar à carteira', async () => {
    const saved = await adminRule({ conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] })
    const actions = [...saved.actions, { type: 'set_type', value: 'request' }]
    const refused = await patch(tm, `/api/routing/${saved.id}`, { actions })
    expect(refused.status).toBe(403)
    expect(refused.body.code).toBe('ROUTING_SCOPE_REQUIRED')
    expect((await patch(tm, `/api/routing/${saved.id}`, { actions, conditions: [...saved.conditions, inOrg(orgA)] })).status).toBe(200)
  })

  it('não troca a empresa da regra por uma de fora da carteira nem muda para "qualquer"', async () => {
    const saved = await adminRule()
    expect((await patch(tm, `/api/routing/${saved.id}`, { conditions: [inOrg(orgB)] })).status).toBe(403)
    expect((await patch(tm, `/api/routing/${saved.id}`, { matchType: 'any' })).status).toBe(403)
  })

  it('admin edita sem restrição', async () => {
    const saved = await adminRule(deleteAll())
    expect((await patch(admin, `/api/routing/${saved.id}`, { conditions: [{ field: 'priority', operator: 'equals', value: 'low' }] })).status).toBe(200)
  })
})

describe('POST /routing/test', () => {
  const test = (u: U, ticket: string) => post(u, '/api/routing/test', {
    rule: rule({ conditions: [{ field: 'description', operator: 'is_not_empty', value: '' }, { field: 'email', operator: 'contains', value: '@' }] }),
    ticket,
  })

  it('recusa chamado fora da carteira, por id e por número, sem devolver conteúdo', async () => {
    for (const ref of [ticketB, ticketBNumber]) {
      const res = await test(tm, ref)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('ORG_OUT_OF_SCOPE')
      expect(JSON.stringify(res.body)).not.toContain('segredo')
    }
  })

  it('testa chamado da carteira e, como admin, qualquer chamado', async () => {
    expect((await test(tm, ticketA)).status).toBe(200)
    const res = await test(admin, ticketB)
    expect(res.status).toBe(200)
    expect(res.body.data.conditions[0].actual).toBe('segredo b')
  })

  it('chamado inexistente segue 404', async () => {
    expect((await test(tm, 'nao-existe')).status).toBe(404)
  })
})

describe('GET /audit', () => {
  const rows = async (u: U, query = '') => (await get(u, `/api/audit?action=${ACTION}&limit=50${query}`)).body

  it('com carteira restrita vê a si, a equipe abaixo e os clientes da carteira', async () => {
    const { items, total } = await rows(gerente)
    expect(total).toBe(4)
    expect(items.map((r: any) => r.details.via ?? r.details.text).filter(Boolean).sort()).toEqual(['cliente A', 'equipe', 'nota de A'])
  })

  it('a equipe em chamado de fora da carteira aparece sem o conteúdo', async () => {
    const { items } = await rows(gerente)
    expect(JSON.stringify(items)).not.toContain('nota de B')
    expect(items.filter((r: any) => Object.keys(r.details).length === 0)).toHaveLength(1)
  })

  it('o filtro por pessoa não amplia a visão', async () => {
    expect((await rows(gerente, `&userId=${stranger.id}`)).total).toBe(0)
  })

  it('o formato da resposta não muda', async () => {
    const body = await rows(gerente)
    expect(Object.keys(body).sort()).toEqual(['currentPage', 'items', 'pages', 'total'])
    expect(body.items[0]).toEqual(expect.objectContaining({ action: ACTION, user: expect.objectContaining({ id: expect.any(String), name: expect.any(String), email: expect.any(String) }) }))
  })

  it('admin e carteira aberta veem tudo, com o conteúdo', async () => {
    for (const u of [admin, tmOpen]) {
      const { items, total } = await rows(u)
      expect(total).toBe(7)
      expect(JSON.stringify(items)).toContain('nota de B')
    }
  })
})

describe('GET /dashboard/productivity', () => {
  const activeOf = async (u: U, query = '') => {
    const res = await get(u, `/api/dashboard/productivity?period=30d${query}`)
    expect(res.status).toBe(200)
    const row = res.body.data.find((r: any) => r.analyst.id === analyst.id)
    return { row, ids: (row?.activeTickets ?? []).map((t: any) => t.id) }
  }

  it('Gerente com carteira não vê chamado nem conta de outra empresa', async () => {
    const { row, ids } = await activeOf(gerente)
    expect(ids).toEqual([ticketA])
    expect(row.active).toBe(1)
  })

  it('filtro de empresa não amplia a carteira', async () => {
    expect((await activeOf(gerente, `&orgId=${orgB}`)).ids).toEqual([])
  })

  it('admin vê os dois e pode filtrar por empresa', async () => {
    expect((await activeOf(admin)).ids.sort()).toEqual([ticketA, ticketB].sort())
    expect((await activeOf(admin, `&orgId=${orgB}`)).ids).toEqual([ticketB])
  })
})

describe('GET /survey/dashboard', () => {
  let templateId: string

  beforeAll(async () => {
    templateId = (await prisma.surveyTemplate.create({
      data: { nome: `Tpl ${tag}`, assunto_email: 'a', corpo_convite_auto: 'b', corpo_convite_macro: 'c', ativo: false },
    })).id
    for (const [n, org, user] of [['surveyb', orgB, clientB.id], ['surveya', orgA, clientA.id]] as const) {
      const ticket_id = await makeTicket(n, org, user, { status: 'closed', resolved_at: new Date() })
      await prisma.surveyInstance.create({ data: { ticket_id, template_id: templateId, link_token: `tok-${tag}-${n}`, status: 'enviada' } })
    }
  })

  afterAll(async () => {
    await prisma.surveyInstance.deleteMany({ where: { template_id: templateId } })
    await prisma.surveyTemplate.deleteMany({ where: { id: templateId } })
  })

  const dump = async (u: U, query = '') => {
    const res = await get(u, `/api/survey/dashboard${query}`)
    expect(res.status).toBe(200)
    return JSON.stringify(res.body)
  }

  it('carteira restrita vê a própria empresa e nenhuma outra', async () => {
    for (const query of ['', '?orgId=all']) {
      const body = await dump(gerente, query)
      expect(body).toContain('titulo surveya')
      expect(body).not.toContain('titulo surveyb')
    }
  })

  it('filtrar por empresa de fora da carteira não traz nada dela', async () => {
    expect(await dump(gerente, `?orgId=${orgB}`)).not.toContain('titulo surveyb')
    expect(await dump(gerente, `?orgId=${orgA},${orgB}`)).not.toContain('titulo surveyb')
  })

  it('carteira vazia não vira "todas as empresas"', async () => {
    expect(await dump(tmEmpty)).not.toContain('titulo survey')
  })

  it('o resultado não muda de formato entre carteira e admin', async () => {
    const shape = (s: string) => Object.keys(JSON.parse(s).data).sort()
    expect(shape(await dump(gerente))).toEqual(shape(await dump(admin)))
  })

  it('admin e carteira aberta seguem vendo tudo e filtrando por empresa', async () => {
    for (const u of [admin, tmOpen]) {
      const body = await dump(u)
      expect(body).toContain('titulo surveya')
      expect(body).toContain('titulo surveyb')
      expect(await dump(u, `?orgId=${orgB}`)).not.toContain('titulo surveya')
    }
  })
})

describe('GET /manager-links', () => {
  beforeAll(async () => {
    await prisma.orgManagerLink.createMany({ data: [{ org_id: orgA, manager_id: gerente.id }, { org_id: orgB, manager_id: gerente.id }] })
  })

  it('vínculos e "minhas empresas" não saem da carteira', async () => {
    const links = (await get(gerente, '/api/manager-links/orgs')).body.data
    expect(links.map((l: any) => l.org_id)).toEqual([orgA])
    const mine = (await get(gerente, '/api/manager-links/my/orgs')).body.data
    expect(mine.map((o: any) => o.id)).toEqual([orgA])
  })

  it('admin vê todos os vínculos', async () => {
    const links = (await get(admin, '/api/manager-links/orgs')).body.data.filter((l: any) => [orgA, orgB].includes(l.org_id))
    expect(links).toHaveLength(2)
  })
})
