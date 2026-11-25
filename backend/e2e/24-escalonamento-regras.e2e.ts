// Regras de escalonamento pela API real (backend em modo produção).
// Cenário: chamados da ACME caem na fila VIP; an3 (só Initech) é da Mesa Especializada e de
// Sistemas e NÃO tem a ACME na carteira; an1 (só ACME, filas geral+vip) atende a origem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, login, openTicket, uid, U } from './helpers'

let an1Id: string
let an3Id: string
const rules: Record<string, string> = {}

async function createRule(key: string, body: Record<string, unknown>) {
  const r = await http('POST', '/api/escalation', { token: await as('admin'), body: { name: `${key} ${uid()}`, ...body } })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  rules[key] = r.body.data.id
}

const get = async (who: keyof typeof U, id: string) => http('GET', `/api/tickets/${id}`, { token: await as(who) })
const escalate = async (who: keyof typeof U, id: string, body: Record<string, unknown>) =>
  http('POST', `/api/tickets/${id}/escalate`, { token: await as(who), body })

beforeAll(async () => {
  an1Id = (await login(U.an1)).user.id
  an3Id = (await login(U.an3)).user.id
  await createRule('transfer_fila', { type: 'transfer', target_queue_id: 'especializada' })
  await createRule('transfer_analista', { type: 'transfer', target_queue_id: 'sistemas', target_mode: 'agent_pick' })
  await createRule('conjunta', { type: 'same_ticket', target_mode: 'agent_pick', target_queue_id: 'especializada' })
  await createRule('filho', { type: 'child_ticket', target_queue_id: 'especializada', keep_origin: true, require_note: true, target_priority: 'high' })
})

afterAll(async () => {
  for (const id of Object.values(rules)) await http('DELETE', `/api/escalation/${id}`, { token: await as('admin') })
})

describe('configuração das regras', () => {
  it('valida destino conforme o tipo e devolve as opções novas', async () => {
    const semFila = await http('POST', '/api/escalation', { token: await as('admin'), body: { name: 'x', type: 'child_ticket' } })
    expect(semFila.status).toBe(400)
    const fixoSemAnalista = await http('POST', '/api/escalation', { token: await as('admin'), body: { name: 'x', type: 'transfer', target_queue_id: 'especializada', target_mode: 'agent_fixed' } })
    expect(fixoSemAnalista.status).toBe(400)
    const list = await http('GET', '/api/escalation', { token: await as('an1') })
    const filho = list.body.data.find((r: any) => r.id === rules.filho)
    expect(filho).toMatchObject({ type: 'child_ticket', target_mode: 'queue', keep_origin: true, require_note: true, target_priority: 'high', source_queue_ids: [] })
  })
})

describe('transferência', () => {
  it('chamado SEM responsável: analista da origem transfere para a fila (antes dava 403)', async () => {
    const t = await openTicket('acme1')
    expect((await get('an3', t.id)).status).toBe(403)

    expect((await get('an1', t.id)).body.data.assignedToId ?? null).toBeNull()
    const r = await escalate('an1', t.id, { ruleId: rules.transfer_fila })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.ticket.queue).toBe('especializada')

    // Aparece na fila de destino para an3, que abre sem ter a ACME na carteira.
    const list = await http('GET', '/api/tickets?page=1&pageSize=100&queueId=especializada', { token: await as('an3') })
    expect(list.body.data.map((x: any) => x.id)).toContain(t.id)
    expect((await get('an3', t.id)).status).toBe(200)
    expect((await get('an1', t.id)).status).toBe(403) // quem transferiu sai
  })

  it('transfere para um analista fora da carteira: ele vira o responsável e resolve', async () => {
    const t = await openTicket('acme1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an1'), body: { assigned_to_id: an1Id } })

    const semAnalista = await escalate('an1', t.id, { ruleId: rules.transfer_analista })
    expect(semAnalista.status).toBe(400)

    const r = await escalate('an1', t.id, { ruleId: rules.transfer_analista, targetAgentId: an3Id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.ticket).toMatchObject({ queue: 'sistemas', assignedToId: an3Id })

    const res = await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an3'), body: { status: 'resolved', resolution_details: 'Resolvido por Sistemas' } })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it('analista que vê o chamado mas não é dono nem colaborador não escalona', async () => {
    const t = await openTicket('acme1')
    const tmId = (await login(U.tm)).user.id
    const take = await http('PATCH', `/api/tickets/${t.id}`, { token: await as('tm'), body: { assigned_to_id: tmId } })
    expect(take.status, JSON.stringify(take.body)).toBe(200)
    expect((await get('an1', t.id)).status).toBe(200)
    const r = await escalate('an1', t.id, { ruleId: rules.transfer_fila })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('NOT_TICKET_OWNER')
  })
})

