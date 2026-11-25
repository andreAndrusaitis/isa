import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Btn, Loading, Meter } from '@/components/ui'
import { taskLabel } from '@/components/projects/taskKey'
import { fmtMinutes } from '@/utils/duration'
import type { DrillTaskRow } from '@/services/drillService'
import type { ProjectHealth } from '@/components/projects/projectHealth'
import { useDrill } from './drillContext'
import '@/components/projects/insights/projects.css'
import './drill.css'

export const fmtHours = (h: number | null | undefined) => (h == null ? '—' : `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`)
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

/**
 * Linha de tabela que abre o detalhe. O teclado usa o botão da primeira célula
 * (DrillLink); clicar em outro botão ou selecionar texto não abre.
 */
export function ClickableRow({ onOpen, children, style }: { onOpen: () => void; children: ReactNode; style?: CSSProperties }) {
  const click = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea')) return
    if (window.getSelection()?.toString()) return
    onOpen()
  }
  return <tr className="isa-drill-row" onClick={click} style={style}>{children}</tr>
}

export function DrillLink({ onClick, children, title, style }: { onClick: () => void; children: ReactNode; title?: string; style?: CSSProperties }) {
  return <button type="button" className="isa-drill-link" onClick={onClick} title={title ?? (typeof children === 'string' ? children : undefined)} style={style}>{children}</button>
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="prj-note">{children}</p>

const HEALTH: Record<ProjectHealth, { label: string; color: string }> = {
  healthy: { label: 'Saudável', color: 'var(--text-1)' },
  warning: { label: 'Atenção', color: 'var(--warning)' },
  risk: { label: 'Em risco', color: 'var(--danger)' },
}

/** Saúde em texto: só o que pede atenção ganha cor. */
export function HealthPill({ health }: { health: ProjectHealth }) {
  const h = HEALTH[health]
  return <span style={{ color: h.color, fontWeight: health === 'risk' ? 600 : 400, whiteSpace: 'nowrap' }}>{h.label}</span>
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="prj-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progresso'}>
      <Meter value={value} />
      <span>{value}%</span>
    </div>
  )
}

/** Tabela de tasks do modal: cada linha abre a task. `extra` escolhe a última coluna. */
export function DrillTaskTable({ rows, showProject = true, extra = 'hours', ariaLabel }: {
  rows: DrillTaskRow[]; showProject?: boolean; extra?: 'hours' | 'cycle' | 'done'; ariaLabel: string
}) {
  const { open } = useDrill()
  const openTask = (t: DrillTaskRow) => open({ kind: 'task', projectId: t.projectId, taskId: t.taskId, title: `${taskLabel(t)} ${t.title}` })
  return (
    <div className="prj-scroll">
      <table aria-label={ariaLabel} className="table prj">
        <thead>
          <tr>
            <th>Task</th>
            {showProject && <th>Projeto</th>}
            <th>Status</th>
            <th>Responsável</th>
            <th>{extra === 'done' ? 'Concluída' : 'Prazo'}</th>
            <th className="num">{extra === 'hours' ? 'Horas' : 'Ciclo'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <ClickableRow key={t.taskId} onOpen={() => openTask(t)}>
              <td style={{ minWidth: 200 }}>
                <DrillLink onClick={() => openTask(t)}>
                  <span style={{ color: 'var(--text-3)', marginRight: 6, whiteSpace: 'nowrap' }}>{taskLabel(t)}</span>{t.title}
                </DrillLink>
              </td>
              {showProject && <td>{t.projectName}</td>}
              <td>{t.status.name}</td>
              <td>{t.assignee?.name ?? '—'}</td>
              <td className={t.overdue ? 'late' : undefined} style={{ whiteSpace: 'nowrap' }}>
                {fmtDate(extra === 'done' ? t.completedAt : t.dueDate)}{t.overdue ? ' · atrasada' : ''}
              </td>
              <td className="num">{extra === 'hours' ? (t.activeMinutes > 0 ? fmtMinutes(t.activeMinutes) : '—') : fmtHours(t.cycleHours)}</td>
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Carrega os dados da visão, com estado de erro e "tentar de novo". */
export function useDrillData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setData(null); setFailed(false)
    load().then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { data, failed, retry }
}

export function DrillLoading() {
  return <Loading size="compact" label="Carregando detalhes…" />
}

export function DrillError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ padding: '8px 0 16px', fontSize: 14, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
      Não foi possível carregar estes detalhes. Se o problema continuar, você pode não ter acesso a eles.
      <Btn variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Btn>
    </div>
  )
}
