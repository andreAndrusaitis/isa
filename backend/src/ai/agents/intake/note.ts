/** Textos do agente intake: mensagem ao solicitante e nota interna para o analista. */
import { GATE_LABEL } from '../../core/gate'
import { AI_SIGNATURE } from '../../core/persona'
import type { IntakeDecision, IntakeResult } from './intake'

const pct = (v: number) => `${Math.round(v * 100)}%`
const STATE: Record<string, string> = { present: 'presente', absent: 'ausente', na: 'não se aplica' }

/** Primeiro nome; nome todo em maiúsculas ou minúsculas ("JOÃO", "ana") sai só com a inicial maiúscula. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  const uniform = first === first.toUpperCase() || first === first.toLowerCase()
  return uniform ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first
}

/** Bom dia / Boa tarde / Boa noite pelo horário de Brasília. */
export function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

const MAX_TITLE = 80

export interface Recipient { name: string; displayNumber: string; title: string; now?: Date }

/** Mensagem ao solicitante: saudação, nome e chamado vêm do banco; as perguntas, de personalize.ts. */
export function publicMessage(to: Recipient, asks: string[]): string {
  const hello = greeting(to.now ?? new Date()) + (to.name ? `, ${to.name}!` : '!')
  const title = to.title.trim()
  const shown = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE)}…` : title
  return [
    `${hello} Recebemos seu chamado ${to.displayNumber}${shown ? ` — "${shown}"` : ''}.`,
    asks.length === 1 ? 'Para agilizar o atendimento, só precisamos de mais uma informação:' : 'Para agilizar o atendimento, você pode nos contar:',
    ...asks.map(a => `• ${a}`),
    '',
    'É só responder aqui no chamado. Se preferir, o atendimento segue normalmente.',
    AI_SIGNATURE,
  ].join('\n')
}

function itemLine(q: IntakeDecision): string {
  if (q.byRule) return `- ${q.label}: presente (imagem anexada)`
  const state = STATE[q.chosen] ?? q.chosen
  if (!q.wouldApply) return `- ${q.label}: incerto (${state} ${pct(q.probability)}${q.roundsAgree ? '' : ', rodadas divergiram'}), tratado como presente`
  return `- ${q.label}: ${state} (${pct(q.confidence)})`
}

export function internalNote(r: IntakeResult, mode: string): string {
  const head = '**Completude IA** —'
  if (r.skipped) return `${head} não avaliado: parece ${GATE_LABEL[r.gate]} (${pct(r.questions[0].confidence)})`
  const items = r.questions.filter(q => q.key !== 'gate')
  const labels = r.missing.map(k => items.find(q => q.key === k)?.label ?? k).join(', ')
  const asks = r.asks.map(a => `• ${a}`).join('\n')
  const lines = !r.missing.length
    ? [`${head} informações mínimas presentes`]
    : mode === 'apply'
      ? [`${head} faltam: ${labels} · perguntas enviadas ao solicitante`, `Perguntas:\n${asks}`]
      : [`${head} faltaria: ${labels} (sombra, nada enviado)`, `Perguntas que seriam enviadas:\n${asks}`]
  return [...lines, '', ...items.map(itemLine)].join('\n')
}
