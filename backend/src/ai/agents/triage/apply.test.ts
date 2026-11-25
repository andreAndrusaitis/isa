import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../../../config/prisma'
import { applyTriage as applyFull } from './apply'
import { THRESHOLDS, type QuestionResult, type TriageResult } from './triage'
import { wouldApply } from '../../core/choice'

// Os testes antigos olham só o que foi gravado.
const applyTriage = async (...a: Parameters<typeof applyFull>) => (await applyFull(...a)).applied

const SUFFIX = `aiapply-${Date.now()}`
let orgId: string, reqId: string, catOld: string, catNew: string, subNew: string
const tickets: string[] = []

const q = (key: QuestionResult['key'], chosen: string, chosenLabel: string, wouldApply: boolean): QuestionResult => ({
  key, options: [], probs: [], chosen, chosenLabel, probability: 0.95, margin: 0.9, roundsAgree: true,
  evidence: 'x', evidenceSource: 'texto', evidenceValid: true, confidence: wouldApply ? 0.95 : 0.5, wouldApply,
})
const result = (questions: QuestionResult[], priority: TriageResult['priority']): TriageResult =>
  ({ questions, priority, justification: '', inputTokens: 0, outputTokens: 0 })

async function newTicket(): Promise<string> {
  const id = `AIAP-${Date.now()}-${tickets.length}`
  await prisma.ticket.create({
    data: {
      id, title: 'Antivírus travou o PC', description: 'urgente', user_id: reqId, org_id: orgId, category_id: catOld,
      priority: 'medium', display_number: `INC-9${Date.now() % 100000}${tickets.length}`, sla_deadline: new Date(Date.now() + 864e5),
    },
  })
  tickets.push(id)
  return id
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  catOld = (await prisma.category.create({ data: { name: `Infra ${SUFFIX}` } })).id
  catNew = (await prisma.category.create({ data: { name: `Proteção ${SUFFIX}` } })).id
  subNew = (await prisma.subcategory.create({ data: { name: `Endpoint ${SUFFIX}`, category_id: catNew } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } })
  await prisma.subcategory.deleteMany({ where: { id: subNew } })
  await prisma.category.deleteMany({ where: { id: { in: [catOld, catNew] } } })
  await prisma.user.deleteMany({ where: { id: reqId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('applyTriage', () => {
  it('grava tipo (com troca INC→REQ), categoria, subcategoria e prioridade que passaram no limiar', async () => {
    const id = await newTicket()
    const changes = await applyTriage(id, result([
      q('type', 'request', 'Requisição', true),
      q('category', catNew, 'Proteção', true),
      q('subcategory', subNew, 'Endpoint', true),
    ], { value: 'high', confidence: 0.9, wouldApply: true }))

    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t).toMatchObject({ type: 'request', category_id: catNew, subcategory_id: subNew, priority: 'high' })
    expect(t!.display_number.startsWith('REQ-')).toBe(true)
    expect(changes.map(c => [c.field, c.from, c.to])).toEqual([['type', 'incident', 'request'], ['category', catOld, catNew], ['subcategory', null, subNew], ['priority', 'medium', 'high']])
    const ev = await prisma.ticketEvent.findFirst({ where: { ticket_id: id, note: { startsWith: 'Triagem IA aplicou' } } })
    expect(ev?.note).toContain('Prioridade: Média → Alta')
  })

  it('não mexe no que ficou abaixo do limiar nem no que já está igual', async () => {
    const id = await newTicket()
    const changes = await applyTriage(id, result([
      q('type', 'incident', 'Incidente', true),       // já é incidente
      q('category', catNew, 'Proteção', false),      // abaixo do limiar
      q('subcategory', subNew, 'Endpoint', true),     // categoria não mudou → sub não vale
    ], { value: 'high', confidence: 0.5, wouldApply: false }))
    expect(changes).toEqual([])
    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t).toMatchObject({ type: 'incident', category_id: catOld, subcategory_id: null, priority: 'medium' })
  })

  it('trocar a categoria escolhida pelo cliente exige confiança de 95%', async () => {
    const id = await newTicket()
    const cat = { ...q('category', catNew, 'Proteção', true), confidence: 0.9 }
    expect(await applyTriage(id, result([cat], { value: 'medium', confidence: 0.9, wouldApply: false }))).toEqual([])
    expect((await prisma.ticket.findUnique({ where: { id } }))!.category_id).toBe(catOld)
  })

  it('categoria/subcategoria: 95% aplica; 90% só sugere (sem motivo, o analista aplica pelo botão)', async () => {
    const at = (key: 'category' | 'subcategory', chosen: string, label: string, confidence: number) =>
      ({ ...q(key, chosen, label, true), confidence, wouldApply: wouldApply(confidence, 0.9, THRESHOLDS[key]) })
    const id = await newTicket()
    await prisma.ticket.update({ where: { id }, data: { category_id: null } })
    const low = await applyFull(id, result([at('category', catNew, 'Proteção', 0.9), at('subcategory', subNew, 'Endpoint', 0.9)],
      { value: 'medium', confidence: 0.9, wouldApply: false }))
    expect(low.applied).toEqual([])
    expect(low.suggested.map(c => [c.field, c.to, c.reason])).toEqual([['category', catNew, undefined], ['subcategory', subNew, undefined]])
    expect((await prisma.ticket.findUnique({ where: { id } }))!.category_id).toBeNull()

    const high = await applyFull(id, result([at('category', catNew, 'Proteção', 0.95), at('subcategory', subNew, 'Endpoint', 0.95)],
      { value: 'medium', confidence: 0.9, wouldApply: false }))
    expect(high.applied.map(c => c.field)).toEqual(['category', 'subcategory'])
    expect(high.suggested).toEqual([])
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ category_id: catNew, subcategory_id: subNew })
  })

  it('não troca a categoria do cliente se a subcategoria nova não for confiável', async () => {
    const id = await newTicket()
    const changes = await applyTriage(id, result([
      q('category', catNew, 'Proteção', true),
      q('subcategory', '__none__', 'Nenhuma das opções', true),
    ], { value: 'medium', confidence: 0.9, wouldApply: false }))
    expect(changes).toEqual([])
    expect((await prisma.ticket.findUnique({ where: { id } }))!.category_id).toBe(catOld)
  })

  it('preencher categoria vazia também exige subcategoria confiável (sem "Cloud / —")', async () => {
    const id = await newTicket()
    await prisma.ticket.update({ where: { id }, data: { category_id: null } })
    const noSub = await applyTriage(id, result([
      q('category', catNew, 'Proteção', true),
      q('subcategory', '__none__', 'Nenhuma das opções', true),
    ], { value: 'medium', confidence: 0.9, wouldApply: false }))
    expect(noSub).toEqual([])
    const withSub = await applyTriage(id, result([
      q('category', catNew, 'Proteção', true),
      q('subcategory', subNew, 'Endpoint', true),
    ], { value: 'medium', confidence: 0.9, wouldApply: false }))
    expect(withSub.map(c => c.field)).toEqual(['category', 'subcategory'])
  })

  it('com fields=tipo+prioridade, categoria e subcategoria viram só sugestão', async () => {
    const id = await newTicket()
    const { applied, suggested } = await applyFull(id, result([
      q('type', 'request', 'Requisição', true),
      q('category', catNew, 'Proteção', true),
      q('subcategory', subNew, 'Endpoint', true),
    ], { value: 'high', confidence: 0.9, wouldApply: true }), new Set(['type', 'priority']))

    expect(applied.map(c => c.field)).toEqual(['type', 'priority'])
    expect(suggested.map(c => [c.field, c.to])).toEqual([['category', catNew], ['subcategory', subNew]])
    const t = await prisma.ticket.findUnique({ where: { id } })
    expect(t).toMatchObject({ type: 'request', priority: 'high', category_id: catOld, subcategory_id: null })
  })

  it('"Nenhuma das opções" nunca é aplicada e texto vago não altera nada', async () => {
    const id = await newTicket()
    expect(await applyTriage(id, result([q('category', '__none__', 'Nenhuma das opções', true)], { value: 'medium', confidence: 0.9, wouldApply: false }))).toEqual([])
    const vague = { ...result([q('type', 'request', 'Requisição', true)], { value: 'high', confidence: 0.99, wouldApply: true }), lowInformation: true }
    expect(await applyTriage(id, vague)).toEqual([])
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ type: 'incident', priority: 'medium', category_id: catOld })
  })

  it('portão confiante em teste ou resposta não altera nada; comunicado automático é classificado normalmente', async () => {
    const id = await newTicket()
    const gate = (value: 'test' | 'reply' | 'automatic') => ({ value, probability: 0.97, margin: 0.95, roundsAgree: true, confidence: 0.97, wouldApply: true })
    const base = result([q('type', 'request', 'Requisição', true)], { value: 'low', confidence: 0.99, wouldApply: true })
    expect(await applyTriage(id, { ...base, gate: gate('test') })).toEqual([])
    expect(await applyTriage(id, { ...base, gate: gate('reply') })).toEqual([])
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ type: 'incident', priority: 'medium' })
    expect((await applyTriage(id, { ...base, gate: gate('automatic') })).map(c => c.field)).toEqual(['type', 'priority'])
  })

})

