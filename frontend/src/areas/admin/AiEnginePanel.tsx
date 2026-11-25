import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Btn, Card, Figures, PageHeader, Sel, StatCard, ConfirmModal, Modal, Loading } from '@/components/ui'
import {
  aiService, type AiStatus, type AiAgentStatus, type AiAgentMode, type AiRun, type AiMetrics, type AiFieldDecision,
  type AiChange, type AiChangeKind, type AiRunChange, type GuidanceRunResult,
  type AiFeedbackItem, type AiInsights,
} from '@/services/aiService'
import { AiAgentConfig } from './AiAgentConfig'
import { AccuracyBars, spDate } from '@/components/AiInsightsUi'
import { useAuthStore } from '@/store/auth'
import { connectSocket } from '@/services/socketService'
import { SKADI_NAME } from '@/utils/skadi'
import './admin.css'

// Central dos agentes de IA (admin): os números do período em faixa, a tabela de agentes (liga/desliga) e,
// embaixo, as abas com os logs por chamado, as alterações, a qualidade e as correções humanas.

type Ticket = AiChange['ticket']

const FIELD_LABEL: Record<string, string> = {
  type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria',
  urgency: 'Urgência', impact: 'Impacto', priority: 'Prioridade', queue: 'Fila',
}
const CHANGE_FIELDS = ['type', 'category', 'subcategory', 'priority', 'queue']
const FEEDBACK_FIELDS = ['type', 'category', 'subcategory', 'priority']
const LEVEL_LABEL: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' }

const GUIDANCE_SKIP: Record<string, string> = { staff: 'aberto pela equipe', on_behalf: 'aberto em nome do cliente', special_form: 'formulário especial' }
const GUIDANCE_KIND: Record<string, string> = { request: 'pedido de ação da equipe', other: 'comunicado ou resposta', problem: 'problema com confiança baixa' }

/** Resumo de uma execução do agente guidance, que não tem decisões por campo. */
function guidanceSummary(run: AiRun): string | null {
  if (run.agent !== 'guidance' || !run.result) return null
  const r = run.result as GuidanceRunResult
  if (r.skipReason) return `Pulado: ${GUIDANCE_SKIP[r.skipReason] ?? r.skipReason}`
  if (r.duplicate?.isDuplicate) return `Possível duplicado de ${r.duplicate.ticket.display_number} (${Math.round(r.duplicate.confidence * 100)}%): ofereceu vincular`
  const g = r.guidance
  if (!g) return null
  const hints = g.teamHints.length ? ` · ${g.teamHints.length} dica(s) de equipe para o analista` : ''
  if (g.kind && !g.kind.problem) return `Sem orientação: ${GUIDANCE_KIND[g.kind.chosen] ?? g.kind.chosen}${hints}`
  if (!g.steps.length) return `Sem orientação de autoatendimento${hints}`
  const learn = g.steps.filter(s => s.source.startsWith('L')).length
  return `Orientação: ${g.steps.length} passo(s) (${learn} do Microsoft Learn, ${g.steps.length - learn} da base interna)${g.links.length ? ` · ${g.links.length} link(s)` : ''}${hints}`
}

const MODES: { value: AiAgentMode; label: string; done: string; hint: string }[] = [
  { value: 'off',    label: 'Desligado', done: 'Desligado', hint: 'Não executa' },
  { value: 'shadow', label: 'Sombra',    done: 'Sombra',    hint: 'Observa e registra, sem alterar o chamado' },
  { value: 'apply',  label: 'Aplicar',   done: 'Ligado',    hint: 'Aplica as decisões no chamado' },
]
const modeLabel = (m: string) => MODES.find(o => o.value === m)?.done ?? m

const KIND_LABEL: Record<AiChangeKind, string> = { applied: 'Aplicado', proposed: 'Sugerido (sombra)' }

const PERIODS = [{ days: 1, label: '24 horas' }, { days: 7, label: '7 dias' }, { days: 30, label: '30 dias' }]
const PAGE = 25
/** Quantas execuções recentes ficam em memória (latência por agente e detalhe do chamado). */
const RECENT_CAP = 150

const fmtInt = (n: number) => n.toLocaleString('pt-BR')
const fmtMs = (ms: number | null) => ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`
const fmtPct = (r: number) => `${Math.round(r * 100)}%`
const fmtConf = (r: number | null | undefined) => r == null ? '—' : fmtPct(r)
const fmtDate = (s: string) => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const fmtUsd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`
const median = (v: number[]) => v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null
const errorTone = (bad: boolean) => bad ? { color: 'var(--danger)' } : undefined

/** Decisões por campo de uma execução (perguntas + prioridade derivada). */
function runFields(run: AiRun): AiFieldDecision[] {
  const r = run.result
  if (!r) return []
  const fields = [...(Array.isArray(r.questions) ? r.questions : [])]
  if (r.priority) fields.push({ key: 'priority', chosenLabel: LEVEL_LABEL[r.priority.value] ?? r.priority.value, confidence: r.priority.confidence, wouldApply: r.priority.wouldApply })
  return fields
}

