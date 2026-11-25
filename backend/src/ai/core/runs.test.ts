import { describe, it, expect, afterAll } from 'vitest'
import prisma from '../../config/prisma'
import { AiError } from './llm'
import { recordRun, shortError } from './runs'

describe('shortError', () => {
  it('erro do Prisma (começa com quebra de linha e traz o código): só a mensagem real', () => {
    const prismaMsg = '\nInvalid `prisma.ticket.findUnique()` invocation in\n/app/backend/src/ai/agents/triage/agent.ts:37:44\n\n  34 const x = 1\n→ 37   const ticket = await prisma.ticket.findUnique(\nTimed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 9)'
    expect(shortError(prismaMsg)).toBe('Timed out fetching a new connection from the connection pool')
    expect(shortError('\nInvalid `prisma.aiExample.count()` invocation:\n\n\nCan\'t reach database server at `db:5432`')).toBe('Can\'t reach database server at `db:5432`')
  })

  it('cabeçalho curto do erro, primeira linha não vazia, máx. 120, vazio = "erro desconhecido"', () => {
    expect(shortError('LLM 429: {"error":{"code":"429"}}')).toBe('LLM 429')
    expect(shortError('\n\n  Chamado não encontrado\nstack')).toBe('Chamado não encontrado')
    expect(shortError('x'.repeat(300))).toHaveLength(120)
    expect(shortError('')).toBe('erro desconhecido')
    expect(shortError(' \n \n')).toBe('erro desconhecido')
  })

  it('AiError mantém o cabeçalho curto que aparece na nota', () => {
    expect(shortError(new AiError('AI_RATE_LIMITED', 'LLM 429: {"error":{"code":"429"}}', { status: 429 }).message)).toBe('LLM 429')
    expect(shortError(new AiError('AI_TIMEOUT', 'LLM timeout: orçamento de 800 ms esgotado').message)).toBe('LLM timeout')
  })
})

describe('recordRun com AiError', () => {
  const agent = `teste-aierror-${Date.now()}`

  afterAll(async () => {
    await prisma.aiAgentRun.deleteMany({ where: { agent } })
    await prisma.$disconnect()
  })

  it('grava a mensagem do erro e não lança', async () => {
    const out = await recordRun({ agent, mode: 'shadow', model: 'm', promptVersion: 'v' }, async () => {
      throw new AiError('AI_UNAVAILABLE', 'LLM 503: indisponível', { status: 503 })
    })
    expect(out).toEqual({ result: null, error: 'LLM 503: indisponível' })
    const row = await prisma.aiAgentRun.findFirstOrThrow({ where: { agent } })
    expect(row).toMatchObject({ status: 'error', error: 'LLM 503: indisponível' })
  })
})
