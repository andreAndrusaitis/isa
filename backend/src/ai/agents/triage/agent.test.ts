import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../config/env')>()
  return { env: { ...mod.env, AI_TRIAGE_MODE: 'shadow', AZURE_AI_ENDPOINT: 'https://aif.test', AZURE_AI_KEY: 'k', AZURE_AI_DEPLOYMENT: 'gpt-4.1-mini' } }
})

import prisma from '../../../config/prisma'
import { triageTicket } from './agent'
import type { TriageResult } from './triage'

const SAMPLE: TriageResult = {
  questions: [{
    key: 'type', options: [], probs: [0.06, 0.94], chosen: 'request', chosenLabel: 'Requisição',
    probability: 0.94, margin: 0.88, roundsAgree: true, evidence: 'criar usuários nominais',
    evidenceSource: 'texto', evidenceValid: true, confidence: 0.94, wouldApply: true,
  }],
  priority: { value: 'low', confidence: 0.66, wouldApply: false },
  justification: 'Pedido de criação de usuários.',
  inputTokens: 1000, outputTokens: 40,
}

const SUFFIX = `aishadow-${Date.now()}`
let orgId: string, reqId: string, ticketId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  ticketId = `AI-${Date.now()}`
  await prisma.ticket.create({
    data: {
      id: ticketId, title: 'Criar usuários', description: 'Preciso criar usuários nominais', user_id: reqId, org_id: orgId,
      display_number: `INC-AI${Date.now()}`, sla_deadline: new Date(Date.now() + 864e5),
    },
  })
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: ticketId } })
  await prisma.user.deleteMany({ where: { id: reqId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('triageTicket', () => {
  it('registra a execução do agente e deixa nota interna sem alterar o chamado', async () => {
    await triageTicket(ticketId, async () => SAMPLE)

    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: ticketId, status: 'ok' } })
    expect(run).toMatchObject({ agent: 'triage', mode: 'shadow', model: 'gpt-4.1-mini', prompt_version: 'triage-v4', input_tokens: 1000, output_tokens: 40 })
    const note = await prisma.ticketMessage.findFirst({ where: { ticket_id: ticketId, type: 'internal' } })
    expect(note?.text).toContain('**Triagem IA** — Sugere: Tipo Requisição')
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(ticket).toMatchObject({ type: 'incident', priority: 'medium' })
  })

  it('chamado na Lixeira (regra de abertura excluiu): não roda nem grava', async () => {
    const deletedId = `AI-DEL-${Date.now()}`
    await prisma.ticket.create({
      data: {
        id: deletedId, title: 'RE: ok', user_id: reqId, org_id: orgId, deleted_at: new Date(),
        display_number: `INC-AID${Date.now()}`, sla_deadline: new Date(Date.now() + 864e5),
      },
    })
    try {
      await triageTicket(deletedId, async () => { throw new Error('não devia chamar a IA') })
      expect(await prisma.aiAgentRun.count({ where: { ticket_id: deletedId } })).toBe(0)
      expect(await prisma.ticket.findUnique({ where: { id: deletedId } })).toMatchObject({ type: 'incident', priority: 'medium' })
    } finally {
      await prisma.ticket.deleteMany({ where: { id: deletedId } })
    }
  })

  it('grava a versão efetiva do prompt quando a triagem usou RAG', async () => {
    await triageTicket(ticketId, async () => ({ ...SAMPLE, promptVersion: 'triage-v4-rag', ragExamples: 3 }))
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: ticketId, prompt_version: 'triage-v4-rag' } })
    expect(run?.status).toBe('ok')
  })

  it('falha da IA vira linha de erro e não lança', async () => {
    await expect(triageTicket(ticketId, async () => { throw new Error('LLM 503') })).resolves.toBeUndefined()
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: ticketId, status: 'error' } })
    expect(run?.error).toBe('LLM 503')
  })

  it('falha da IA deixa nota interna curta com o motivo', async () => {
    await triageTicket(ticketId, async () => { throw new Error('LLM 429: {"error":{"code":"429","message":"exceeded request rate limit"}}') })
    const note = await prisma.ticketMessage.findFirst({
      where: { ticket_id: ticketId, type: 'internal', text: { contains: 'não executada: LLM 429' } },
    })
    expect(note?.text).toBe('**Triagem IA** — não executada: LLM 429 (o chamado segue sem alteração)')
  })

  it('erro do Prisma com quebra de linha inicial: nota traz o motivo real', async () => {
    await triageTicket(ticketId, async () => {
      throw new Error('\nInvalid `prisma.ticket.findUnique()` invocation:\n\n\nTimed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 9)')
    })
    const note = await prisma.ticketMessage.findFirst({
      where: { ticket_id: ticketId, type: 'internal', text: { contains: 'Timed out' } },
    })
    expect(note?.text).toBe('**Triagem IA** — não executada: Timed out fetching a new connection from the connection pool (o chamado segue sem alteração)')
  })
})
