import { useState } from 'react'
import { Figures, StatCard } from '@/components/ui'
import { BarList } from '@/components/charts/BarList'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { SegmentedToggle } from '@/components/projects/insights/SegmentedToggle'
import { projectHealth } from '@/components/projects/projectHealth'
import { taskLabel } from '@/components/projects/taskKey'
import { describeActivity } from '@/pages/projects/activityLabels'
import { getProjectDrill, type DrillTaskQuery, type ProjectDrill } from '@/services/drillService'
import { fmtMinutes } from '@/utils/duration'
import { dayLabel, DayDivider, timeOf } from '@/components/projects/TaskTimeline'
import { Section } from '@/components/projects/insights/Section'
import { useDrill } from './drillContext'
import {
  ClickableRow, DrillError, DrillLink, DrillLoading, DrillTaskTable, Empty, HealthPill, ProgressBar, 
  fmtDate, fmtHours, useDrillData,
} from './drillUi'

const PRIORITY_LABEL: Record<string, string> = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade' }
type Tab = 'summary' | 'attention' | 'people' | 'activity'

export function ProjectDrillView({ projectId }: { projectId: string }) {
  const { data, failed, retry } = useDrillData(() => getProjectDrill(projectId), [projectId])
  const [tab, setTab] = useState<Tab>('summary')
  if (failed) return <DrillError onRetry={retry} />
  if (!data) return <DrillLoading />

  const { project, totals } = data
  const health = projectHealth({ targetDate: project.targetDate, openTasks: totals.open, overdueTasks: totals.overdue, totalTasks: totals.total, progress: totals.progress })
  const attention = totals.overdue + totals.running + totals.upcoming

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {project.description && <p className="prj-note">{project.description}</p>}
      <dl className="prj-facts">
        <div><dt>Saúde</dt><dd><HealthPill health={health} /></dd></div>
        {project.owner && <div><dt>Dono</dt><dd>{project.owner.name}</dd></div>}
        <div><dt>Início</dt><dd>{fmtDate(project.startDate)}</dd></div>
        <div><dt>Prazo</dt><dd>{fmtDate(project.targetDate)}</dd></div>
      </dl>
      <ProgressBar value={totals.progress} label="Progresso do projeto" />
      <SegmentedToggle ariaLabel="Seção do projeto" value={tab} onChange={setTab} options={[
          { value: 'summary', label: 'Resumo' },
          { value: 'attention', label: `Atenção (${attention})` },
          { value: 'people', label: `Pessoas (${data.people.length})` },
          { value: 'activity', label: 'Atividade' },
        ]} />
      <div key={tab} style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {tab === 'summary' && <Summary data={data} projectId={projectId} />}
        {tab === 'attention' && <Attention data={data} projectId={projectId} />}
        {tab === 'people' && <People data={data} projectId={projectId} />}
        {tab === 'activity' && <Activity data={data} projectId={projectId} />}
      </div>
    </div>
  )
}

function Summary({ data, projectId }: { data: ProjectDrill; projectId: string }) {
  const { open } = useDrill()
  const { totals, sprint } = data
  const list = (title: string, query: Omit<DrillTaskQuery, 'projectId'>) => open({ kind: 'tasks', title: `${title} · ${data.project.name}`, query: { ...query, projectId } })
  return (
    <>
      <Figures>
        <StatCard label="Abertas" value={totals.open} onClick={() => list('Abertas', { kind: 'open' })} />
        <StatCard label="Concluídas" value={totals.done} onClick={() => list('Concluídas', { kind: 'done' })} />
        <StatCard label="Atrasadas" value={totals.overdue} onClick={() => list('Atrasadas', { kind: 'overdue' })} />
        <StatCard label="Em andamento" value={totals.running} onClick={() => list('Em andamento', { kind: 'running' })} />
      </Figures>
      <Figures>
        <StatCard label="Próximos 7 dias" value={totals.upcoming} onClick={() => list('Próximos 7 dias', { kind: 'upcoming' })} />
        <StatCard label="Horas no projeto" value={fmtMinutes(totals.activeMinutes)} />
        <StatCard label="Ciclo médio" value={fmtHours(totals.avgCycleHours)} sub={`mediana ${fmtHours(totals.medianCycleHours)}`} />
        <StatCard label="Aprovações" value={totals.pendingApprovals} sub={`${totals.linkedTickets} chamado(s) vinculado(s)`} />
      </Figures>
      {sprint && (
        <Section small title={`Sprint ativa: ${sprint.name}`} sub={`${fmtDate(sprint.startDate)} a ${fmtDate(sprint.endDate)} · ${sprint.done} de ${sprint.total} concluída(s)`}>
          <ProgressBar value={sprint.total ? Math.round((sprint.done / sprint.total) * 100) : 0} label="Progresso da sprint" />
        </Section>
      )}
      <Section small title="Entregas nas últimas 8 semanas" sub="Barras: tasks concluídas na semana. Linha: tasks criadas.">
        <TimeSeriesChart ariaLabel="Tasks concluídas e criadas por semana" height={170}
          data={data.weekly.map((w) => ({ x: w.weekStart, completed: w.completed, created: w.created }))}
          series={[
            { key: 'completed', label: 'Concluídas', color: 'var(--accent)', type: 'bar' },
            { key: 'created', label: 'Criadas', color: 'var(--text-3)', type: 'line' },
          ]} />
      </Section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 28 }}>
        <Section small title="Por status">
          <BarList ariaLabel="Tasks por status" showShare labelWidth={130}
            items={data.byStatus.filter((s) => s.count > 0).map((s) => ({ id: s.statusId, label: s.name, value: s.count, color: 'var(--accent)' }))}
            onSelect={(it) => list(it.label, { statusId: it.id })} />
        </Section>
        <Section small title="Por prioridade">
          <BarList ariaLabel="Tasks por prioridade" showShare labelWidth={130}
            items={Object.entries(data.byPriority).filter(([, n]) => n > 0).map(([p, n]) => ({ id: p, label: PRIORITY_LABEL[p] ?? p, value: n, color: 'var(--accent)' }))}
            onSelect={(it) => list(`Prioridade ${it.label}`, { priority: it.id })} />
        </Section>
      </div>
    </>
  )
}