// O roteamento manda, a IA sugere. Regras reais, limitadas à empresa do teste.
describe('applyTriage respeita as regras de roteamento', () => {
  const rules: string[] = []
  const rule = async (trigger: string, conditions: object[], actions: object[]) => {
    const r = await prisma.routingRule.create({
      data: {
        name: `Regra ${SUFFIX} ${rules.length}`, trigger, priority: -1000 + rules.length, stop_processing: false,
        conditions: [{ field: 'organization', operator: 'equals', value: orgId }, ...conditions] as any, actions: actions as any,
      },
    })
    rules.push(r.id)
    return r
  }
  afterAll(async () => { await prisma.routingRule.deleteMany({ where: { id: { in: rules } } }) })
  const clear = async () => { await prisma.routingRule.deleteMany({ where: { id: { in: rules.splice(0) } } }) }

  it('regra de abertura que define a prioridade vence: a IA só sugere, com o motivo', async () => {
    const r = await rule('ticket_created', [{ field: 'subject_contains', operator: 'contains', value: 'Antivírus' }], [{ type: 'set_priority', value: 'medium' }])
    try {
      const id = await newTicket()
      const { applied, suggested } = await applyFull(id, result([], { value: 'high', confidence: 0.9, wouldApply: true }))
      expect(applied).toEqual([])
      expect(suggested).toMatchObject([{ field: 'priority', to: 'high', reason: `a regra "${r.name}" define Média` }])
      expect((await prisma.ticket.findUnique({ where: { id } }))!.priority).toBe('medium')
    } finally { await clear() }
  })

  it('regra de abertura que passa a valer com a categoria da IA aplica o valor dela, atribuído à regra', async () => {
    const r = await rule('ticket_created', [{ field: 'category', operator: 'equals', value: catNew }], [{ type: 'set_priority', value: 'high' }])
    try {
      const id = await newTicket()
      const { applied, suggested } = await applyFull(id, result([
        q('category', catNew, 'Proteção', true), q('subcategory', subNew, 'Endpoint', true),
      ], { value: 'low', confidence: 0.9, wouldApply: true }))
      expect(applied.find(c => c.field === 'priority')).toMatchObject({ from: 'medium', to: 'high', rule: { id: r.id, name: r.name } })
      expect(suggested).toMatchObject([{ field: 'priority', to: 'low', reason: `a regra "${r.name}" define Alta` }])
      expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ category_id: catNew, priority: 'high' })
      const ev = await prisma.ticketEvent.findFirst({ where: { ticket_id: id, routing_rule_id: r.id } })
      expect(ev?.note).toContain('reaplicada após a reclassificação da Triagem IA: Prioridade: Média → Alta')
    } finally { await clear() }
  })

  it('regra de "chamado atualizado" que reverteria a IA: a IA não grava, sem vai-e-volta', async () => {
    const r = await rule('ticket_updated', [{ field: 'priority', operator: 'equals', value: 'low' }], [{ type: 'set_priority', value: 'medium' }])
    try {
      const id = await newTicket()
      const { applied, suggested } = await applyFull(id, result([q('type', 'request', 'Requisição', true)], { value: 'low', confidence: 0.9, wouldApply: true }))
      expect(applied.map(c => c.field)).toEqual(['type'])
      expect(suggested).toMatchObject([{ field: 'priority', to: 'low', reason: `a regra "${r.name}" (chamado atualizado) definiria Média` }])
      expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ type: 'request', priority: 'medium' })
      expect(await prisma.ticketEvent.count({ where: { ticket_id: id, routing_rule_id: r.id } })).toBe(0)
    } finally { await clear() }
  })

  it('regra de abertura "categoria → tipo" vale para a categoria escolhida pela IA', async () => {
    const r = await rule('ticket_created', [{ field: 'category', operator: 'equals', value: catNew }], [{ type: 'set_type', value: 'request' }])
    try {
      const id = await newTicket()
      const { applied } = await applyFull(id, result([q('category', catNew, 'Proteção', true), q('subcategory', subNew, 'Endpoint', true)], { value: 'medium', confidence: 0.9, wouldApply: false }))
      expect(applied.find(c => c.field === 'type')).toMatchObject({ to: 'request', rule: { id: r.id } })
      const t = await prisma.ticket.findUnique({ where: { id } })
      expect(t).toMatchObject({ type: 'request', category_id: catNew })
      expect(t!.display_number.startsWith('REQ-')).toBe(true)
    } finally { await clear() }
  })

  it('regra de outra empresa não interfere', async () => {
    await prisma.routingRule.create({
      data: {
        name: `Regra ${SUFFIX} outra`, trigger: 'ticket_created', priority: -2000, stop_processing: false,
        conditions: [{ field: 'organization', operator: 'equals', value: 'outra-empresa' }] as any, actions: [{ type: 'set_priority', value: 'low' }] as any,
      },
    }).then(x => rules.push(x.id))
    try {
      const id = await newTicket()
      const { applied } = await applyFull(id, result([], { value: 'high', confidence: 0.9, wouldApply: true }))
      expect(applied).toMatchObject([{ field: 'priority', to: 'high' }])
      expect(applied[0].rule).toBeUndefined()
    } finally { await clear() }
  })
})
