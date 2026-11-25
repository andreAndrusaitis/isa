/**
 * O que a triagem muda no chamado. `planTriage` calcula as mudanças sem gravar
 * (modo sombra registra o que mudaria); `applyTriage` grava (modo apply) pelo
 * mesmo caminho das regras de automação: um único update, troca de tipo por
 * computeTicketTypeChange (prefixo INC/REQ e SLA), evento no histórico e broadcast.
 * Só entram campos que passaram no limiar (wouldApply) e diferem do valor atual.
 */
import prisma from '../../../config/prisma'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { computeTicketTypeChange } from '../../../services/ticketTypeChange'
import { TicketService } from '../../../services/tickets'
import { rerouteQueueAfterReclassification, runRoutingRules, simulateRuleFields, type TicketFieldsPatch } from '../../../services/routing'
import { NONE_VALUE, TYPE_OPTIONS } from './options'
import { CATEGORY_OVERRIDE_CONFIDENCE, SUGGEST_MIN_CONFIDENCE, heldByGate, type QuestionResult, type TriageResult } from './triage'

export type ChangedField = 'type' | 'category' | 'subcategory' | 'priority' | 'queue'
/** Uma alteração: o chamado era `from` e vira `to` (valores e rótulos legíveis). */
export interface FieldChange {
  field: ChangedField
  label: string
  from: string | null
  fromLabel: string
  to: string
  toLabel: string
  confidence: number
  /** Mudança feita por regra de automação, reavaliada com a classificação da IA. */
  rule?: { id: string; name: string }
  /** Por que a sugestão da IA não foi aplicada (ex.: uma regra define outro valor). */
  reason?: string
}

const FIELD_LABEL: Record<ChangedField, string> = { type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', priority: 'Prioridade', queue: 'Fila' }
const PRIORITY_LABEL: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }
const typeLabel = (v: string) => TYPE_OPTIONS.find(o => o.value === v)?.label ?? v

export const describeChange = (c: FieldChange) =>
  `${c.label}: ${c.fromLabel} → ${c.toLabel}${c.rule ? ` (regra "${c.rule.name}", após a reclassificação)` : ''}${c.reason ? ` — ${c.reason}` : ''}`

/** Campos que o modo apply pode gravar; o resto vira sugestão (proposed). Padrão: tudo. */
export type ApplyFields = ReadonlySet<ChangedField>
const ALL_FIELDS: ApplyFields = new Set<ChangedField>(['type', 'category', 'subcategory', 'priority'])

