import { Figures, StatCard } from '@/components/ui'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { getPersonDrill } from '@/services/drillService'
import { fmtMinutes } from '@/utils/duration'
import { Section } from '@/components/projects/insights/Section'
import { useDrill } from './drillContext'
import {
  ClickableRow, DrillError, DrillLink, DrillLoading, DrillTaskTable, Empty, fmtHours, useDrillData,
} from './drillUi'

export function PersonDrillView({ userId, projectId }: { userId: string; projectId?: string }) {
  const { open } = useDrill()
  const { data, failed, retry } = useDrillData(() => getPersonDrill(userId, projectId), [userId, projectId])
  if (failed) return <DrillError onRetry={retry} />
  if (!data) return <DrillLoading />

  const { person, totals } = data
  const tasks = (title: string, kind: 'open' | 'overdue' | 'running' | 'upcoming') =>
    projectId ? () => open({ kind: 'tasks', title: `${title} · ${person.name}`, query: { projectId, assigneeId: userId, kind } }) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <p className="prj-note">
        <strong style={{ fontWeight: 500, color: 'var(--text-1)' }}>{person.name}</strong>{' · '}
        {[person.department, person.manager && `Gestor: ${person.manager.name}`, data.scopedTo && `Em ${data.scopedTo}`].filter(Boolean).join(' · ') || 'Nos projetos que você acompanha'}
      </p>

      <Figures>
        <StatCard label="Abertas" value={totals.open} onClick={tasks('Abertas', 'open')} />
        <StatCard label="Atrasadas" value={totals.overdue} onClick={tasks('Atrasadas', 'overdue')} />
        <StatCard label="Em andamento" value={totals.running} onClick={tasks('Em andamento', 'running')} />
        <StatCard label="Próximos 7 dias" value={totals.upcoming} onClick={tasks('Próximos 7 dias', 'upcoming')} />
      </Figures>
      <Figures>
        <StatCard label={`Concluídas em ${data.days} dias`} value={totals.done} />
        <StatCard label="Ciclo médio" value={fmtHours(totals.avgCycleHours)} sub={`mediana ${fmtHours(totals.medianCycleHours)}`} />
        <StatCard label="Horas como responsável" value={fmtMinutes(totals.activeMinutes)} />
      </Figures>

      {data.weekly.some((w) => w.completed > 0) && (
        <Section small title="Entregas nas últimas 8 semanas">
          <TimeSeriesChart ariaLabel="Tasks concluídas por semana" height={150}
            data={data.weekly.map((w) => ({ x: w.weekStart, completed: w.completed }))}
            series={[{ key: 'completed', label: 'Concluídas', color: 'var(--accent)', type: 'bar' }]} />
        </Section>
      )}

      {!projectId && (
        <Section small title="Por projeto">
          {data.byProject.length === 0 ? <Empty>Sem tasks nos projetos que você acompanha.</Empty> : (
            <div className="prj-scroll">
              <table aria-label="Tasks da pessoa por projeto" className="table prj">
                <thead>
                  <tr>
                    <th>Projeto</th>
                    {['Abertas', 'Atrasadas', 'Em andamento', 'Concluídas', 'Ciclo médio'].map((h) => <th key={h} className="num">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.byProject.map((p) => {
                    const go = () => open({ kind: 'project', projectId: p.projectId, title: p.name })
                    return (
                      <ClickableRow key={p.projectId} onOpen={go}>
                        <td style={{ minWidth: 170 }}>
                          <DrillLink onClick={go}>{p.name}</DrillLink>
                        </td>
                        <td className="num">{p.open}</td>
                        <td className={p.overdue ? 'num late' : 'num'}>{p.overdue}</td>
                        <td className="num">{p.running}</td>
                        <td className="num">{p.done}</td>
                        <td className="num">{fmtHours(p.avgCycleHours)}</td>
                      </ClickableRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section small title={`Em andamento (${totals.running})`}>
        {data.running.length ? <DrillTaskTable rows={data.running} showProject={!projectId} ariaLabel="Tasks em andamento" /> : <Empty>Nada em andamento agora.</Empty>}
      </Section>
      <Section small title={`Atrasadas (${totals.overdue})`}>
        {data.overdue.length ? <DrillTaskTable rows={data.overdue} showProject={!projectId} ariaLabel="Tasks atrasadas" /> : <Empty>Nenhuma task atrasada.</Empty>}
      </Section>
      {data.upcoming.length > 0 && (
        <Section small title={`Próximos 7 dias (${totals.upcoming})`}>
          <DrillTaskTable rows={data.upcoming} showProject={!projectId} ariaLabel="Tasks dos próximos 7 dias" />
        </Section>
      )}
      <Section small title="Concluídas recentemente">
        {data.recent.length ? <DrillTaskTable rows={data.recent} showProject={!projectId} extra="done" ariaLabel="Tasks concluídas recentemente" /> : <Empty>Nenhuma concluída nos últimos {data.days} dias.</Empty>}
      </Section>
    </div>
  )
}