/** Agrupa por chamado mantendo a ordem de chegada (a API já vem do mais recente). */
function byTicket<T extends { ticket: Ticket }>(rows: T[]): { ticket: Ticket; items: T[] }[] {
  const groups = new Map<string, { ticket: Ticket; items: T[] }>()
  for (const r of rows) {
    const key = r.ticket?.id ?? ''
    const g = groups.get(key)
    if (g) g.items.push(r)
    else groups.set(key, { ticket: r.ticket, items: [r] })
  }
  return [...groups.values()]
}

function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}%`}>
      <span style={{ width: `${pct}%`, background: 'var(--accent)' }} />
    </div>
  )
}

/** O que muda de verdade quando o agente passa a aplicar (texto da confirmação). */
const APPLY_EFFECT: Record<string, string> = {
  triage: 'A triagem passará a gravar nos chamados novos os campos que passarem no limiar de confiança.',
  intake: `A ${SKADI_NAME} passará a perguntar ao solicitante o que falta nos chamados novos (no chamado e por e-mail) e a marcar o chamado como "Informações incompletas".`,
}

/** Seletor do modo do agente: botões nativos com aria-pressed (teclado e leitor de tela). */
function ModeSwitch({ name, mode, busy, onChange }: { name: string; mode: string; busy: boolean; onChange: (m: AiAgentMode) => void }) {
  return (
    <div role="group" aria-label={`Modo de ${name}`} aria-busy={busy} className="subtabs ai-mode">
      {MODES.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === mode} disabled={busy} title={o.hint} onClick={() => { if (o.value !== mode) onChange(o.value) }}>{o.label}</button>
      ))}
    </div>
  )
}

/** "Era → Virou". */
function FromTo({ from, to }: { from: string; to: string }) {
  return (
    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <span style={{ color: 'var(--text-3)' }}>{from || '—'}</span>{' '}
      <span role="img" aria-label="virou" style={{ color: 'var(--text-3)' }}>→</span>{' '}
      <span style={{ fontWeight: 500 }}>{to}</span>
    </span>
  )
}

function TicketLink({ ticket, onOpenTicket }: { ticket: Ticket; onOpenTicket?: (id: string) => void }) {
  if (!ticket) return <span style={{ color: 'var(--text-3)' }}>Sem chamado</span>
  return (
    <button type="button" className="adm-link" onClick={() => onOpenTicket?.(ticket.id)} aria-label={`Abrir chamado ${ticket.display_number}`} title={ticket.title}>
      <span>{ticket.display_number}</span><span>{ticket.title}</span>
    </button>
  )
}

/** Resumo do catálogo: alterações por campo e transições mais comuns. */
function ChangesSummary({ changes }: { changes: NonNullable<AiMetrics['changes']> }) {
  if (!changes.by_field.length) return null
  return (
    <div className="ai-summary">
      <div>
        <p className="adm-note">Por campo</p>
        <div aria-label="Alterações por campo" role="group">
          {changes.by_field.map(f => (
            <div key={f.field} className="ai-line">
              <span style={{ flex: 1 }}>{f.label || FIELD_LABEL[f.field] || f.field}</span>
              <span>{fmtInt(f.applied)} aplicadas</span>
              <span style={{ color: 'var(--text-3)' }}>{fmtInt(f.proposed)} sugeridas</span>
            </div>
          ))}
        </div>
      </div>
      {changes.top_transitions.length > 0 && (
        <div>
          <p className="adm-note">Mais comuns</p>
          <ol>
            {changes.top_transitions.slice(0, 5).map(t => (
              <li key={`${t.field}|${t.from_label}|${t.to_label}`} className="ai-line">
                <span style={{ color: 'var(--text-3)' }}>{t.label}</span>
                <span style={{ flex: 1 }}><FromTo from={t.from_label} to={t.to_label} /></span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }} title={`${t.applied} aplicadas · ${t.proposed} sugeridas`}>×{fmtInt(t.total)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/** Alterações de um chamado (aba Alterações): uma linha por campo. */
function TicketChanges({ ticket, rows, onOpenTicket }: { ticket: Ticket; rows: AiChange[]; onOpenTicket?: (id: string) => void }) {
  return (
    <li>
      <div style={{ minWidth: 0 }}>
        <TicketLink ticket={ticket} onOpenTicket={onOpenTicket} />
        <div className="adm-sub">{rows.length} alteraç{rows.length === 1 ? 'ão' : 'ões'}</div>
      </div>
      <ul aria-label={`Alterações em ${ticket?.display_number ?? 'sem chamado'}`}>
        {rows.map(c => (
          <li key={`${c.run_id}|${c.kind}|${c.field}`}>
            <div className="ai-line">
              <span style={{ minWidth: 96, color: 'var(--text-3)' }}>{c.label || FIELD_LABEL[c.field] || c.field}</span>
              <FromTo from={c.from_label} to={c.to_label} />
              <small title="Confiança">{fmtConf(c.confidence)}</small>
              <small>{KIND_LABEL[c.kind] ?? KIND_LABEL.proposed}</small>
              <small style={{ marginLeft: 'auto' }}><time dateTime={c.created_at}>{fmtDate(c.created_at)}</time></small>
            </div>
            {(c.rule || c.reason) && <small>{c.rule ? `Aplicada pela regra "${c.rule}" após a reclassificação da IA` : `Não aplicada: ${c.reason}`}</small>}
          </li>
        ))}
      </ul>
    </li>
  )
}

function FieldRow({ f }: { f: AiFieldDecision }) {
  const label = f.label ?? FIELD_LABEL[f.key] ?? f.key
  const conf = f.confidence ?? 0
  return (
    <div style={{ minWidth: 0, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
        <span style={{ color: 'var(--text-3)' }}>{label}</span>
        <span className="adm-clip" style={{ flex: 1, minWidth: 0 }} title={f.chosenLabel ?? undefined}>{f.chosenLabel ?? '—'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPct(conf)}</span>
      </div>
      <Meter value={conf} label={`Confiança em ${label}`} />
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>{f.wouldApply ? 'Aplicaria' : 'Revisão humana'}</div>
    </div>
  )
}

function RunChanges({ changes, label }: { changes: AiRunChange[]; label: string }) {
  return (
    <ul aria-label={label} style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
      {changes.map((c, i) => (
        <li key={`${i}|${c.kind}|${c.field}`} className="ai-line">
          <span style={{ color: 'var(--text-3)' }}>{c.label}:</span>
          <FromTo from={c.from_label} to={c.to_label} />
          <small>({c.kind === 'applied' ? 'aplicado' : 'sugerido'})</small>
        </li>
      ))}
    </ul>
  )
}

/** Uma linha curta do que a execução fez. */
function runLine(run: AiRun): string {
  if (run.status !== 'ok') return run.error ?? 'Erro'
  const g = guidanceSummary(run)
  if (g) return g
  const n = run.changes?.length ?? 0
  if (n) return `${n} alteraç${n === 1 ? 'ão' : 'ões'} no chamado`
  const fields = runFields(run)
  if (fields.length) return `Nenhuma alteração no chamado · aplicaria ${fields.filter(f => f.wouldApply).length}/${fields.length}`
  return 'Nenhuma alteração no chamado'
}

const runHead = (run: AiRun, agentName: string) => <>
  <span style={{ fontWeight: 600 }}>{agentName}</span>
  <small>{modeLabel(run.mode)}</small>
  {run.status !== 'ok' && <span style={{ fontSize: 13, color: 'var(--danger)' }}>Erro</span>}
</>

/** Detalhe completo de uma execução (folha "mais informações"). */
function RunDetail({ run, agentName }: { run: AiRun; agentName: string }) {
  const fields = runFields(run)
  const changes = run.changes ?? []
  const applied = fields.filter(f => f.wouldApply).length
  const ok = run.status === 'ok'
  const summary = ok && guidanceSummary(run)
  return (
    <li style={{ padding: '18px 0', borderTop: '1px solid var(--border)', fontSize: 14 }}>
      <div className="ai-line">{runHead(run, agentName)}<small style={{ marginLeft: 'auto' }}><time dateTime={run.created_at}>{fmtDate(run.created_at)}</time></small></div>
      <div className="adm-sub">{run.model} · prompt {run.prompt_version} · {fmtMs(run.latency_ms)} · {fmtInt(run.input_tokens)} + {fmtInt(run.output_tokens)} tokens</div>

      {!ok && <p className="adm-error" style={{ marginTop: 8, wordBreak: 'break-word' }}>{run.error}</p>}
      {summary && <p style={{ margin: '8px 0 0' }}>{summary}</p>}
      {run.apply_error && <p className="adm-error" style={{ marginTop: 8, wordBreak: 'break-word' }}>Falha ao aplicar: {run.apply_error}</p>}
      {changes.length > 0
        ? <RunChanges changes={changes} label="Alterações desta execução" />
        : ok && fields.length > 0 && <p className="adm-note" style={{ marginTop: 8 }}>Nenhuma alteração no chamado.</p>}

      {fields.length > 0 && <>
        <div className="ai-line" style={{ marginTop: 10 }}>
          <span>Aplicaria {applied}/{fields.length}</span>
          {applied < fields.length && <span style={{ color: 'var(--text-3)' }}>Revisão humana: {fields.length - applied}</span>}
        </div>
        <div className="ai-decisions">{fields.map(f => <FieldRow key={f.key} f={f} />)}</div>
      </>}
      {run.result?.justification && <>
        <p className="adm-note" style={{ marginTop: 12 }}>Justificativa</p>
        <p style={{ margin: '2px 0 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{run.result.justification}</p>
      </>}
    </li>
  )
}

/** Log agrupado por chamado: o que cada agente fez nele, com as alterações juntas. */
function TicketLog({ ticket, runs, agentName, onOpenTicket, onInfo }: {
  ticket: Ticket; runs: AiRun[]; agentName: (k: string) => string; onOpenTicket?: (id: string) => void; onInfo: () => void
}) {
  const changes = runs.flatMap(r => r.changes ?? [])
  const name = ticket?.display_number ?? 'sem chamado'
  return (
    <li>
      <div style={{ minWidth: 0 }}>
        <TicketLink ticket={ticket} onOpenTicket={onOpenTicket} />
        <div className="adm-sub"><time dateTime={runs[0].created_at}>{fmtDate(runs[0].created_at)}</time></div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ul aria-label={`Execuções em ${name}`}>
            {runs.map(r => (
              <li key={r.id} className="ai-line">
                {runHead(r, agentName(r.agent))}
                <span style={{ flex: '1 1 240px', minWidth: 0, wordBreak: 'break-word', color: r.status === 'ok' ? 'var(--text-2)' : 'var(--danger)' }}>{runLine(r)}</span>
              </li>
            ))}
          </ul>
          {changes.length > 0 && <RunChanges changes={changes} label={`Alterações em ${name}`} />}
        </div>
        <button type="button" className="icon-act" onClick={onInfo} aria-label={`Mais informações de ${name}`} title="Mais informações"><Info size={16} aria-hidden /></button>
      </div>
    </li>
  )
}

function AgentRow({ a, configured, busy, latency, filtered, onModeChange, onFilter }: {
  a: AiAgentStatus; configured: boolean; busy: boolean; latency: number | null; filtered: boolean; onModeChange: (m: AiAgentMode) => void; onFilter: () => void
}) {
  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 500 }}>{a.name}</div>
        {a.description && <div className="adm-sub">{a.description}</div>}
        {!configured && a.mode !== 'off' && <div className="adm-sub" style={{ color: 'var(--danger)' }}>Sem LLM configurado: não executa.</div>}
      </td>
      <td><ModeSwitch name={a.name} mode={a.mode} busy={busy} onChange={onModeChange} /></td>
      <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(a.runs_24h)} em 24h<div className="adm-sub">{fmtInt(a.runs_7d)} em 7 dias</div></td>
      <td style={{ whiteSpace: 'nowrap', ...errorTone(a.errors_24h > 0) }}>{fmtInt(a.errors_24h)} em 24h</td>
      <td style={{ whiteSpace: 'nowrap' }}>{fmtMs(latency)}<div className="adm-sub">última: {a.last_run_at ? fmtDate(a.last_run_at) : 'nunca'}</div></td>
      <td>
        <div className="ai-agent-actions">
          <Btn variant="ghost" size="xs" aria-pressed={filtered} aria-label={`Ver logs de ${a.name}`} onClick={onFilter}>{filtered ? 'Ver todos os logs' : 'Ver logs'}</Btn>
          <AiAgentConfig agent={a} />
        </div>
      </td>
    </tr>
  )
}

function LoadMore({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <Btn variant="secondary" size="sm" onClick={onClick} disabled={busy}>{busy ? 'Carregando…' : 'Carregar mais'}</Btn>
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="adm-note" style={{ padding: '14px 0', borderTop: '1px solid var(--border)' }}>{children}</p>

const TABS = [
  { id: 'logs', label: 'Logs' },
  { id: 'changes', label: 'Alterações' },
  { id: 'quality', label: 'Qualidade' },
  { id: 'feedback', label: 'Correções' },
] as const
type TabId = typeof TABS[number]['id']

const selStyle = { minWidth: 140, padding: '7px 8px', fontSize: 13.5 }

export function AiEnginePanel({ onOpenTicket }: { onOpenTicket?: (ticketId: string) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [metrics, setMetrics] = useState<AiMetrics | null>(null)
  const [runs, setRuns] = useState<AiRun[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [changes, setChanges] = useState<AiChange[]>([])
  const [changesCursor, setChangesCursor] = useState<string | null>(null)
  const [agent, setAgent] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [field, setField] = useState('')
  const [kind, setKind] = useState<'' | AiChangeKind>('')
  const [days, setDays] = useState(7)
  const [fbField, setFbField] = useState('')
  const [feedback, setFeedback] = useState<AiFeedbackItem[]>([])
  const [feedbackCursor, setFeedbackCursor] = useState<string | null>(null)
  const [feedbackLoading, setFeedbackLoading] = useState(true)
  const [fbError, setFbError] = useState<string | null>(null)
  const [insights, setInsights] = useState<AiInsights | null>(null)
  const [tab, setTab] = useState<TabId>('logs')
  const [loading, setLoading] = useState(true)
  const [changesLoading, setChangesLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState<'' | 'runs' | 'changes' | 'feedback'>('')
  const [error, setError] = useState<string | null>(null)
  const [modeBusy, setModeBusy] = useState<string | null>(null)
  const [modeError, setModeError] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState<{ key: string; name: string } | null>(null)
  const [infoKey, setInfoKey] = useState<string | null>(null)
  const [recentRuns, setRecentRuns] = useState<AiRun[]>([])
  const accessToken = useAuthStore(s => s.accessToken)
  const filtersRef = useRef({ agent, runStatus })
  filtersRef.current = { agent, runStatus }

  const changesQuery = useCallback((c?: string) =>
    aiService.getChanges({ agent: agent || undefined, field: field || undefined, kind: kind || undefined, days, limit: PAGE, cursor: c }),
  [agent, field, kind, days])
  const runsQuery = useCallback((c?: string) =>
    aiService.getRuns({ agent: agent || undefined, status: runStatus || undefined, limit: 20, cursor: c }),
  [agent, runStatus])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, m, r] = await Promise.all([aiService.getStatus(), aiService.getMetrics({ agent: agent || undefined, days }), runsQuery()])
      setStatus(s); setMetrics(m); setRuns(r.data); setCursor(r.next_cursor)
    } catch {
      setError('Não foi possível carregar os agentes de IA.')
    } finally {
      setLoading(false)
    }
  }, [agent, days, runsQuery])

  const saveMode = async (key: string, mode: AiAgentMode) => {
    setModeBusy(key)
    setModeError(null)
    try {
      await aiService.setAgentMode(key, mode)
      setStatus(s => s && {
        ...s,
        agents: s.agents.map(a => (a.key === key ? { ...a, mode, active: s.configured && mode !== 'off' } : a)),
      })
    } catch {
      setModeError('Não foi possível alterar o modo do agente. Nada mudou; tente de novo.')
    } finally {
      setModeBusy(null)
    }
  }
  // Aplicar mexe nos chamados ou fala com o solicitante: pede confirmação. Desligar e sombra são imediatos.
  const changeMode = (key: string, mode: AiAgentMode) => {
    if (mode !== 'apply') return void saveMode(key, mode)
    setConfirmApply({ key, name: status?.agents.find(a => a.key === key)?.name ?? key })
  }

  const loadChanges = useCallback(async () => {
    setChangesLoading(true)
    try {
      const r = await changesQuery()
      setChanges(r.data); setChangesCursor(r.next_cursor)
    } catch {
      setError('Não foi possível carregar as alterações feitas pela IA.')
    } finally {
      setChangesLoading(false)
    }
  }, [changesQuery])

  const feedbackQuery = useCallback((c?: string) =>
    aiService.getFeedback({ field: fbField || undefined, days, limit: PAGE, cursor: c }),
  [fbField, days])
  // Só busca com a aba aberta; `alive` descarta resposta de filtro antigo.
  useEffect(() => {
    if (tab !== 'feedback') return
    let alive = true
    setFeedbackLoading(true); setFbError(null)
    feedbackQuery()
      .then(r => { if (alive) { setFeedback(r.data); setFeedbackCursor(r.next_cursor) } })
      .catch(() => { if (alive) setFbError('Não foi possível carregar as correções humanas.') })
      .finally(() => { if (alive) setFeedbackLoading(false) })
    return () => { alive = false }
  }, [tab, feedbackQuery])
  // Acurácia por campo (aba Qualidade): mesmo período do painel, em dias de São Paulo
  useEffect(() => {
    if (tab !== 'quality') return
    let alive = true
    aiService.getInsights({ from: spDate(days - 1), to: spDate() }).then(r => { if (alive) setInsights(r) }).catch(() => { if (alive) setInsights(null) })
    return () => { alive = false }
  }, [tab, days])

  useEffect(() => { load() }, [load])

  // Últimas execuções sem filtro: latência por agente e detalhe do chamado
  const loadRecent = useCallback(async () => {
    try { setRecentRuns((await aiService.getRecentRuns(100)).data) } catch { /* fica sem latência por agente */ }
  }, [])
  useEffect(() => { loadRecent() }, [loadRecent])

  // Ao vivo: cada execução gravada no backend chega por socket ('ai:run'). Buscamos as últimas já no formato
  // completo, somamos às recentes, ao feed de logs (se bate no filtro) e às contagens.
  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const [recent, s] = await Promise.all([aiService.getRecentRuns(20), aiService.getStatus()])
        setStatus(s)
        setRecentRuns(prev => {
          const known = new Set(prev.map(r => r.id))
          const fresh = recent.data.filter(r => !known.has(r.id))
          return fresh.length ? [...fresh, ...prev].slice(0, RECENT_CAP) : prev
        })
        const f = filtersRef.current
        setRuns(prev => {
          const known = new Set(prev.map(r => r.id))
          const fresh = recent.data.filter(r => !known.has(r.id) && (!f.agent || r.agent === f.agent) && (!f.runStatus || r.status === f.runStatus))
          return fresh.length ? [...fresh, ...prev] : prev
        })
      } catch { /* próxima execução tenta de novo */ }
    }
    const onRun = () => { clearTimeout(timer); timer = setTimeout(refresh, 600) }
    socket.on('ai:run', onRun)
    return () => { clearTimeout(timer); socket.off('ai:run', onRun) }
  }, [accessToken])
  useEffect(() => { loadChanges() }, [loadChanges])

  async function more(which: 'runs' | 'changes' | 'feedback') {
    const c = which === 'runs' ? cursor : which === 'changes' ? changesCursor : feedbackCursor
    if (!c) return
    setLoadingMore(which)
    try {
      if (which === 'runs') {
        const r = await runsQuery(c)
        setRuns(prev => [...prev, ...r.data]); setCursor(r.next_cursor)
      } else if (which === 'feedback') {
        const r = await feedbackQuery(c)
        setFeedback(prev => [...prev, ...r.data]); setFeedbackCursor(r.next_cursor)
      } else {
        const r = await changesQuery(c)
        setChanges(prev => [...prev, ...r.data]); setChangesCursor(r.next_cursor)
      }
    } catch {
      if (which === 'feedback') setFbError('Não foi possível carregar mais correções.')
      else setError(which === 'runs' ? 'Não foi possível carregar mais execuções.' : 'Não foi possível carregar mais alterações.')
    } finally {
      setLoadingMore('')
    }
  }

  // Setas trocam de aba (padrão WAI-ARIA de tabs).
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = TABS.findIndex(t => t.id === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
    setTab(next)
    document.getElementById(`ai-tab-${next}`)?.focus()
  }

  // Ver os logs de um agente filtra o painel por ele; de novo, limpa.
  const selectAgent = (key: string) => {
    setAgent(a => (a === key ? '' : key))
    setTab('logs')
  }

  const agentName = (key: string) => status?.agents.find(a => a.key === key)?.name ?? key
  const period = PERIODS.find(p => p.days === days)?.label ?? `${days} dias`
  const totals = (metrics?.changes?.by_field ?? []).reduce((t, f) => ({ applied: t.applied + f.applied, proposed: t.proposed + f.proposed }), { applied: 0, proposed: 0 })

  const active = status?.agents.filter(a => a.active).length ?? 0
  const engineTitle = !status ? 'Conectando…' : !status.configured ? 'LLM não configurado' : active > 0 ? 'Motor online' : 'Motor em espera'
  const engineSub = !status ? '' : !status.configured
    ? 'Configure em Configurar > Provedor de IA para os agentes executarem.'
    : active > 0 ? 'Agentes processando chamados conforme o modo de cada um.' : 'Nenhum agente ligado.'

  const runGroups = byTicket(runs)
  const changeGroups = byTicket(changes)
  // Detalhe de um chamado: execuções do feed e as recentes juntas
  const info = useMemo(() => {
    if (infoKey == null) return null
    const seen = new Set<string>()
    const all = [...runs, ...recentRuns].filter(r => (r.ticket?.id ?? '') === infoKey && !seen.has(r.id) && seen.add(r.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return all.length ? { ticket: all[0].ticket, items: all } : null
  }, [infoKey, runs, recentRuns])

  const panel = (id: TabId) => ({ role: 'tabpanel', id: `ai-panel-${id}`, 'aria-labelledby': `ai-tab-${id}`, hidden: tab !== id })

  return (
    <div className="adm ai-engine" aria-busy={loading}>
      <PageHeader
        title="Agentes de IA"
        subtitle="O que cada agente fez nos chamados e os controles"
        actions={<Btn variant="secondary" size="sm" onClick={() => { load(); loadChanges(); loadRecent() }} disabled={loading}>Atualizar</Btn>}
      />

      <div className="adm-body">
        <div>
          <div className="notice" role="status">
            <strong style={{ fontWeight: 600, color: status && !status.configured ? 'var(--danger)' : 'var(--text-1)' }}>{engineTitle}</strong>{engineSub && <span>{'. '}{engineSub}</span>}
          </div>
          {[error, modeError].filter(Boolean).map(msg => <p key={msg} role="alert" className="adm-error" style={{ paddingTop: 12 }}>{msg}</p>)}
        </div>

        <section aria-label={`Números dos últimos ${period}`}>
          <div className="adm-filters" style={{ paddingTop: 0 }}>
            <label>Agente
              <Sel value={agent} onChange={e => setAgent(e.target.value)} style={selStyle}>
                <option value="">Todos os agentes</option>
                {status?.agents.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}
              </Sel>
            </label>
            <label>Período
              <Sel value={days} onChange={e => setDays(Number(e.target.value))} style={selStyle}>
                {PERIODS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
              </Sel>
            </label>
          </div>
          {metrics && (
            <Figures>
              <StatCard label="Execuções" value={fmtInt(metrics.runs)} sub={`Últimos ${period}`} />
              <StatCard label="Taxa de erro" value={fmtPct(metrics.error_rate)} sub={<span style={errorTone(metrics.errors > 0)}>{fmtInt(metrics.errors)} com erro</span>} />
              <StatCard label="Latência p50" value={fmtMs(metrics.latency_p50_ms)} sub={`p95: ${fmtMs(metrics.latency_p95_ms)}`} />
              <StatCard label="Aplicadas" value={fmtInt(totals.applied)} sub="Gravadas no chamado" />
              <StatCard label="Sugestões (sombra)" value={fmtInt(totals.proposed)} sub="O que mudaria" />
              <StatCard label="Tokens" value={fmtInt(metrics.input_tokens + metrics.output_tokens)} sub={`${fmtInt(metrics.input_tokens)} entrada · ${fmtInt(metrics.output_tokens)} saída`} />
              <StatCard label="Custo estimado" value={fmtUsd(metrics.cost_usd)} sub="US$ 0,44/M entrada · 1,76/M saída" />
            </Figures>
          )}
        </section>

        <section className="adm-section" aria-labelledby="ai-agents-title">
          <h2 id="ai-agents-title" className="adm-h">Agentes</h2>
          {status ? <>
            <p className="adm-note">{active} de {status.agents.length} ativos{status.model ? ` · modelo ${status.model}` : ''}</p>
            <div className="adm-scroll">
              <table className="table" aria-labelledby="ai-agents-title">
                <thead><tr>{['Agente', 'Estado', 'Execuções', 'Erros', 'Latência', 'Ação'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {status.agents.map(a => (
                    <AgentRow key={a.key} a={a} configured={status.configured} busy={modeBusy === a.key} filtered={agent === a.key}
                      latency={median(recentRuns.filter(r => r.agent === a.key).map(r => r.latency_ms))}
                      onModeChange={m => changeMode(a.key, m)} onFilter={() => selectAgent(a.key)} />
                  ))}
                </tbody>
              </table>
            </div>
          </> : loading ? <Loading size="compact" /> : <Empty>Sem dados dos agentes.</Empty>}
        </section>

        <Card role="region" aria-label="Atividade dos agentes" style={{ paddingTop: 16 }}>
          <div role="tablist" aria-label="Seções dos agentes de IA" className="subtabs" style={{ marginLeft: -14 }} onKeyDown={onTabKey}>
            {TABS.map(t => {
              const on = t.id === tab
              return <button key={t.id} id={`ai-tab-${t.id}`} role="tab" type="button" aria-selected={on} aria-controls={`ai-panel-${t.id}`} tabIndex={on ? 0 : -1} onClick={() => setTab(t.id)}>{t.label}</button>
            })}
          </div>

          <div {...panel('logs')}>
            <div className="adm-filters">
              <label>Status
                <Sel value={runStatus} onChange={e => setRunStatus(e.target.value)} style={selStyle}>
                  <option value="">Todos</option>
                  <option value="ok">OK</option>
                  <option value="error">Erro</option>
                </Sel>
              </label>
            </div>
            {runGroups.length === 0
              ? (loading ? <Loading size="compact" /> : <Empty>Nenhuma execução registrada ainda.</Empty>)
              : <ul className="adm-rows">
                  {runGroups.map(g => (
                    <TicketLog key={g.ticket?.id ?? ''} ticket={g.ticket} runs={g.items} agentName={agentName} onOpenTicket={onOpenTicket} onInfo={() => setInfoKey(g.ticket?.id ?? '')} />
                  ))}
                </ul>}
            {cursor && <LoadMore onClick={() => more('runs')} busy={loadingMore === 'runs'} />}
          </div>

          <div {...panel('changes')}>
            <div className="adm-filters">
              <label>Campo
                <Sel value={field} onChange={e => setField(e.target.value)} style={selStyle}>
                  <option value="">Todos</option>
                  {CHANGE_FIELDS.map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </Sel>
              </label>
              <label>Tipo
                <Sel value={kind} onChange={e => setKind(e.target.value as '' | AiChangeKind)} style={selStyle}>
                  <option value="">Aplicados e sugeridos</option>
                  <option value="applied">Aplicados</option>
                  <option value="proposed">Sugeridos (sombra)</option>
                </Sel>
              </label>
            </div>
            <p className="adm-note" style={{ paddingBottom: 16 }}>Como era e como ficou, por chamado · últimos {period}{agent ? ` · ${agentName(agent)}` : ''}</p>
            {metrics?.changes && <ChangesSummary changes={metrics.changes} />}
            {changeGroups.length > 0
              ? <ul className="adm-rows">
                  {changeGroups.map(g => <TicketChanges key={g.ticket?.id ?? ''} ticket={g.ticket} rows={g.items} onOpenTicket={onOpenTicket} />)}
                </ul>
              : changesLoading ? <Loading size="compact" /> : <Empty>Nenhuma alteração registrada no período.</Empty>}
            {changesCursor && <LoadMore onClick={() => more('changes')} busy={loadingMore === 'changes'} />}
          </div>

          <div {...panel('quality')}>
            <p className="adm-note" style={{ padding: '16px 0' }}>% das decisões acima do limiar de confiança</p>
            {metrics && metrics.fields.length > 0
              ? <div className="adm-scroll"><table className="table">
                  <thead><tr><th scope="col">Campo</th><th scope="col" style={{ width: '45%' }}>Aplicaria</th><th scope="col">Decisões</th><th scope="col">Confiança média</th></tr></thead>
                  <tbody>
                    {metrics.fields.map(f => (
                      <tr key={f.key}>
                        <td>{FIELD_LABEL[f.key] ?? f.key}</td>
                        <td>
                          <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(60px, 1fr)', gap: 12, alignItems: 'center' }}>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPct(f.would_apply_rate)}</span>
                            <Meter value={f.would_apply_rate} label={`Aplicaria em ${FIELD_LABEL[f.key] ?? f.key}`} />
                          </div>
                        </td>
                        <td>{fmtInt(f.would_apply)}/{fmtInt(f.total)}</td>
                        <td>{fmtConf(f.avg_confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              : <Empty>Sem decisões no período.</Empty>}
            {insights && !insights.empty && (
              <div style={{ paddingTop: 28, maxWidth: 720 }}>
                <h3 className="adm-h">Acurácia por campo (chamados resolvidos)</h3>
                <p className="adm-note" style={{ padding: '2px 0 16px' }}>Valor da IA × valor final · últimos {period}</p>
                <AccuracyBars rows={insights.accuracy} />
              </div>
            )}
          </div>

          <div {...panel('feedback')}>
            <div className="adm-filters">
              <label>Campo da correção
                <Sel value={fbField} onChange={e => setFbField(e.target.value)} style={selStyle}>
                  <option value="">Todos</option>
                  {FEEDBACK_FIELDS.map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </Sel>
              </label>
            </div>
            <p className="adm-note" style={{ paddingBottom: 16 }}>Campos que a IA decidiu e uma pessoa corrigiu · últimos {period}</p>
            {fbError && <p role="alert" className="adm-error" style={{ paddingBottom: 12 }}>{fbError}</p>}
            {feedback.length > 0
              ? <ul className="adm-rows" aria-label="Correções humanas">
                  {feedback.map(f => (
                    <li key={f.id}>
                      <div style={{ minWidth: 0 }}>
                        <span>{f.user.name} {f.accepted ? 'aceitou a sugestão de' : 'corrigiu'} {FIELD_LABEL[f.field] ?? f.field} no</span>{' '}
                        <TicketLink ticket={f.ticket} onOpenTicket={onOpenTicket} />
                      </div>
                      <div className="ai-line">
                        <span>IA {f.ai_label ?? f.ai_value ?? '—'} · {f.from_label ?? f.from_value ?? '—'} → <strong style={{ fontWeight: 500 }}>{f.to_label ?? f.to_value ?? '—'}</strong></span>
                        <small style={{ marginLeft: 'auto' }}><time dateTime={f.created_at}>{fmtDate(f.created_at)}</time></small>
                      </div>
                    </li>
                  ))}
                </ul>
              : feedbackLoading ? <Loading size="compact" /> : <Empty>Nenhuma correção humana no período.</Empty>}
            {feedbackCursor && <LoadMore onClick={() => more('feedback')} busy={loadingMore === 'feedback'} />}
          </div>
        </Card>
      </div>

      <Modal isOpen={!!info} onClose={() => setInfoKey(null)} width={780}
        title={info?.ticket ? `${info.ticket.display_number} · ${info.ticket.title}` : 'Execuções sem chamado'}>
        {info && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px 16px', flexWrap: 'wrap', paddingBottom: 16, fontSize: 13, color: 'var(--text-3)' }}>
            <span>{info.items.length} execuç{info.items.length === 1 ? 'ão' : 'ões'}</span>
            <span>{fmtInt(info.items.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0))} tokens</span>
            <span>{fmtMs(info.items.reduce((s, r) => s + r.latency_ms, 0))} de processamento</span>
            {info.ticket && onOpenTicket && (
              <Btn variant="secondary" size="sm" style={{ marginLeft: 'auto' }}
                onClick={() => { const id = info.ticket!.id; setInfoKey(null); onOpenTicket(id) }}>
                Abrir chamado
              </Btn>
            )}
          </div>
          <ul aria-label="Execuções detalhadas" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {info.items.map(r => <RunDetail key={r.id} run={r} agentName={agentName(r.agent)} />)}
          </ul>
        </>}
      </Modal>
      <ConfirmModal
        isOpen={!!confirmApply}
        onClose={() => setConfirmApply(null)}
        onConfirm={() => { if (confirmApply) void saveMode(confirmApply.key, 'apply') }}
        title={`Ligar ${confirmApply?.name ?? ''} em modo Aplicar?`}
        message={`${APPLY_EFFECT[confirmApply?.key ?? ''] ?? 'O agente passará a agir nos chamados novos.'} Vale imediatamente. Para voltar, escolha Sombra ou Desligado.`}
        confirmText="Ligar em modo Aplicar"
      />
    </div>
  )
}