export async function planTriage(ticketId: string, r: TriageResult, fields: ApplyFields = ALL_FIELDS) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { category: { select: { name: true } }, subcategory: { select: { name: true } } },
  })
  // Excluído durante a chamada à LLM: não grava nada no chamado da Lixeira.
  if (!ticket || ticket.deleted_at) return { ticket: null, patch: {}, changes: [] as FieldChange[], suggested: [] as FieldChange[] }

  // Texto curto demais ("ajuda", "não funciona"), teste ou agradecimento: a nota registra a leitura, mas nada muda.
  if (r.lowInformation || heldByGate(r)) return { ticket, patch: {}, changes: [] as FieldChange[], suggested: [] as FieldChange[] }
  const q = Object.fromEntries(r.questions.map(x => [x.key, x]))
  const patch: Record<string, unknown> = {}
  const changes: FieldChange[] = []
  // Campo que o apply não pode gravar não entra no patch: fica só como sugestão ao analista.
  // A subcategoria acompanha a categoria (sem poder gravar a categoria, a sub também não).
  const suggested: FieldChange[] = []
  const allowed = (f: ChangedField) => fields.has(f) && (f !== 'subcategory' || fields.has('category'))
  const add = (field: ChangedField, from: string | null, fromLabel: string, to: string, toLabel: string, confidence: number) =>
    (allowed(field) ? changes : suggested).push({ field, label: FIELD_LABEL[field], from, fromLabel, to, toLabel, confidence })
  const set = (field: ChangedField, values: Record<string, unknown>) => { if (allowed(field)) Object.assign(patch, values) }

  if (q.type?.wouldApply && q.type.chosen !== ticket.type) {
    const change = await computeTicketTypeChange(ticket, q.type.chosen)
    set('type', change)
    add('type', ticket.type, `${typeLabel(ticket.type)} (${ticket.display_number})`,
      q.type.chosen, `${typeLabel(q.type.chosen)} (${change.display_number})`, q.type.confidence)
  }

  {
    let categoryId = ticket.category_id
    // Se a categoria nova tem subcategorias, só grava com uma subcategoria confiável
    // (sem ela o chamado fica "Cloud / —", pior que antes). Trocar a escolha do cliente
    // ainda pede confiança alta.
    const subOk = !q.subcategory || (q.subcategory.wouldApply && q.subcategory.chosen !== NONE_VALUE)
    const categoryOk = q.category?.wouldApply && q.category.chosen !== NONE_VALUE && subOk
      && (!ticket.category_id || q.category.confidence >= CATEGORY_OVERRIDE_CONFIDENCE)
    if (categoryOk && q.category!.chosen !== ticket.category_id) {
      categoryId = q.category.chosen
      set('category', { category_id: categoryId, subcategory_id: null })
      add('category', ticket.category_id, ticket.category?.name ?? '—', q.category.chosen, q.category.chosenLabel, q.category.confidence)
    }
    // As opções da subcategoria vêm da categoria escolhida pela IA: só vale se for a categoria final.
    const subApplies = q.subcategory?.wouldApply && q.subcategory.chosen !== NONE_VALUE && q.category?.chosen === categoryId
    if (subApplies && q.subcategory!.chosen !== ticket.subcategory_id) {
      set('subcategory', { subcategory_id: q.subcategory!.chosen })
      add('subcategory', ticket.subcategory_id, ticket.subcategory?.name ?? '—', q.subcategory!.chosen, q.subcategory!.chosenLabel, q.subcategory!.confidence)
    }
    // Abaixo do limiar a IA só sugere (botão "Aplicar" para o analista); categoria e subcategoria
    // sugeridas juntas. Sugestão quase sem sinal (< SUGGEST_MIN_CONFIDENCE) fica só no "Revisar" da nota.
    const hint = (x?: QuestionResult) => !!x && x.chosen !== NONE_VALUE && x.confidence >= SUGGEST_MIN_CONFIDENCE
    const suggest = (field: 'category' | 'subcategory', from: string | null, fromLabel: string, x: QuestionResult) =>
      suggested.push({ field, label: FIELD_LABEL[field], from, fromLabel, to: x.chosen, toLabel: x.chosenLabel, confidence: x.confidence })
    const catHint = !categoryOk && hint(q.category) && q.category!.chosen !== ticket.category_id
    if (catHint) suggest('category', ticket.category_id, ticket.category?.name ?? '—', q.category!)
    if (!subApplies && hint(q.subcategory) && q.subcategory!.chosen !== ticket.subcategory_id
      && (catHint || q.category?.chosen === categoryId)) {
      suggest('subcategory', ticket.subcategory_id, ticket.subcategory?.name ?? '—', q.subcategory!)
    }
  }

  if (r.priority.wouldApply && r.priority.value !== ticket.priority) {
    set('priority', { priority: r.priority.value })
    add('priority', ticket.priority, PRIORITY_LABEL[ticket.priority], r.priority.value, PRIORITY_LABEL[r.priority.value], r.priority.confidence)
  }

  await enforceRules(ticket, patch, changes, suggested)
  return { ticket, patch, changes, suggested }
}

type RuleField = 'type' | 'category' | 'subcategory' | 'priority'
const RULE_FIELDS: RuleField[] = ['type', 'category', 'subcategory', 'priority']
const PATCH_KEY = { type: 'type', category: 'category_id', subcategory: 'subcategory_id', priority: 'priority' } as const
// Campos que a troca de tipo grava junto (computeTicketTypeChange): saem do patch com o tipo.
const TYPE_KEYS = ['type', 'display_number', 'sla_deadline', 'first_response_deadline']

async function fieldValueLabel(field: RuleField, value: string | null): Promise<string> {
  if (!value) return '—'
  if (field === 'priority') return PRIORITY_LABEL[value] ?? value
  if (field === 'type') return typeLabel(value)
  const row = field === 'category'
    ? await prisma.category.findUnique({ where: { id: value }, select: { name: true } })
    : await prisma.subcategory.findUnique({ where: { id: value }, select: { name: true } })
  return row?.name ?? value
}

type PlannedTicket = { id: string; type: string; category_id: string | null; subcategory_id: string | null; priority: string; display_number: string }

/**
 * O roteamento manda, a IA sugere: simula as regras com a classificação
 * da IA. Campo que uma regra de abertura define → vale a regra (mudança atribuída a ela,
 * mesmo fora de AI_TRIAGE_APPLY_FIELDS: é a regra agindo). Campo que uma regra de
 * "chamado atualizado" reverteria → a IA não grava, vira sugestão com o motivo.
 */
