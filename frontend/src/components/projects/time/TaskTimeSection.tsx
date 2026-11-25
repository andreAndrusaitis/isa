import { useEffect, useState } from 'react'
import { getTaskTime, TaskTime } from '@/services/projectsService'
import { fmtMinutes } from '@/utils/duration'
import { TimeBars, RunningTag } from './TimeBars'

const label = { fontSize: 13, color: 'var(--text-3)' }
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null)

/**
 * Tempo da task no drawer: horas úteis em andamento/revisão (backlog e a fazer
 * pausam; concluída para), por status e por pessoa. `refreshKey` muda quando o
 * status/responsável muda no drawer, para recalcular.
 */
export function TaskTimeSection({ projectId, taskId, refreshKey }: { projectId: string; taskId: string; refreshKey?: string }) {
  const [time, setTime] = useState<TaskTime | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
    getTaskTime(projectId, taskId).then(setTime).catch(() => setError(true))
  }, [projectId, taskId, refreshKey])

  return (
    <section aria-label="Tempo da task">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Tempo</div>
        {time?.running && <RunningTag />}
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Não foi possível calcular o tempo.</div>}
      {time && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 26, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtMinutes(time.activeMinutes)}</span>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              em andamento (horas úteis) · {fmtMinutes(time.wallActiveMinutes)} corridas
            </span>
          </div>
          {(time.startedAt || time.completedAt) && (
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {time.startedAt && <>Começou {fmtDate(time.startedAt)}</>}
              {time.completedAt && <> · Concluída {fmtDate(time.completedAt)}</>}
            </div>
          )}
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Por status</div>
            <TimeBars rows={time.byStatus.map((s) => ({ key: s.statusId, label: s.name, minutes: s.minutes, muted: s.category !== 'in_progress' && s.category !== 'in_review' }))} />
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>Só "em andamento" e "em revisão" contam; os demais aparecem em cinza (pausa).</div>
          </div>
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Por pessoa</div>
            <TimeBars rows={time.byPerson.map((p) => ({ key: p.userId ?? 'none', label: p.name, minutes: p.minutes }))} empty="Ainda não houve tempo em andamento." />
          </div>
        </div>
      )}
    </section>
  )
}
