import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Btn, Inp, StatusBadge } from '@/components/ui'
import { listTaskTickets, linkTicketToTask, linkTicketsBulk, unlinkTicketFromTask, TaskTicket } from '@/services/projectsService'
import { apiErrorMessage } from '@/services/api'
import { ForecastOverdueBadge } from '@/components/projects/TicketProjectLink'
import { toast } from '@/store/toastStore'
import './projects.css'

/** "ISA-1, ISA-2 ISA-3" → ['ISA-1', 'ISA-2', 'ISA-3'] (vírgula, ponto e vírgula, espaço ou quebra de linha). */
export const splitTicketRefs = (text: string) => [...new Set(text.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean))]

/**
 * Chamados vinculados à task (ponte chamado ↔ task). Vincular tira o chamado
 * do SLA: ele passa a seguir o prazo desta task e é resolvido quando ela conclui.
 * Aceita vários números de uma vez; o lote não é atômico e lista quem falhou.
 */
export function TaskTicketsSection({ projectId, taskId, hasDueDate, canEdit, refreshKey }: {
  projectId: string
  taskId: string
  hasDueDate: boolean
  canEdit: boolean
  /** Muda quando o status da task muda: concluir resolve os chamados no servidor, a lista recarrega. */
  refreshKey?: string
}) {
  const [tickets, setTickets] = useState<TaskTicket[]>([])
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<Array<{ ref: string; error: string }>>([])

  const activeRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    listTaskTickets(projectId, taskId).then((list) => {
      const isActive = (t: TaskTicket) => t.status === 'pending' && t.pendingReason === 'pending_project'
      const resolved = list.filter((t) => activeRef.current.has(t.id) && t.status === 'resolved')
      if (resolved.length) toast.success(`${resolved.length === 1 ? `Chamado ${resolved[0].displayNumber} resolvido` : `${resolved.length} chamados resolvidos`} com a conclusão da task.`)
      activeRef.current = new Set(list.filter(isActive).map((t) => t.id))
      setTickets(list)
    }).catch(() => setTickets([]))
  }, [projectId, taskId, refreshKey])

  const refs = splitTicketRefs(ref)

  async function link() {
    if (!refs.length) return
    setBusy(true)
    setError(null)
    setFailed([])
    try {
      if (refs.length === 1) {
        setTickets(await linkTicketToTask(projectId, taskId, refs[0]))
        setRef('')
      } else {
        const res = await linkTicketsBulk(projectId, taskId, refs)
        setTickets(res.tickets)
        setFailed(res.failed)
        setRef(res.failed.map((f) => f.ref).join(', ')) // sobra só o que falhou, para corrigir e tentar de novo
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível vincular este chamado.'))
    } finally {
      setBusy(false)
    }
  }

  async function unlink(ticketId: string) {
    setError(null)
    try {
      await unlinkTicketFromTask(projectId, taskId, ticketId)
      setTickets((prev) => prev.filter((t) => t.id !== ticketId))
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível desvincular.'))
    }
  }

  return (
    <div>
      <h3 className="tk-h">Chamados vinculados{tickets.length > 0 && <small>{tickets.length}</small>}</h3>
      {tickets.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {tickets.map((t) => {
            const active = t.status === 'pending' && t.pendingReason === 'pending_project'
            return (
              <div key={t.id} className="tk-line">
                <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{t.displayNumber}</span>
                <span className="tk-text pj-cut" title={t.title}>{t.title}</span>
                {active && t.projectForecastAlertedAt && <ForecastOverdueBadge compact />}
                {active
                  ? <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Em projeto</span>
                  : <StatusBadge status={t.status as any} />}
                {canEdit && active && (
                  <button title="Desvincular (volta ao atendimento e o SLA retoma)" aria-label={`Desvincular ${t.displayNumber}`} onClick={() => unlink(t.id)}
                    className="icon-act">
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canEdit && (
        hasDueDate ? (
          <div className="tk-add" style={{ flexWrap: 'nowrap' }}>
            <Inp aria-label="Números dos chamados" value={ref} onChange={(e: any) => setRef(e.target.value)} placeholder="Nº do chamado — vários separados por vírgula"
              onKeyDown={(e: any) => { if (e.key === 'Enter') link() }} />
            <Btn variant="secondary" size="sm" onClick={link} disabled={busy || !refs.length}>
              {busy ? 'Vinculando…' : refs.length > 1 ? `Vincular ${refs.length}` : 'Vincular'}
            </Btn>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Defina o prazo da task para vincular chamados — eles passam a seguir esse prazo.</div>
        )
      )}
      {failed.length > 0 && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{failed.length} não vinculado{failed.length > 1 ? 's' : ''}:</span>
          {failed.map((f) => <span key={f.ref}>{f.ref} — {f.error}</span>)}
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      {tickets.length === 0 && !canEdit && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Nenhum chamado vinculado.</div>}
    </div>
  )
}
