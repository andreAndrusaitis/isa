import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../config/env')>()
  return { env: { ...mod.env, AI_INTAKE_MODE: 'shadow', AZURE_AI_ENDPOINT: 'https://aif.test', AZURE_AI_KEY: 'k', AZURE_AI_DEPLOYMENT: 'gpt-4.1-mini' } }
})

import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { TicketService } from '../../../services/tickets'
import { intakeTicket } from './agent'
import type { IntakeResult } from './intake'

const result = (asks: string[], extra: Partial<IntakeResult> = {}): IntakeResult => ({
  questions: [{ key: 'gate', label: 'Portão', chosen: 'user', chosenLabel: 'Relato', probability: 0.95, margin: 0.9, roundsAgree: true, confidence: 0.95, wouldApply: true }],
  gate: 'user', skipped: false, missing: asks.map((_, i) => `k${i}`), asks,
  inputTokens: 500, outputTokens: 10, promptVersion: 'intake-v1', ...extra,
})

const SUFFIX = `aiintake-${Date.now()}`
const setMode = (m: string) => { (env as any).AI_INTAKE_MODE = m }
let orgId: string, reqId: string, staffId: string, itemId: string, catId: string, specialSubId: string
const ticketIds: string[] = []
let seq = 0

async function makeTicket(userId: string, extra: Record<string, unknown> = {}) {
  const id = `AIIN-${Date.now()}-${seq++}`
  await prisma.ticket.create({
    data: {
      id, title: 'Impressora', description: 'não imprime', user_id: userId, org_id: orgId,
      display_number: `INC-${id}`, sla_deadline: new Date(Date.now() + 864e5),
      type: 'change', ...extra,
    },
  })
  ticketIds.push(id)
  return id
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: 'Maria Teste', email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  staffId = (await prisma.user.create({ data: { name: `Staff ${SUFFIX}`, email: `staff-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
  itemId = (await prisma.intakeChecklistItem.create({ data: { type: 'change', key: `teste_${SUFFIX}`, label: 'Teste', criterion: 'c', question: 'Pergunta?' } })).id
  catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
  specialSubId = (await prisma.subcategory.create({ data: { name: `Sub ${SUFFIX}`, category_id: catId, is_special: true } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
  await prisma.intakeChecklistItem.deleteMany({ where: { id: itemId } })
  await prisma.subcategory.deleteMany({ where: { id: specialSubId } })
  await prisma.category.deleteMany({ where: { id: catId } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, staffId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('intakeTicket', () => {
  it('sombra: registra a execução e só deixa nota interna', async () => {
    setMode('shadow')
    const id = await makeTicket(reqId)
    await intakeTicket(id, async () => result(['O que acontece?']))
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })
    expect(run).toMatchObject({ agent: 'intake', mode: 'shadow', status: 'ok', prompt_version: 'intake-v1', input_tokens: 500 })
    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: id } })
    expect(msgs.map(m => m.type)).toEqual(['internal'])
    expect(msgs[0].text).toContain('faltaria')
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', intake_status: null })
  })

  it('apply com falta: pergunta ao solicitante, marca incompleto e não muda o status', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    await intakeTicket(id, async () => result(['O que acontece?']))
    const pub = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'agent' } })
    expect(pub?.user_id).toBe(SYSTEM_USER_ID)
    expect(pub?.text).toMatch(new RegExp(`^(Bom dia|Boa tarde|Boa noite), Maria! Recebemos seu chamado INC-${id} — "Impressora"\\.`))
    expect(pub?.text).toContain('• O que acontece?')
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', intake_status: 'incomplete' })
  })

  it('apply com falta: transmite a atualização depois de gravar o status; sombra não transmite', async () => {
    const seen: (string | null | undefined)[] = []
    const spy = vi.spyOn(TicketService, 'broadcastTicketUpdate').mockImplementation(async (tid: string) => {
      seen.push((await prisma.ticket.findUnique({ where: { id: tid } }))?.intake_status)
    })
    try {
      setMode('apply')
      const id = await makeTicket(reqId)
      await intakeTicket(id, async () => result(['O que acontece?']))
      expect(spy).toHaveBeenCalledWith(id)
      expect(seen.at(-1)).toBe('incomplete')
      spy.mockClear()
      setMode('shadow')
      await intakeTicket(await makeTicket(reqId), async () => result(['O que acontece?']))
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('apply sem falta: marca completo e não manda mensagem pública', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    await intakeTicket(id, async () => result([]))
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'agent' } })).toBe(0)
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBe('complete')
  })

  it('apply com portão pulando: marca skipped', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    await intakeTicket(id, async () => result([], { skipped: true, gate: 'automatic' }))
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBe('skipped')
  })

  it('reusa o portão da última triagem do chamado (sem triagem, nenhum portão é passado)', async () => {
    setMode('shadow')
    const id = await makeTicket(reqId)
    const seen: unknown[] = []
    const spy = async (_e: unknown, _i: unknown, deps: { gate?: unknown }) => { seen.push(deps.gate); return result([], { skipped: true, gate: 'automatic' }) }
    await intakeTicket(id, spy)
    const gate = { value: 'automatic', probability: 0.97, margin: 0.95, roundsAgree: true, confidence: 0.97, wouldApply: true }
    await prisma.aiAgentRun.create({ data: { agent: 'triage', ticket_id: id, mode: 'apply', model: 'm', prompt_version: 'triage-v3', status: 'ok', latency_ms: 1, result: { gate } } })
    await intakeTicket(id, spy)
    expect(seen).toEqual([null, gate])
  })

  it('solicitante da equipe: não chama a LLM, só registra o motivo', async () => {
    setMode('shadow')
    const id = await makeTicket(staffId)
    const run = vi.fn()
    await intakeTicket(id, run)
    expect(run).not.toHaveBeenCalled()
    const row = await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })
    expect(row?.result).toEqual({ skipReason: 'staff' })
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id } })).toBe(0)
  })

  const skipCase = async (extra: Record<string, unknown>, userId: string, reason: string, mode = 'shadow') => {
    setMode(mode)
    const id = await makeTicket(userId, extra)
    const run = vi.fn()
    await intakeTicket(id, run)
    expect(run).not.toHaveBeenCalled()
    expect((await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } }))?.result).toEqual({ skipReason: reason })
    return id
  }

  it('aberto em nome do cliente: não chama a LLM', async () => {
    await skipCase({ created_by_id: staffId }, reqId, 'on_behalf')
  })

  it('formulário especial: não chama a LLM', async () => {
    await skipCase({ subcategory_id: specialSubId, category_id: catId }, reqId, 'special_form')
  })

  it('tipo sem itens: não chama a LLM', async () => {
    await skipCase({ type: 'problem' }, reqId, 'no_items')
  })

  it('apply com pulo determinístico marca skipped', async () => {
    const id = await skipCase({}, staffId, 'staff', 'apply')
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBe('skipped')
  })

  it('falha da IA vira linha de erro e nota curta, sem lançar', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    await expect(intakeTicket(id, async () => { throw new Error('LLM 503: indisponível') })).resolves.toBeUndefined()
    expect((await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } }))?.status).toBe('error')
    const note = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'internal' } })
    expect(note?.text).toBe('**Completude IA** — não executada: LLM 503 (o chamado segue sem alteração)')
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBeNull()
  })

  it('chamado já em atendimento: não manda a pergunta pública nem marca incompleto', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, { status: 'in_progress' })
    await intakeTicket(id, async () => result(['O que acontece?']))
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'agent' } })).toBe(0)
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBeNull()
    const n = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'internal' } })
    expect(n?.text).toContain('Pergunta não enviada: o chamado já está em atendimento.')
  })

  it('analista já respondeu: não manda a pergunta pública', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    await prisma.ticketMessage.create({ data: { ticket_id: id, user_id: staffId, type: 'agent', text: 'Olá, já vi.' } })
    await intakeTicket(id, async () => result(['O que acontece?']))
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'agent' } })).toBe(1)
    expect((await prisma.ticket.findUnique({ where: { id } }))?.intake_status).toBeNull()
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'internal' } })).toBe(1)
  })

  it('chamado apagado: não chama a LLM', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, { deleted_at: new Date() })
    const run = vi.fn()
    await intakeTicket(id, run)
    expect(run).not.toHaveBeenCalled()
  })

  it('nota interna sai mesmo se o envio da mensagem pública falhar', async () => {
    setMode('apply')
    const id = await makeTicket(reqId)
    const spy = vi.spyOn(TicketService, 'addMessage').mockRejectedValue(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(intakeTicket(id, async () => result(['O que acontece?']))).resolves.toBeUndefined()
    } finally { spy.mockRestore(); err.mockRestore() }
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'internal' } })).toBe(1)
  })

  it('modo off não faz nada', async () => {
    setMode('off')
    const id = await makeTicket(reqId)
    const run = vi.fn()
    await intakeTicket(id, run)
    expect(run).not.toHaveBeenCalled()
    expect(await prisma.aiAgentRun.count({ where: { ticket_id: id } })).toBe(0)
  })
})
