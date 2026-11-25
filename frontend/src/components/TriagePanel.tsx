import { useState, type ReactNode } from 'react'
import { Btn, Loading } from '@/components/ui'
import type { TriageChange } from '@/services/aiService'
import { applyFor, pendingChanges, suggestionGroups, useTicketTriage, val, type Current } from './TriageSuggestions'

const FIELDS = [
  { field: 'type', title: 'Tipo' },
  { field: 'category', title: 'Categoria' },
  { field: 'subcategory', title: 'Subcategoria' },
  { field: 'priority', title: 'Prioridade' },
] as const
const FIELD_TITLE: Record<string, string> = { type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', priority: 'Prioridade', queue: 'Fila' }

const pct = (v: number) => `${Math.round(v * 100)}%`
const GATE_TEXT: Record<string, string> = {
  automatic: 'Comunicado automático: classificado, sem perguntas nem orientação ao solicitante',
  test: 'Parece teste, nada aplicado',
  reply: 'Resposta/agradecimento, nada aplicado',
}
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const muted = { fontSize: 13, color: 'var(--text-3)' } as const

/** Detalhe do chamado (equipe): o que a triagem IA decidiu, por quê, e as correções humanas. */
export function TriagePanel({ ticketId, updatedAt, canApply = false, current, onApply }: {
  ticketId: string
  updatedAt?: string
  canApply?: boolean
  current?: Current
  /** Aplica no chamado pelo mesmo caminho dos editores manuais (PATCH + nota interna). Deve lançar em caso de erro. */
  onApply?: (updates: Record<string, string | null>, noteText: string) => Promise<void>
}) {
  const { triage, state, load } = useTicketTriage(ticketId, updatedAt)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const box = { padding: '10px 0', borderBottom: '1px solid var(--border)', ...muted }
  if (state === 'loading') return <Loading size="compact" label="Carregando triagem IA…" />
  if (state === 'error') return <div style={box}>Não foi possível carregar a triagem IA.</div>
  if (!triage) return null

  const proposed = pendingChanges(triage, current)
  const groups = suggestionGroups(proposed)
  const nApplied = triage.changes.filter(c => c.kind === 'applied').length
  const anyApplied = triage.changes.some(c => c.kind === 'applied' && !c.rule)
  const modeBadge = anyApplied ? 'Aplicada' : triage.mode === 'apply' ? 'Modo aplicação' : 'Sugestão (sombra)'
  const summary = triage.status === 'error' ? 'não executada' : `${nApplied} aplicado(s) · ${proposed.length} sugestão(ões)`
  const bodyId = `triage-body-${ticketId}`

  const apply = async (group: TriageChange[]) => {
    setBusy(true)
    try {
      await onApply?.(...applyFor(group, current))
      await load()
    } catch { /* o erro do PATCH já aparece em toast (addInternalNote) */
    } finally { setBusy(false) }
  }

  const row = (title: string, valueText: string, confidence: number | null, verdict: string | null, extra: ReactNode, action: ReactNode) => (
    <li key={title} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-3)' }}>{title}:</span>
        <span style={{ color: 'var(--text-1)' }}>{valueText}</span>
        {verdict && <span style={verdict === 'Revisar' ? { ...muted, color: 'var(--warning)' } : muted}>{verdict}</span>}
        {action}
      </div>
      {confidence != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div role="meter" aria-label={`Confiança ${title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(confidence * 100)} aria-valuetext={pct(confidence)}
            className="meter" style={{ width: 80 }}>
            <span style={{ width: pct(confidence), background: 'var(--accent)' }} />
          </div>
          <span style={muted}>Confiança {pct(confidence)}</span>
        </div>
      )}
      {extra}
    </li>
  )

  const items = triage.status !== 'ok' ? [] : FIELDS.map(({ field, title }) => {
    const c = triage.changes.find(x => x.field === field)
    const f = triage.fields.find(x => x.key === field)
    const isPrio = field === 'priority'
    if (isPrio ? !triage.priority && !c : !f && !c) return null
    const conf = (isPrio ? triage.priority?.confidence : f?.confidence) ?? c?.confidence ?? null
    const wouldApply = isPrio ? triage.priority?.would_apply : f?.would_apply
    const text = val(f?.chosen_label ?? c?.to_label, (isPrio ? triage.priority?.value : f?.chosen) ?? c?.to)
    let verdict: string | null = null
    if (c?.rule) verdict = 'Regra'
    else if (c?.kind === 'applied') verdict = 'Aplicada'
    else if (c?.kind === 'proposed') verdict = 'Sugestão'
    else if (wouldApply === false) verdict = 'Revisar'
    const ui = isPrio ? triage.fields.filter(x => x.key === 'urgency' || x.key === 'impact') : []
    const extra = (
      <>
        {f?.evidence && (
          <q style={muted}>{f.evidence}{f.evidence_source === 'anexo' ? ' (no anexo)' : ''}{!f.evidence_valid ? ' — trecho não encontrado' : ''}</q>
        )}
        {c?.rule && <span style={muted}>Regra: {c.rule}</span>}
        {c?.reason && <span style={muted}>{c.reason}</span>}
        {ui.length > 0 && <span style={muted}>{ui.map(x => `${x.label}: ${x.chosen_label ?? x.chosen ?? '—'} (${pct(x.confidence)})`).join(' · ')}</span>}
      </>
    )
    // categoria + subcategoria propostas juntas: o botão fica na linha da categoria e aplica as duas
    const group = groups.find(g => g[0].field === field) ?? []
    // Sugestão que uma regra bloqueia (reason) não tem botão: a regra reverteria o valor. O motivo já aparece na linha.
    const action = canApply && group.length > 0 && group.every(x => !x.reason)
      ? <Btn size="sm" variant="secondary" disabled={busy} onClick={() => apply(group)} style={{ minHeight: 44 }}>Aplicar sugestão</Btn>
      : null
    return row(title, text, conf, verdict, extra, action)
  })

  return (
    <section aria-label="Triagem IA" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 10px', width: '100%', minHeight: 44, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text-1)' }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Triagem IA</span>
        <span style={muted}>{modeBadge}</span>
        <span style={muted}>{summary}</span>
        {triage.feedback.some(f => !f.accepted) ? <span style={{ ...muted, color: 'var(--warning)' }}>corrigida</span>
          : triage.feedback.length > 0 && <span style={muted}>aceita</span>}
        <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-fg)' }}>{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      <div id={bodyId} hidden={!open} style={{ fontSize: 14, color: 'var(--text-2)', paddingBottom: 6, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {triage.status === 'error' ? (
            <span style={muted}>Triagem IA não executada: {triage.error}</span>
          ) : (
            <>
              {triage.low_information && <p style={{ ...muted, margin: '0 0 6px' }}>Texto curto demais, nada aplicado.</p>}
              {triage.gate?.would_apply && GATE_TEXT[triage.gate.value] && (
                <p style={{ ...muted, margin: '0 0 6px' }}>{GATE_TEXT[triage.gate.value]} ({pct(triage.gate.confidence)}).</p>
              )}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items}</ul>
              {triage.apply_error && <p style={{ ...muted, margin: '6px 0 0' }}>Erro ao aplicar: {triage.apply_error}</p>}
              {triage.justification && <p style={{ margin: '8px 0 0' }}><strong>Justificativa:</strong> {triage.justification}</p>}
            </>
          )}
          {triage.feedback.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {triage.feedback.map((fb, i) => (
                <li key={i}>
                  {FIELD_TITLE[fb.field] ? `${FIELD_TITLE[fb.field]}: ` : ''}{fb.accepted ? 'Sugestão aceita' : 'Corrigido'} por {fb.user.name} em {when(fb.created_at)}: {val(fb.from_label, fb.from_value)} → {val(fb.to_label, fb.to_value)}
                </li>
              ))}
            </ul>
          )}
          <p style={{ ...muted, margin: '8px 0 0' }}>Para corrigir, altere o campo no chamado — a correção fica registrada.</p>
          <p style={{ ...muted, margin: '4px 0 0' }}>{triage.model} · {triage.prompt_version} · {when(triage.created_at)}</p>
      </div>
    </section>
  )
}