describe('dois analistas no mesmo chamado', () => {
  it('an1 fica responsável, o chamado vai para a Mesa e an3 (sem a ACME) atua junto', async () => {
    const t = await openTicket('acme1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an1'), body: { assigned_to_id: an1Id } })
    const r = await escalate('an1', t.id, { ruleId: rules.conjunta, targetAgentId: an3Id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)

    expect(r.body.data.movedTo).toBe('especializada')

    const seen = await get('an3', t.id)
    expect(seen.status).toBe(200)
    expect(seen.body.data).toMatchObject({ queue: 'especializada', assignedToId: an1Id })
    expect((await get('an1', t.id)).status).toBe(200) // responsável segue com acesso fora da sua fila
    const pr = await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an3'), body: { priority: 'high' } })
    expect(pr.status, JSON.stringify(pr.body)).toBe(200)
    const msg = await http('POST', `/api/tickets/${t.id}/messages`, { token: await as('an3'), body: { text: 'Atuando junto', type: 'internal' } })
    expect([200, 201]).toContain(msg.status)
  })
})

describe('chamado filho', () => {
  let parentId: string
  let childId: string

  it('exige justificativa e abre o filho vinculado na Mesa, com prioridade alta', async () => {
    const t = await openTicket('acme1')
    parentId = t.id
    await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an1'), body: { assigned_to_id: an1Id } })

    const semNota = await escalate('an1', t.id, { ruleId: rules.filho })
    expect(semNota.status).toBe(400)

    const r = await escalate('an1', t.id, { ruleId: rules.filho, note: 'Precisa de análise da Mesa' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    childId = r.body.data.childTicketId
    expect(childId).toMatch(/^ISA-\d+$/)

    const child = await get('an3', childId)
    expect(child.status).toBe(200)
    expect(child.body.data).toMatchObject({ queue: 'especializada', priority: 'high', escalated: true })
    // O pai segue com a origem.
    const parent = await get('an1', parentId)
    expect(parent.body.data).toMatchObject({ assignedToId: an1Id })
    expect(parent.body.data.queue).not.toBe('especializada')
  })

  it('pai e filho mostram o vínculo; quem escalonou acompanha o filho', async () => {
    const fp = await http('GET', `/api/tickets/${parentId}/family`, { token: await as('an1') })
    expect(fp.status).toBe(200)
    expect(fp.body.data.children.map((c: any) => c.id)).toEqual([childId])
    const fc = await http('GET', `/api/tickets/${childId}/family`, { token: await as('an3') })
    expect(fc.body.data.parent.id).toBe(parentId)
    expect((await get('an1', childId)).status).toBe(200)
  })

  it('filho resolvido avisa o pai', async () => {
    await http('PATCH', `/api/tickets/${childId}`, { token: await as('an3'), body: { assigned_to_id: an3Id } })
    const res = await http('PATCH', `/api/tickets/${childId}`, { token: await as('an3'), body: { status: 'resolved', resolution_details: 'Análise da Mesa concluída' } })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const msgs = await http('GET', `/api/tickets/${parentId}/messages`, { token: await as('an1') })
    expect((msgs.body.data as any[]).some(m => (m.text ?? '').includes(`[CHAMADO FILHO]** ${childId}`))).toBe(true)
  })
})