async function enforceRules(ticket: PlannedTicket, patch: Record<string, unknown>, changes: FieldChange[], suggested: FieldChange[]) {
  const aiValues: TicketFieldsPatch = {}
  for (const f of RULE_FIELDS) if (PATCH_KEY[f] in patch) (aiValues as any)[PATCH_KEY[f]] = patch[PATCH_KEY[f]]
  const sim = await simulateRuleFields(ticket.id, aiValues)
  if (!sim) return
  const drop = (f: RuleField, reason: string) => {
    const i = changes.findIndex(c => c.field === f && !c.rule)
    if (i < 0) return
    suggested.push({ ...changes.splice(i, 1)[0], reason })
    for (const k of f === 'type' ? TYPE_KEYS : [PATCH_KEY[f]]) delete patch[k]
  }
  for (const f of RULE_FIELDS) {
    const ai = changes.find(c => c.field === f && !c.rule)
    const byCreated = sim.created[f]
    if (byCreated) {
      if (ai && ai.to !== byCreated.value) drop(f, `a regra "${byCreated.rule.name}" define ${await fieldValueLabel(f, byCreated.value)}`)
      const current = ticket[PATCH_KEY[f]]
      if (byCreated.value === current || changes.some(c => c.field === f)) continue
      // A regra passa a valer com a classificação nova (ex.: "categoria X → Alta"): aplica o valor dela.
      let fromLabel = await fieldValueLabel(f, current)
      let toLabel = await fieldValueLabel(f, byCreated.value)
      if (f === 'type') {
        const change = await computeTicketTypeChange(ticket as any, byCreated.value!)
        Object.assign(patch, change)
        fromLabel = `${fromLabel} (${ticket.display_number})`
        toLabel = `${toLabel} (${change.display_number})`
      } else patch[PATCH_KEY[f]] = byCreated.value
      changes.push({ field: f, label: FIELD_LABEL[f], from: current, fromLabel, to: byCreated.value ?? '', toLabel, confidence: 1, rule: byCreated.rule })
      continue
    }
    const byUpdated = sim.updated[f]
    if (byUpdated && ai && ai.to !== byUpdated.value) {
      drop(f, `a regra "${byUpdated.rule.name}" (chamado atualizado) definiria ${await fieldValueLabel(f, byUpdated.value)}`)
    }
  }
}

/**
 * Aplica a triagem: grava os campos permitidos (`fields`) e devolve o que gravou (applied)
 * e o que ficou só como sugestão por não estar permitido (suggested).
 */
export async function applyTriage(ticketId: string, r: TriageResult, fields: ApplyFields = ALL_FIELDS) {
  const { ticket, patch, changes, suggested } = await planTriage(ticketId, r, fields)
  if (!ticket || !changes.length) return { applied: [] as FieldChange[], suggested }
  await prisma.ticket.update({ where: { id: ticketId }, data: patch as any })
  const byAi = changes.filter(c => !c.rule)
  if (byAi.length) {
    await prisma.ticketEvent.create({
      data: {
        ticket_id: ticketId, user_id: SYSTEM_USER_ID, from_status: ticket.status, to_status: ticket.status,
        note: `Triagem IA aplicou: ${byAi.map(describeChange).join('; ')}.`,
      },
    })
  }
  // Mudança feita por regra (reavaliada com a classificação nova): evento atribuído à regra.
  for (const c of changes.filter(c => c.rule)) {
    await prisma.ticketEvent.create({
      data: {
        ticket_id: ticketId, user_id: SYSTEM_USER_ID, from_status: ticket.status, to_status: ticket.status,
        note: `Regra de automação "${c.rule!.name}" reaplicada após a reclassificação da Triagem IA: ${c.label}: ${c.fromLabel} → ${c.toLabel}.`,
        routing_rule_id: c.rule!.id,
      },
    })
  }
  // A fila acompanha a reclassificação: só as ações "definir fila" das regras de
  // abertura rodam de novo; nada de notificar/macro.
  if (changes.some(c => c.field !== 'priority')) {
    const moved = await rerouteQueueAfterReclassification(ticketId)
      .catch(err => { console.error('[AI:triage] fila após apply falhou:', err?.message ?? err); return null })
    if (moved) {
      const names = new Map((await prisma.queue.findMany({
        where: { id: { in: [moved.from, moved.to].filter((x): x is string => !!x) } }, select: { id: true, name: true },
      })).map(qq => [qq.id, qq.name]))
      const label = (id: string | null) => (id ? names.get(id) ?? id : 'sem fila')
      const basis = changes.find(c => c.field === 'category') ?? changes[0]
      changes.push({ field: 'queue', label: FIELD_LABEL.queue, from: moved.from, fromLabel: label(moved.from), to: moved.to ?? '', toLabel: label(moved.to), confidence: basis.confidence })
    }
  }
  // Como numa edição do analista: regras do gatilho "chamado atualizado" reavaliam o chamado.
  await runRoutingRules(ticketId, 'ticket_updated').catch(err => console.error('[AI:triage] regras após apply falharam:', err?.message ?? err))
  TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated')
  return { applied: changes, suggested }
}