function Attention({ data, projectId }: { data: ProjectDrill; projectId: string }) {
  const { open } = useDrill()
  const { totals } = data
  const all = (title: string, n: number, shown: number, kind: DrillTaskQuery['kind']) => n > shown && (
    <DrillLink onClick={() => open({ kind: 'tasks', title: `${title} · ${data.project.name}`, query: { projectId, kind } })} style={{ fontSize: 13, color: 'var(--accent-fg)' }}>Ver todas ({n})</DrillLink>
  )
  return (
    <>
      <Section small title={`Atrasadas (${totals.overdue})`} action={all('Atrasadas', totals.overdue, data.overdue.length, 'overdue')}>
        {data.overdue.length ? <DrillTaskTable rows={data.overdue} showProject={false} ariaLabel="Tasks atrasadas" /> : <Empty>Nenhuma task atrasada.</Empty>}
      </Section>
      <Section small title={`Em andamento (${totals.running})`} action={all('Em andamento', totals.running, data.running.length, 'running')}>
        {data.running.length ? <DrillTaskTable rows={data.running} showProject={false} ariaLabel="Tasks em andamento" /> : <Empty>Nada em andamento agora.</Empty>}
      </Section>
      <Section small title={`Próximos 7 dias (${totals.upcoming})`} action={all('Próximos 7 dias', totals.upcoming, data.upcoming.length, 'upcoming')}>
        {data.upcoming.length ? <DrillTaskTable rows={data.upcoming} showProject={false} ariaLabel="Tasks dos próximos 7 dias" /> : <Empty>Nenhum prazo nos próximos 7 dias.</Empty>}
      </Section>
      {data.milestones.length > 0 && (
        <Section small title="Pontos de controle">
          <div className="prj-scroll">
            <table aria-label="Pontos de controle" className="table prj">
              <tbody>
                {data.milestones.map((m) => {
                  const go = () => open({ kind: 'task', projectId, taskId: m.id, title: `${taskLabel(m)} ${m.title}` })
                  return (
                    <ClickableRow key={m.id} onOpen={go}>
                      <td><DrillLink onClick={go}>{taskLabel(m)} {m.title}</DrillLink></td>
                      <td>{m.status.name}</td>
                      <td className="num">{fmtDate(m.dueDate)}</td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  )
}

function People({ data, projectId }: { data: ProjectDrill; projectId: string }) {
  const { open } = useDrill()
  if (data.people.length === 0) return <Empty>Nenhuma task com responsável neste projeto.</Empty>
  return (
    <div className="prj-scroll">
      <table aria-label="Pessoas no projeto" className="table prj">
        <thead>
          <tr>
            <th>Pessoa</th>
            {['Abertas', 'Atrasadas', 'Em andamento', 'Concluídas'].map((h) => <th key={h} className="num">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.people.map((p) => {
            const go = () => open({ kind: 'person', userId: p.userId, projectId, title: `${p.name} em ${data.project.name}` })
            return (
              <ClickableRow key={p.userId} onOpen={go}>
                <td style={{ minWidth: 180 }}>
                  <DrillLink onClick={go}>{p.name}</DrillLink>
                </td>
                <td className="num">{p.open}</td>
                <td className={p.overdue ? 'num late' : 'num'}>{p.overdue}</td>
                <td className="num">{p.running}</td>
                <td className="num">{p.done}</td>
              </ClickableRow>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Activity({ data, projectId }: { data: ProjectDrill; projectId: string }) {
  const { open } = useDrill()
  if (data.recentActivity.length === 0) return <Empty>Nenhuma atividade registrada.</Empty>
  let last = ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.recentActivity.map((a) => {
        const label = dayLabel(a.createdAt)
        const divider = label !== last
        last = label
        return (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {divider && <DayDivider label={label} />}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: 'var(--text-2)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.actor.name}</strong> {describeActivity(a.type)} em{' '}
                <DrillLink onClick={() => open({ kind: 'task', projectId, taskId: a.task.id, title: `${taskLabel(a.task)} ${a.task.title}` })}>{taskLabel(a.task)} {a.task.title}</DrillLink>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{timeOf(a.createdAt)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
