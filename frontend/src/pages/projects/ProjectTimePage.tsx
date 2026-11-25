import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EmptyState, Figures, StatCard, Loading } from '@/components/ui'
import { getProjectTime, ProjectTime, getProjectInsights } from '@/services/projectsService'
import { Section } from '@/components/projects/insights/Section'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { useInsights } from '@/components/projects/insights/DeliveryInsights'
import { fmtMinutes } from '@/utils/duration'
import { TimeBars, RunningTag } from '@/components/projects/time/TimeBars'
import { taskLabel } from '@/components/projects/taskKey'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink } from '@/components/projects/drill/drillUi'

const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

/** Aba Tempo: horas úteis em andamento/revisão por task, média por task concluída e por pessoa. */
export default function ProjectTimePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { open } = useDrill()
  const [data, setData] = useState<ProjectTime | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!projectId) return
    getProjectTime(projectId).then(setData).catch(() => setError(true))
  }, [projectId])

  const withTime = data?.tasks.filter((t) => t.activeMinutes > 0 || t.running) ?? []

  return (
    <div className="prj-body" style={{ gap: 36 }}>
      <p className="prj-note">Horas úteis em andamento e revisão. Backlog e a fazer pausam; concluída para de contar.</p>
      {error && <EmptyState title="Não foi possível carregar o tempo do projeto." />}
      {!data && !error && <Loading label="Calculando…" />}
      {data && (
        <>
          <Figures>
            <StatCard label="Em andamento agora" value={data.totals.runningTasks} />
            <StatCard label="Horas no projeto" value={fmtMinutes(data.totals.activeMinutes)} />
            <StatCard label="Média por task concluída" value={fmtMinutes(data.totals.avgMinutesPerDoneTask)} sub={`${data.totals.doneTasks} task(s) concluída(s)`} />
          </Figures>

          <Section title="Horas por task">
            {withTime.length === 0 ? (
              <p className="prj-note">Nenhuma task passou por andamento ainda. O tempo começa a contar quando a task vai para um status de andamento ou revisão.</p>
            ) : (
              <div className="prj-scroll">
                <table className="table prj" aria-label="Horas por task" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Status</th>
                      <th scope="col">Começou</th>
                      <th scope="col">Concluiu</th>
                      <th className="num" scope="col">Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withTime.map((t) => {
                      const details = () => open({ kind: 'task', projectId: projectId!, taskId: t.taskId, title: `${taskLabel(t)} ${t.title}` })
                      return (
                        <ClickableRow key={t.taskId} onOpen={details}>
                          <td>
                            <DrillLink onClick={details}>
                              <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{taskLabel(t)}</span> {t.title}
                            </DrillLink>
                          </td>
                          <td>{t.running ? <RunningTag /> : t.status?.name ?? '—'}</td>
                          <td>{fmtDay(t.startedAt)}</td>
                          <td>{fmtDay(t.completedAt)}</td>
                          <td className="num">{fmtMinutes(t.activeMinutes)}</td>
                        </ClickableRow>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <div className="prj-cols">
            <Section title="Horas por pessoa" sub="Cada trecho conta para quem era o responsável naquele momento.">
              <TimeBars rows={data.byPerson.map((p) => ({ key: p.userId ?? 'none', label: p.name, minutes: p.activeMinutes, canOpen: !!p.userId }))}
                onSelect={(r) => open({ kind: 'person', userId: r.key, projectId, title: r.label })} />
            </Section>
            {projectId && <DailyHoursChart projectId={projectId} />}
          </div>
        </>
      )}
    </div>
  )
}

/** Horas úteis por dia (barras), tasks concluídas e média móvel de 7 dias das horas (linhas). */
function DailyHoursChart({ projectId }: { projectId: string }) {
  const { data } = useInsights(() => getProjectInsights(projectId), [projectId])
  if (!data) return null
  const days = data.daily.slice(-30)
  const rows = days.map((d, i) => {
    const win = days.slice(Math.max(0, i - 6), i + 1)
    return { x: d.date, hours: d.hours, completed: d.completed, avg: Math.round((win.reduce((n, w) => n + w.hours, 0) / win.length) * 10) / 10 }
  })
  const totalH = rows.reduce((n, r) => n + r.hours, 0)
  return (
    <Section title="Ritmo dos últimos 30 dias" sub="Horas úteis em andamento/revisão por dia e média de 7 dias; o tooltip traz as tasks concluídas no dia"
      footer={`${Math.round(totalH)}h no período · ${rows.reduce((n, r) => n + r.completed, 0)} task(s) concluída(s)`}>
      <TimeSeriesChart ariaLabel="Horas por dia e tasks concluídas" height={250} data={rows}
        format={(v, k) => (k === 'completed' ? `${v}` : `${v.toLocaleString('pt-BR')}h`)}
        series={[
          { key: 'hours', label: 'Horas úteis', color: 'var(--text-3)', type: 'bar' },
          { key: 'avg', label: 'Média 7 dias (h)', color: 'var(--accent)', type: 'line' },
          { key: 'completed', label: 'Tasks concluídas', color: 'var(--text-2)', tooltipOnly: true },
        ]} />
    </Section>
  )
}
