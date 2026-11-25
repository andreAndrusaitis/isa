import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Figures, Meter, PageHeader, PriorityDot, StatCard, EmptyState, Btn, Loading } from '@/components/ui'
import { getMyArea, getProjectsActivity } from '@/services/projectsService'
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap'
import { MyArea } from '@/types/projects'
import { describeActivity } from './activityLabels'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink, ProgressBar } from '@/components/projects/drill/drillUi'
import { taskLabel } from '@/components/projects/taskKey'
import { Section } from '@/components/projects/insights/Section'
import { MyCycleByProject } from '@/components/projects/insights/MyCycleByProject'
import { useTaskDrawer } from '@/components/projects/taskDrawerContext'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default function MyAreaPage() {
  const navigate = useNavigate()
  const { open } = useDrill()
  const [data, setData] = useState<MyArea | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Task abre num drawer sobre a Minha área; ao fechar, os números se atualizam sem piscar.
  const { openTask } = useTaskDrawer(() => { getMyArea().then(setData).catch(() => {}) })

  function load() {
    setLoading(true)
    setError(null)
    getMyArea()
      .then(setData)
      .catch(() => setError('Não foi possível carregar a sua área.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  if (loading) {
    return (
      <Loading label="Carregando a sua área…" />
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={error}
        action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
      />
    )
  }

  if (!data) return null

  const { counts, priorities, agenda, recentProjects, recentActivity } = data
  const maxAgenda = Math.max(1, ...agenda.map((a) => a.count))

  return (
    <div>
      <PageHeader title="Minha área" subtitle="O que está com você hoje e nos próximos dias" />
      <div className="prj-body">
        <Figures>
          <StatCard label="Atrasadas" value={counts.overdue} onClick={() => navigate('/projetos/my-tasks?filter=overdue')} />
          <StatCard label="Hoje" value={counts.today} onClick={() => navigate('/projetos/my-tasks?filter=today')} />
          <StatCard label="Esta semana" value={counts.thisWeek} onClick={() => navigate('/projetos/my-tasks?filter=week')} />
          <StatCard label="Próximas" value={counts.upcoming} onClick={() => navigate('/projetos/my-tasks?filter=upcoming')} />
          <StatCard label="Aprovações" value={counts.approvals} />
        </Figures>

        <div className="prj-cols">
          <Section title="Prioridades" sub="Tarefas críticas ou de alta prioridade">
            {priorities.length === 0 ? <p className="prj-note">Nenhuma tarefa crítica ou de alta prioridade.</p> : (
              <ul className="prj-rows">
                {priorities.map((task) => (
                  <li key={task.id}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <PriorityDot priority={task.priority} />
                      <DrillLink onClick={() => openTask(task.projectId, task.id)} title="Ver os detalhes da task">
                        <span style={{ color: 'var(--text-3)', marginRight: 6, whiteSpace: 'nowrap' }}>{taskLabel(task)}</span><span>{task.title}</span>
                      </DrillLink>
                    </span>
                    <small title={task.project?.name}>{task.project?.name}</small>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Agenda da semana">
            <ul className="prj-rows">
              {agenda.map((day) => {
                const date = new Date(`${day.date}T00:00:00`)
                return (
                  <li key={day.date} style={{ alignItems: 'center' }}>
                    <span style={{ flex: '0 0 92px' }}>{WEEKDAYS[date.getDay()]} {date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                    <Meter value={day.count} max={maxAgenda} />
                    <small style={{ minWidth: 24, textAlign: 'right' }}>{day.count}</small>
                  </li>
                )
              })}
            </ul>
          </Section>
        </div>

        <Section title="Projetos recentes">
          {recentProjects.length === 0 ? <p className="prj-note">Você ainda não participa de nenhum projeto.</p> : (
            <div className="prj-scroll">
              <table className="table prj">
                <thead><tr><th scope="col">Projeto</th><th scope="col" style={{ width: '34%' }}>Progresso</th><th scope="col" className="num">Abertas</th><th scope="col" className="num">Em atraso</th></tr></thead>
                <tbody>
                  {recentProjects.map((project) => {
                    const details = () => open({ kind: 'project', projectId: project.id, title: project.name })
                    return (
                      <ClickableRow key={project.id} onOpen={details}>
                        <td><DrillLink onClick={details}>{project.name}</DrillLink></td>
                        <td><ProgressBar value={project.progress} label={`${project.name}: ${project.progress}% concluído`} /></td>
                        <td className="num">{project.totalTasks - project.doneTasks}</td>
                        <td className={project.overdueTasks > 0 ? 'num late' : 'num'}>{project.overdueTasks}</td>
                      </ClickableRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <MyCycleByProject />

        <Section title="Atividade recente">
          {recentActivity.length === 0 ? <p className="prj-note">Nenhuma atividade recente.</p> : (
            <ul className="prj-rows">
              {recentActivity.map((entry) => (
                <li key={entry.id}>
                  <span>
                    <strong>{entry.actor?.name}</strong>{' '}
                    {describeActivity(entry.type)} em{' '}
                    {entry.task?.projectId
                      ? <DrillLink onClick={() => openTask(entry.task.projectId!, entry.task.id)}>{taskLabel(entry.task)} {entry.task.title}</DrillLink>
                      : <span style={{ color: 'var(--text-1)' }}>{taskLabel(entry.task)} {entry.task?.title}</span>}
                  </span>
                  <time>{new Date(entry.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <MyRhythm />
      </div>
    </div>
  )
}

/** Mapa de calor da minha atividade nos projetos (mudanças em tasks e comentários). */
function MyRhythm() {
  const [days, setDays] = useState<Array<{ date: string; count: number }> | null>(null)
  useEffect(() => { getProjectsActivity('me').then(setDays).catch(() => setDays([])) }, [])
  if (!days) return null
  return (
    <Section title="Meu ritmo">
      <CalendarHeatmap days={days} ariaLabel="Minha atividade nos projetos por dia" />
    </Section>
  )
}
