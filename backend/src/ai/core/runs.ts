/**
 * Registro de execução comum a todos os agentes (tabela ai_agent_runs).
 * Mede latência e tokens, grava 'ok' ou 'error' e nunca lança: um agente que
 * falha não pode derrubar o fluxo do chamado que o disparou.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { getIo } from '../../config/socket'

const ticketSelect = { select: { id: true, display_number: true, title: true } } as const

/** Avisa o Motor IA (admins) ao vivo: cada execução vira um ponto que acende no núcleo. */
function announce(run?: { id: string; agent: string; status: string; mode: string; created_at: Date; error?: string | null; ticket: unknown }) {
  if (!run) return
  getIo()?.to('role:admin').emit('ai:run', {
    id: run.id, agent: run.agent, status: run.status, mode: run.mode,
    created_at: run.created_at, error: run.error ?? null, ticket: run.ticket,
  })
}

export interface RunInfo {
  agent: string
  ticketId?: string | null
  mode: string
  model: string
  promptVersion: string
}

export interface RunOutput<T> {
  result: T; inputTokens: number; outputTokens: number
  /** Versão efetiva do prompt quando só se sabe depois de rodar (ex.: com ou sem RAG). */
  promptVersion?: string
}

/** Executa `work`, grava a linha da execução e devolve o resultado, ou o erro (result null). */
export async function recordRun<T>(
  info: RunInfo, work: () => Promise<RunOutput<T>>,
): Promise<{ result: T; error: null } | { result: null; error: string }> {
  const started = Date.now()
  const base = {
    agent: info.agent, ticket_id: info.ticketId ?? null, mode: info.mode,
    model: info.model, prompt_version: info.promptVersion,
  }
  try {
    const out = await work()
    announce(await prisma.aiAgentRun.create({
      data: {
        ...base, prompt_version: out.promptVersion ?? info.promptVersion, status: 'ok', latency_ms: Date.now() - started,
        input_tokens: out.inputTokens, output_tokens: out.outputTokens,
        result: out.result as unknown as Prisma.InputJsonValue,
      },
      include: { ticket: ticketSelect },
    }))
    return { result: out.result, error: null }
  } catch (err: any) {
    const error = String(err?.message ?? err)
    console.error(`[AI:${info.agent}] execução falhou${info.ticketId ? ` (chamado ${info.ticketId})` : ''}:`, err?.message ?? err)
    await prisma.aiAgentRun.create({
      data: { ...base, status: 'error', error: error.slice(0, 1000), latency_ms: Date.now() - started },
      include: { ticket: ticketSelect },
    }).then(announce).catch(() => {})
    return { result: null, error }
  }
}

/**
 * Motivo curto para nota/UI: só o cabeçalho do erro ("LLM 429: {...}" → "LLM 429").
 * Erro do Prisma começa com "\nInvalid `prisma.x()` invocation…" + trecho de código;
 * a mensagem real é a última linha.
 */
export function shortError(message: string): string {
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean)
  const line = (/^Invalid `[^`]+` invocation/.test(lines[0] ?? '') ? lines.at(-1) : lines[0]) ?? ''
  return line.split(/: |\. /)[0].slice(0, 120).trim() || 'erro desconhecido'
}
