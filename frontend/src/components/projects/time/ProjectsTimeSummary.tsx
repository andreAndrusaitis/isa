import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '@/components/ui'
import { getPortfolioTime, listLinkedTickets, PortfolioTime, LinkedTicket } from '@/services/projectsService'
import { fmtMinutes } from '@/utils/duration'
import { Section } from '@/components/projects/insights/Section'
import { TimeBars } from './TimeBars'
import { taskLabel } from '@/components/projects/taskKey'
import { fmtForecast, isForecastOverdue, ForecastOverdueBadge } from '@/components/projects/TicketProjectLink'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink } from '@/components/projects/drill/drillUi'

function since(d: string | null) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
  return days <= 0 ? 'hoje' : days === 1 ? 'há 1 dia' : `há ${days} dias`
}

/** Gestão nos Dashboards de Projetos: horas por projeto/pessoa e chamados que estão em projetos. */
export function ProjectsTimeSummary() {
  const { open } = useDrill()
  const [time, setTime] = useState<PortfolioTime | null>(null)
  const [tickets, setTickets] = useState<LinkedTicket[] | null>(null)

  useEffect(() => {
    getPortfolioTime().then(setTime).catch(() => setTime({ projects: [], byPerson: [] }))
    listLinkedTickets().then(setTickets).catch(() => setTickets([]))
  }, [])

  return (
    <>
      <div className="prj-cols">
        <Section title="Horas por pessoa" sub="Horas úteis em andamento ou revisão.">
          {time ? <TimeBars rows={time.byPerson.map((p) => ({ key: p.userId ?? 'none', label: p.name, minutes: p.activeMinutes, canOpen: p.canOpen }))}
            onSelect={(r) => open({ kind: 'person', userId: r.key, title: r.label })} /> : <Loading size="compact" label="Calculando…" />}
        </Section>
        <Section title="Horas por projeto" sub="Nos projetos de que você participa.">
          {!time ? <Loading size="compact" label="Calculando…" /> : time.projects.length === 0 ? (
            <p className="prj-note">Nenhum projeto.</p>
          ) : (
            <div className="prj-scroll">
              <table className="table prj">
                <thead>
                  <tr>
                    <th scope="col">Projeto</th>
                    <th className="num" scope="col">Horas</th>
                    <th className="num" scope="col">Média por concluída</th>
                    <th className="num" scope="col">Em andamento</th>
                  </tr>
                </thead>
                <tbody>
                  {time.projects.map((p) => {
                    const details = () => open({ kind: 'project', projectId: p.projectId, title: p.name })
                    return (
                      <ClickableRow key={p.projectId} onOpen={details}>
                        <td style={{ minWidth: 160 }}><DrillLink onClick={details}>{p.name}</DrillLink></td>
                        <td className="num">{fmtMinutes(p.activeMinutes)}</td>
                        <td className="num">{fmtMinutes(p.avgMinutesPerDoneTask)}</td>
                        <td className="num">{p.runningTasks}</td>
                      </ClickableRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section title={tickets ? `Chamados em projeto (${tickets.length})` : 'Chamados em projeto'} sub="Fora do SLA, seguindo o prazo da task. Quem vinculou e há quanto tempo, para acompanhar.">
        {!tickets ? <Loading size="compact" /> : tickets.length === 0 ? (
          <p className="prj-note">Nenhum chamado vinculado a tasks agora.</p>
        ) : (
          <div className="prj-scroll">
            <table className="table prj">
              <thead>
                <tr>
                  <th scope="col">Chamado</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Projeto › Task</th>
                  <th scope="col">Previsão</th>
                  <th scope="col">Vinculado por</th>
                  <th scope="col">Em projeto</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const task = t.projectTask
                  const details = () => { if (task) open({ kind: 'task', projectId: task.project.id, taskId: task.id, title: `${taskLabel(task)} ${task.title}` }) }
                  return (
                    <ClickableRow key={t.id} onOpen={details}>
                      <td><Link to={`/c/${t.id}`} style={{ color: 'var(--accent-fg)' }}>{t.displayNumber}</Link> {t.title}</td>
                      <td>{t.org?.name ?? '—'}</td>
                      <td>{task ? <DrillLink onClick={details}>{task.project.name} › {taskLabel(task)} {task.title}</DrillLink> : '—'}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {fmtForecast(t.projectTask?.dueDate)}
                          {isForecastOverdue(t.projectTask?.dueDate) && <ForecastOverdueBadge compact />}
                        </span>
                      </td>
                      <td>{t.linkedBy ?? '—'}</td>
                      <td>{since(t.linkedAt)}</td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}
