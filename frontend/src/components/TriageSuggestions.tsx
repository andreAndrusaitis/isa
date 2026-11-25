import { useCallback, useEffect, useState } from 'react'
import { Btn } from '@/components/ui'
import { aiService, type TicketTriage, type TriageChange } from '@/services/aiService'

const VALUE_LABEL: Record<string, string> = {
  incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança',
  low: 'Baixa', medium: 'Média', high: 'Alta',
}
export const val = (label: string | null | undefined, raw: string | null | undefined) => label ?? (raw ? VALUE_LABEL[raw] ?? raw : '—')

/** Valores atuais do chamado: uma sugestão já igual ao valor atual não é mais oferecida. */
export type Current = { type?: string | null; priority?: string | null; category?: string | null; subcategory?: string | null }

/** Sugestões ainda pendentes: propostas pela IA (não por regra), fora a fila, e diferentes do valor atual. */
export const pendingChanges = (triage: TicketTriage, current?: Current) =>
  triage.changes.filter(c => c.kind === 'proposed' && !c.rule && c.field !== 'queue' && current?.[c.field] !== c.to)

/** Uma ação por grupo: tipo, categoria + subcategoria (juntas, categoria primeiro) e prioridade. */
export function suggestionGroups(pending: TriageChange[]): TriageChange[][] {
  const of = (...fields: TriageChange['field'][]) => fields.flatMap(f => pending.filter(c => c.field === f))
  return [of('type'), of('category', 'subcategory'), of('priority')].filter(g => g.length > 0)
}

/** Um PATCH só: categoria + subcategoria sugeridas juntas vão no mesmo payload, com a nota no padrão dos editores manuais. */
export function applyFor(changes: TriageChange[], current?: Current): [Record<string, string | null>, string] {
  const p: Record<string, string | null> = {}
  // "de X" só quando o valor atual (tipo/prioridade) está à mão, como nos editores manuais
  const q = (c: TriageChange) => {
    const now = current?.[c.field as 'type' | 'priority']
    return `${now ? `de "${val(null, now)}" ` : ''}para "${val(c.to_label, c.to)}"`
  }
  let note = ''
  for (const c of changes) {
    if (c.field === 'type') { p.type = c.to; note = `Tipo alterado ${q(c)}.` }
    else if (c.field === 'priority') { p.priority = c.to; note = `Prioridade alterada ${q(c)}.` }
    else if (c.field === 'category') p.categoryId = c.to
    else if (c.field === 'subcategory') p.subcategoryId = c.to
  }
  if (!note) {
    const names = changes.map(c => c.to_label ?? c.to).join(' > ')
    note = `Categoria alterada para "${names}".`
  }
  return [p, `${note} (sugestão da Triagem IA)`]
}

/** Última triagem do chamado; recarrega quando o chamado muda (updatedAt). */
export function useTicketTriage(ticketId: string, updatedAt?: string) {
  const [triage, setTriage] = useState<TicketTriage | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const load = useCallback((alive: () => boolean = () => true) =>
    aiService.getTicketTriage(ticketId)
      .then(d => { if (alive()) { setTriage(d); setState('ready') } })
      .catch(() => { if (alive()) setState(s => (s === 'ready' ? s : 'error')) }),
  [ticketId])
  useEffect(() => {
    let live = true
    load(() => live)
    return () => { live = false }
  }, [load, updatedAt])
  return { triage, state, load }
}

// "Categoria Rede › Wi-Fi": título do campo + valores sugeridos do grupo.
const groupText = (g: TriageChange[]) => {
  const title = g[0].field === 'type' ? 'Tipo' : g[0].field === 'priority' ? 'Prioridade' : g[0].field === 'category' ? 'Categoria' : 'Subcategoria'
  return `${title} ${g.map(c => val(c.to_label, c.to)).join(' › ')}`
}

/** Sugestões pendentes da última triagem, com botão "Aplicar" (timeline do chamado, equipe que pode aplicar). */
export function TriageSuggestions({ ticketId, updatedAt, current, onApply }: {
  ticketId: string
  updatedAt?: string
  current?: Current
  /** Aplica no chamado pelo mesmo caminho dos editores manuais (PATCH + nota interna). Deve lançar em caso de erro. */
  onApply: (updates: Record<string, string | null>, noteText: string) => Promise<void>
}) {
  const { triage, load } = useTicketTriage(ticketId, updatedAt)
  const [busy, setBusy] = useState(false)
  if (!triage || triage.status !== 'ok') return null
  const groups = suggestionGroups(pendingChanges(triage, current))
  if (!groups.length) return null

  const apply = async (group: TriageChange[]) => {
    setBusy(true)
    try {
      await onApply(...applyFor(group, current))
      await load()
    } catch { /* o erro do PATCH já aparece em toast (addInternalNote) */
    } finally { setBusy(false) }
  }

  return (
    <ul aria-label="Sugestões da Triagem IA" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
      {groups.map(g => {
        const text = groupText(g)
        const reason = g.find(c => c.reason)?.reason
        return (
          <li key={g[0].field} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ flex: '1 1 180px', minWidth: 0, wordBreak: 'break-word' }}>
              Sugere {text} <span style={{ color: 'var(--text-2)' }}>({Math.round(Math.min(...g.map(c => c.confidence)) * 100)}%)</span>
            </span>
            {/* Sugestão que uma regra bloqueia não tem botão: a regra reverteria o valor. */}
            {reason
              ? <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{reason}</span>
              : <Btn size="sm" variant="ghost" disabled={busy} aria-label={`Aplicar ${text}`} onClick={() => apply(g)} style={{ minHeight: 44 }}>Aplicar</Btn>}
          </li>
        )
      })}
    </ul>
  )
}
