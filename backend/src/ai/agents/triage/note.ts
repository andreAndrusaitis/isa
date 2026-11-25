/**
 * Nota interna da triagem, para o analista ler. A tela de chamados entende
 * **negrito** (frontend utils/linkify richText); o resto é texto simples.
 * Curta de propósito: o que mudou, o que é sugestão e o que precisa de revisão.
 */
import { heldByGate, type QuestionResult, type TriageResult } from './triage'
import { GATE_LABEL, gateOf } from '../../core/gate'
import { PROMPT_VERSION } from './prompt'
import { describeChange, type FieldChange } from './apply'
import { NONE_VALUE } from './options'

const LABEL: Record<string, string> = {
  type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', urgency: 'Urgência', impact: 'Impacto',
}
const PRIORITY_LABEL = { low: 'Baixa', medium: 'Média', high: 'Alta' } as const
// "0%" para 0,3% confunde (parece que a IA não considerou a opção): abaixo de 0,5% vira "<1%".
const pct = (n: number) => (n > 0 && n < 0.005 ? '<1%' : `${Math.round(n * 100)}%`)

/**
 * Motivo para revisar, ou null se o campo é confiável. Categoria e subcategoria só são
 * gravadas juntas (apply.ts): uma confiável pode ficar de fora por causa da outra.
 */
function reviewReason(q: QuestionResult, all: QuestionResult[]): string | null {
  const sub = all.find(x => x.key === 'subcategory')
  const cat = all.find(x => x.key === 'category')
  if (q.key === 'category' && q.wouldApply && sub) {
    if (sub.chosen === NONE_VALUE) return 'nenhuma subcategoria encaixa'
    if (!sub.wouldApply) return 'subcategoria incerta'
  }
  if (q.key === 'subcategory' && q.wouldApply && q.chosen !== NONE_VALUE && cat && !cat.wouldApply) return 'categoria incerta'
  if (q.wouldApply) return null
  if (!q.roundsAgree) return 'rodadas divergiram'
  if (!q.evidenceValid) return 'sem evidência no texto'
  return pct(q.confidence)
}

const MAX_LINE1 = 120

/** Primeira linha: só valores novos ("de X →" fica nos detalhes) e, se couber, os campos a revisar. */
function header(r: TriageResult, reviewFields: string[]): string {
  if (r.applyError) return '**Triagem IA** — falha ao gravar, nada foi alterado'
  // "Tipo Incidente · Categoria Rede › Wi-Fi · Prioridade Alta": campo + valor novo, sem o nº do chamado do tipo.
  const values = (cs: FieldChange[]) => {
    const to = (c: FieldChange) => (c.field === 'type' ? c.toLabel.replace(/ \(.*\)$/, '') : c.toLabel)
    const cat = cs.find(c => c.field === 'category')
    const sub = cs.find(c => c.field === 'subcategory')
    return cs
      .filter(c => !(cat && c === sub))
      .map(c => `${c.label} ${to(c)}${c === cat && sub ? ` › ${to(sub)}` : ''}`)
      .join(' · ')
  }
  if (r.lowInformation) return '**Triagem IA** — texto curto demais, nada aplicado'
  const held = heldByGate(r)
  if (held) return `**Triagem IA** — ${held === 'test' ? 'parece teste' : 'resposta/agradecimento'}, nada aplicado`
  const parts = [
    ...(r.applied?.length ? [`Aplicou: ${values(r.applied)}`] : []),
    ...(r.proposed?.length ? [`Sugere: ${values(r.proposed)}`] : []),
  ]
  const base = `**Triagem IA** — ${parts.length ? parts.join(' | ') : r.applied ? 'sem alterações' : 'sem alterações (modo sombra)'}`
  const withReview = reviewFields.length ? `${base} | Revisar: ${reviewFields.join(', ')}` : base
  return withReview.length <= MAX_LINE1 ? withReview : base
}

const line = (label: string, items: string[]) => (items.length ? [`**${label}:** ${items.join('; ')}`] : [])

export function formatNote(r: TriageResult, model: string, userCategory: string | null): string {
  const suggested = r.proposed ?? []
  const suggestedFields = new Set<string>(suggested.map(c => c.field))
  const review: string[] = []
  const reviewFields: string[] = []
  r.questions
    .filter(q => !suggestedFields.has(q.key))
    .forEach(q => {
      const why = reviewReason(q, r.questions)
      if (why) { review.push(`${LABEL[q.key]} ${q.chosenLabel} (${why})`); reviewFields.push(LABEL[q.key]) }
    })
  if (!r.priority.wouldApply) {
    const conf = r.priority.confidence ? ` (${pct(r.priority.confidence)})` : ''
    review.push(`Prioridade ${PRIORITY_LABEL[r.priority.value]}${conf}`)
    reviewFields.push('Prioridade')
  }
  return [
    header(r, reviewFields),
    ...(r.applyError ? [`**Erro:** ${r.applyError}`] : []),
    ...line('Aplicado', (r.applied ?? []).map(describeChange)),
    ...line('Sugerido', suggested.map(describeChange)),
    ...line('Revisar', review),
    ...(gateOf(r.gate) !== 'user' ? [`**Portão:** parece ${GATE_LABEL[gateOf(r.gate)]} (${pct(r.gate!.confidence)})`] : []),
    ...(r.justification ? [`**Por quê:** ${r.justification}`] : []),
    [`${model} · ${r.promptVersion ?? PROMPT_VERSION}`, userCategory && `categoria do cliente: ${userCategory}`]
      .filter(Boolean).join(' · '),
  ].join('\n')
}
