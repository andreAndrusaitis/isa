/**
 * Métricas de atendimento por canal de origem — linha de base para
 * comparar o efeito de cada canal novo (aba do Teams, bot, Copilot).
 *
 * Definições (provisórias; "resolvido no 1º contato" a confirmar com a operação):
 *  - Tempo de abertura: segundos entre abrir o formulário do portal e enviar.
 *    Só o portal mede; nos outros canais fica em branco.
 *  - 1º contato: chamado resolvido/encerrado com no máximo 1 resposta pública da
 *    equipe e sem reabertura, sobre os resolvidos/encerrados do canal.
 *  - 1ª resposta: horas úteis (calendário do SLA) da abertura até a 1ª resposta
 *    pública da equipe; mensagens automáticas do sistema não contam.
 *  - CSAT: índice 0–100 das notas numéricas da pesquisa, normalizadas pela
 *    escala de cada pergunta (mesma regra do painel de Pesquisa de Satisfação).
 * Só números agregados: nenhum dado pessoal sai do relatório (LGPD).
 */
import prisma from '../config/prisma'
import { getEffectiveScope, scopeTicketWhere } from './scope'
import { getBusinessHoursConfig } from './businessHours'
import { getBusinessMinutesBetween, holidaysAround } from '../utils/businessHours'
import { SYSTEM_USER_ID } from '../utils/constants'

export const CHANNELS = ['portal', 'email', 'api', 'teams', 'copilot'] as const
export type ChannelKey = (typeof CHANNELS)[number] | 'unknown'

export type ChannelRow = {
  channel: string | null
  status: string
  isReopened: boolean
  openingSeconds: number | null
  createdAt: Date
  firstAgentReplyAt: Date | null
  agentReplies: number
  csat: number | null
}

export type ChannelMetrics = {
  channel: ChannelKey
  tickets: number
  avgOpeningSeconds: number | null
  resolved: number
  firstContactRate: number | null
  avgFirstResponseHours: number | null
  responded: number
  csat: number | null
  csatResponses: number
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)

/** Agrega por canal; canais sem chamado no período não aparecem. */
export function summarizeChannels(rows: ChannelRow[], minutesBetween: (a: Date, b: Date) => number): ChannelMetrics[] {
  const groups = new Map<ChannelKey, ChannelRow[]>()
  for (const r of rows) {
    const key = (CHANNELS as readonly string[]).includes(r.channel ?? '') ? (r.channel as ChannelKey) : 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const order: ChannelKey[] = [...CHANNELS, 'unknown']
  return order.filter((k) => groups.has(k)).map((channel) => {
    const g = groups.get(channel)!
    const resolved = g.filter((r) => r.status === 'resolved' || r.status === 'closed')
    const firstContact = resolved.filter((r) => r.agentReplies <= 1 && !r.isReopened)
    const replied = g.filter((r) => r.firstAgentReplyAt)
    const rated = g.filter((r) => r.csat != null)
    return {
      channel,
      tickets: g.length,
      avgOpeningSeconds: round1(avg(g.flatMap((r) => (r.openingSeconds == null ? [] : [r.openingSeconds])))),
      resolved: resolved.length,
      firstContactRate: resolved.length ? Math.round((firstContact.length / resolved.length) * 100) : null,
      avgFirstResponseHours: round1(avg(replied.map((r) => minutesBetween(r.createdAt, r.firstAgentReplyAt!) / 60))),
      responded: replied.length,
      csat: round1(avg(rated.map((r) => r.csat!))),
      csatResponses: rated.length,
    }
  })
}

/** Nota 0–100 de uma resposta de pesquisa: média das notas numéricas normalizadas pela escala. */
export function surveyScore(answers: Array<{ valor_numero: number | null; question: { opcoes: Array<{ valor: string }> } }>): number | null {
  const scores = answers.flatMap((a) => {
    if (typeof a.valor_numero !== 'number') return []
    const scale = a.question.opcoes.map((o) => Number(o.valor)).filter((v) => Number.isFinite(v))
    const min = scale.length ? Math.min(...scale) : 0
    const max = scale.length ? Math.max(...scale) : 10
    return max > min ? [((a.valor_numero - min) / (max - min)) * 100] : []
  })
  return avg(scores)
}

export async function getChannelMetrics(role: string, userId: string, period: { from: Date; to: Date }) {
  // Resolvido pela IA não teve atendimento: contaria como resolvido no 1º contato pela equipe.
  const where: any = { deleted_at: null, ai_resolved: false, created_at: { gte: period.from, lte: period.to } }
  if (role !== 'admin') {
    // Mesma carteira da lista de chamados e dos outros painéis.
    const byScope = scopeTicketWhere(await getEffectiveScope(userId, role))
    if (byScope.AND) where.AND = byScope.AND
  }
  const tickets = await prisma.ticket.findMany({
    where,
    select: { id: true, channel: true, status: true, is_reopened: true, opening_seconds: true, created_at: true },
  })
  const ids = tickets.map((t) => t.id)
  const [replies, surveys, cfg] = await Promise.all([
    ids.length
      ? prisma.ticketMessage.groupBy({
          by: ['ticket_id'],
          where: { ticket_id: { in: ids }, type: 'agent', user_id: { notIn: [SYSTEM_USER_ID, 'system'] } },
          _min: { created_at: true },
          _count: { _all: true },
        })
      : [],
    ids.length
      ? prisma.surveyInstance.findMany({
          where: { ticket_id: { in: ids }, response: { isNot: null } },
          select: { ticket_id: true, response: { select: { answers: { select: { valor_numero: true, question: { select: { opcoes: { select: { valor: true } } } } } } } } },
        })
      : [],
    getBusinessHoursConfig(),
  ])
  const replyBy = new Map(replies.map((r) => [r.ticket_id, r]))
  const csatBy = new Map(surveys.map((s) => [s.ticket_id, s.response ? surveyScore(s.response.answers) : null]))
  const holidays = holidaysAround(period.from)
  const minutesBetween = (a: Date, b: Date) => getBusinessMinutesBetween(a, b, cfg, holidays)

  const rows: ChannelRow[] = tickets.map((t) => ({
    channel: t.channel,
    status: t.status,
    isReopened: t.is_reopened,
    openingSeconds: t.opening_seconds,
    createdAt: t.created_at,
    firstAgentReplyAt: replyBy.get(t.id)?._min.created_at ?? null,
    agentReplies: replyBy.get(t.id)?._count._all ?? 0,
    csat: csatBy.get(t.id) ?? null,
  }))
  return { from: period.from.toISOString(), to: period.to.toISOString(), channels: summarizeChannels(rows, minutesBetween) }
}
