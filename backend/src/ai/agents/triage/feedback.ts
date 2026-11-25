/**
 * Feedback da triagem: quando uma pessoa corrige tipo/categoria/subcategoria/prioridade
 * de um chamado triado pela IA, guarda o que a IA decidiu × o que mudou (ai_feedback).
 * Nunca lança: falha aqui não pode derrubar a edição do chamado.
 */
import prisma from '../../../config/prisma'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { NONE_VALUE, type TriageKey } from './options'
import type { TriageResult } from './triage'

type Fields = { type?: string | null; priority?: string | null; category_id?: string | null; subcategory_id?: string | null }

const FIELDS = [
  { field: 'type', column: 'type' },
  { field: 'category', column: 'category_id' },
  { field: 'subcategory', column: 'subcategory_id' },
  { field: 'priority', column: 'priority' },
] as const

export async function recordTriageFeedback(ticketId: string, before: Fields, after: Fields, userId: string, actorRole?: string): Promise<void> {
  try {
    if (userId === SYSTEM_USER_ID || userId === 'system' || actorRole === 'user') return
    // Trocar a categoria limpa a subcategoria sozinho (TicketService): é uma decisão humana só.
    const categoryChanged = (before.category_id ?? null) !== (after.category_id ?? null)
    const changed = FIELDS.filter(f => (before[f.column] ?? null) !== (after[f.column] ?? null)
      && !(f.field === 'subcategory' && categoryChanged))
    if (!changed.length) return
    const run = await prisma.aiAgentRun.findFirst({
      where: { agent: 'triage', ticket_id: ticketId, status: 'ok' },
      orderBy: { created_at: 'desc' },
      select: { id: true, result: true },
    })
    const result = run?.result as TriageResult | null | undefined
    if (!run || !result) return
    const data = changed.flatMap(({ field, column }) => {
      const q = field === 'priority' ? null : result.questions?.find(x => x.key === (field as TriageKey))
      const ai = field === 'priority'
        ? (result.priority ? { value: result.priority.value as string, label: result.priority.value as string } : null)
        : (q ? { value: q.chosen, label: q.chosenLabel } : null)
      if (!ai) return []
      const none = ai.value === NONE_VALUE
      return [{
        run_id: run.id, ticket_id: ticketId, agent: 'triage', field, user_id: userId,
        ai_value: none ? null : ai.value, ai_label: none ? null : ai.label,
        from_value: before[column] ?? null, to_value: after[column] ?? null,
      }]
    })
    if (data.length) await prisma.aiFeedback.createMany({ data })
  } catch (err: any) {
    console.error(`[AI:triage] feedback do chamado ${ticketId} falhou:`, err?.message ?? err)
  }
}

/** Categoria/subcategoria vêm como id: acrescenta from_label/to_label pelo nome (uma consulta cada); tipo e prioridade seguem crus. */
export async function withValueLabels<T extends { field: string; ai_value?: string | null; from_value: string | null; to_value: string | null }>(rows: T[]) {
  const ids = (field: string) => [...new Set(rows.filter(r => r.field === field).flatMap(r => [r.from_value, r.to_value]).filter((v): v is string => !!v))]
  const [cats, subs] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: ids('category') } }, select: { id: true, name: true } }),
    prisma.subcategory.findMany({ where: { id: { in: ids('subcategory') } }, select: { id: true, name: true } }),
  ])
  const names = new Map([...cats, ...subs].map(x => [x.id, x.name]))
  const label = (field: string, v: string | null) => (v && (field === 'category' || field === 'subcategory') ? names.get(v) ?? null : v)
  return rows.map(r => ({ ...r, accepted: r.ai_value != null && r.to_value === r.ai_value, from_label: label(r.field, r.from_value), to_label: label(r.field, r.to_value) }))
}
