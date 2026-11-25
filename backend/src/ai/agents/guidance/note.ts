/** Textos do agente guidance: mensagens ao solicitante e nota interna para o analista. */
import { greeting } from '../intake/note'
import { GATE_LABEL, gateOf, type GateReading } from '../../core/gate'
import { AI_SIGNATURE } from '../../core/persona'
import type { DuplicateResult } from './duplicate'
import type { GuidanceResult } from './guidance'

const pct = (v: number) => `${Math.round(v * 100)}%`

export interface Recipient { name: string; now?: Date }

const hello = (to: Recipient) => greeting(to.now ?? new Date()) + (to.name ? `, ${to.name}!` : '!')

/** Orientação: só passos e links do Learn; nunca cita outro chamado (os passos já vêm limpos). */
export function guidanceMessage(to: Recipient, g: Pick<GuidanceResult, 'steps' | 'links'>): string {
  return [
    `${hello(to)} Enquanto seu chamado aguarda atendimento, estas orientações podem resolver mais rápido:`,
    // Cada passo com o "como fazer" logo abaixo, em tópicos.
    ...g.steps.flatMap((s, i) => [`${i + 1}. ${s.text}`, ...(s.how ?? []).map(h => `   • ${h}`)]),
    ...(g.links.length ? ['', 'Saiba mais na documentação oficial da Microsoft:', ...g.links.map(l => `• ${l.title}: ${l.url}`)] : []),
    '',
    'Se resolveu, use o botão "Resolveu meu problema" no chamado, no portal. Se não, o atendimento segue normalmente.',
    AI_SIGNATURE,
  ].join('\n')
}

/** Duplicidade: cita só o chamado do PRÓPRIO solicitante. */
export function duplicateMessage(to: Recipient, related: { display_number: string; title: string }): string {
  return [
    `${hello(to)} Parece que você já tem um chamado aberto sobre isso: ${related.display_number} — "${related.title.trim().slice(0, 80)}".`,
    'No portal, você pode vincular este pedido ao chamado existente ou informar que é outro problema.',
    'Se preferir, o atendimento segue normalmente.',
    AI_SIGNATURE,
  ].join('\n')
}

export function internalNote(r: { duplicate?: DuplicateResult | null; guidance?: GuidanceResult | null }, mode: string, sent: boolean): string {
  const head = '**Orientação IA** —'
  const shadow = mode === 'apply' ? '' : ' (sombra, nada enviado)'
  const d = r.duplicate
  if (d?.isDuplicate) {
    const what = mode === 'apply' ? (sent ? 'vínculo oferecido ao solicitante' : 'oferta não enviada: chamado já em atendimento') : 'ofereceria vincular'
    return `${head} possível duplicado de ${d.ticket.display_number} (${pct(d.confidence)}), ${what}${shadow}`
  }
  const g = r.guidance
  if (!g) return `${head} nada a sugerir`
  const lines: string[] = []
  if (g.steps.length) {
    const n = g.steps.length
    const steps = `${n} ${n === 1 ? 'passo' : 'passos'} de autoatendimento`
    const sentW = n === 1 ? 'enviado' : 'enviados'
    const what = mode === 'apply' ? (sent ? `${steps} ${sentW} ao solicitante` : `${steps} não ${sentW}: chamado já em atendimento`) : `${steps} ${n === 1 ? 'seria enviado' : 'seriam enviados'} (sombra, nada enviado)`
    lines.push(`${head} ${what}`, ...g.steps.map((s, i) => `${i + 1}. ${s.text} [${s.source}]`))
    if (g.links.length) lines.push(...g.links.map(l => `• ${l.url}`))
  } else {
    lines.push(`${head} sem orientação de autoatendimento`)
  }
  if (g.teamHints.length) {
    lines.push('', 'Casos parecidos foram resolvidos pela equipe assim:', ...g.teamHints.map(h => `• ${h.text} (${h.sourceDisplay}, ${pct(h.score)})`))
  }
  const used = g.cards.filter(c => g.usedCards.includes(c.id))
  if (used.length) lines.push('', `Cartões usados: ${used.map(c => `${c.ref} ${c.sourceDisplay}`).join(', ')} (👎 na caixa Orientação IA desativa um cartão)`)
  if (g.learnQuery) lines.push(`Busca no Microsoft Learn: "${g.learnQuery}" (${g.learn.length} resultado(s))`)
  return lines.join('\n')
}

/** Portão (da triagem) em comunicado automático, teste ou resposta: ninguém a orientar. */
export const gateNote = (g: GateReading) => `**Orientação IA** — não enviada: ${GATE_LABEL[gateOf(g)]} (${pct(g.confidence)})`

/** Há algo a registrar? Evita nota interna vazia em todo chamado. */
export function hasContent(r: { duplicate?: DuplicateResult | null; guidance?: GuidanceResult | null }): boolean {
  return !!(r.duplicate?.isDuplicate || r.guidance?.steps.length || r.guidance?.teamHints.length)
}
