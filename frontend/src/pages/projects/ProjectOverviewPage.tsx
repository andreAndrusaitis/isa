import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Figures, Meter, StatCard, EmptyState, Btn, Loading } from '@/components/ui'
import { BarList } from '@/components/charts/BarList'
import { getProjectDashboard, getProjectInsights } from '@/services/projectsService'
import { DeliveryInsights, InsightsLoading, useInsights } from '@/components/projects/insights/DeliveryInsights'
import { Section } from '@/components/projects/insights/Section'
import { ProjectDashboard } from '@/types/projects'
import { describeActivity } from './activityLabels'
import { taskLabel } from '@/components/projects/taskKey'
import { useDrill } from '@/components/projects/drill/drillContext'
import { DrillLink } from '@/components/projects/drill/drillUi'
import { useTaskDrawer } from '@/components/projects/taskDrawerContext'

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade',
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '—'
}

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { open } = useDrill()
  const openTask = (t: { id: string; seq: number; key?: string | null; title: string }) => open({ kind: 'task', projectId: projectId!, taskId: t.id, title: `${taskLabel(t)} ${t.title}` })
  const [data, setData] = useState<ProjectDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Task aberta pelo detalhe ("Abrir task") fica num drawer aqui; ao fechar, atualiza o painel sem piscar.
  useTaskDrawer(() => { if (projectId) getProjectDashboard(projectId).then(setData).catch(() => {}) })

  function load() {
    if (!projectId) return
    setLoading(true)
    setError(null)
    getProjectDashboard(projectId)
      .then(setData)
      .catch(() => setError('Não foi possível carregar o painel do projeto.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  if (loading) {
    return (
      <Loading label="Carregando visão geral do projeto…" />
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

  const { project, totals, byStatus, byPriority, byAssignee, byList, milestones, upcoming, recentActivity } = data

  const drill = (params: Record<string, string>) =>
    navigate(`/projetos/${projectId}/tasks?view=list&${new URLSearchParams(params).toString()}`)

  const bars = (ariaLabel: string, rows: Array<{ id: string; label: string; value: number }>, onSelect: (it: { id: string; label: string }) => void, emptyText?: string) => (
    <BarList ariaLabel={ariaLabel} showShare labelWidth={150} emptyText={emptyText} items={rows.map((r) => ({ ...r, color: 'var(--accent)' }))} onSelect={onSelect} />
  )

  return (
    <div className="prj-body" style={{ gap: 36 }}>
      <div className="prj-tools" style={{ justifyContent: 'space-between' }}>
        <dl className="prj-facts">
          <div><dt>Dono</dt><dd>{project.owner?.name ?? 'Não definido'}</dd></div>
          <div><dt>Pessoas</dt><dd>{project._count?.members ?? 0}</dd></div>
          <div><dt>Início</dt><dd>{formatDate(project.startDate)}</dd></div>
          <div><dt>Previsão</dt><dd>{formatDate(project.targetDate)}</dd></div>
        </dl>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="ghost" size="sm" onClick={() => navigate(`/projetos/${projectId}/members`)}>Adicionar membro</Btn>
          <Btn variant="ghost" size="sm" onClick={() => navigate(`/projetos/${projectId}/docs`)}>Enviar arquivo</Btn>
          <Btn variant="primary" size="sm" onClick={() => navigate(`/projetos/${projectId}/tasks?view=board`)}>Nova task</Btn>
        </div>
      </div>

      <Figures>
        <StatCard label="Concluído" value={`${totals.progress}%`} sub={<Meter value={totals.progress} label={`${totals.progress}% concluído`} />} />
        <StatCard label="Atrasadas" value={totals.overdue} onClick={() => drill({ overdue: '1' })} />
        <StatCard label="Vencem em 3 dias" value={totals.dueSoon} onClick={() => drill({ dueSoon: '1' })} />
        <StatCard label="Abertas" value={totals.open} onClick={() => drill({ open: '1' })} />
        <StatCard label="Concluídas" value={totals.done} onClick={() => drill({ done: '1' })} />
        <StatCard label="Tasks totais" value={totals.total} onClick={() => drill({})} />
        <StatCard label="A aprovar" value={totals.pendingApprovals} />
      </Figures>

      <div className="prj-cols">
        <div className="prj-stack">
          <Section title="Próximas entregas">
            {upcoming.length === 0 ? <p className="prj-note">Nenhuma entrega agendada.</p> : (
              <ul className="prj-rows">
                {upcoming.map((t) => <li key={t.id}><span><DrillLink onClick={() => openTask(t)}>{taskLabel(t)} {t.title}</DrillLink></span><time>{formatDate(t.dueDate)}</time></li>)}
              </ul>
            )}
          </Section>
          <Section title="Pontos de controle">
            {milestones.length === 0 ? <p className="prj-note">Nenhum ponto de controle definido no projeto.</p> : (
              <ul className="prj-rows">
                {milestones.map((m) => <li key={m.id}><span><DrillLink onClick={() => openTask(m)}>{taskLabel(m)} {m.title}</DrillLink></span><small>{m.status.name}</small><time>{formatDate(m.dueDate)}</time></li>)}
              </ul>
            )}
          </Section>
          <Section title="Atividade do projeto">
            {recentActivity.length === 0 ? <p className="prj-note">Nenhuma atividade registrada ainda.</p> : (
              <ul className="prj-rows">
                {recentActivity.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <strong>{entry.actor?.name}</strong> {describeActivity(entry.type)}{' '}
                      {entry.task ? <DrillLink onClick={() => openTask(entry.task)}>{taskLabel(entry.task)} {entry.task.title}</DrillLink> : null}
                    </span>
                    <time>{new Date(entry.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="prj-stack">
          <Section title="Por responsável">
            {bars('Tasks por responsável', [...byAssignee].sort((a, b) => b.count - a.count).map((a) => ({ id: a.id, label: a.name, value: a.count })),
              (it) => open({ kind: 'person', userId: it.id, projectId, title: it.label }), 'Nenhuma task com responsável.')}
          </Section>
          <Section title="Por status">
            {bars('Tasks por status', byStatus.map((s) => ({ id: s.statusId, label: s.name, value: s.count })), (it) => drill({ statusId: it.id }))}
          </Section>
          <Section title="Por prioridade">
            {bars('Tasks por prioridade', Object.entries(byPriority).map(([key, count]) => ({ id: key, label: PRIORITY_LABEL[key] ?? key, value: count })), (it) => drill({ priority: it.id }))}
          </Section>
          {byList.length > 0 && (
            <Section title="Por lista">
              {bars('Tasks por lista', [...byList].sort((a, b) => b.count - a.count).map((l) => ({ id: l.id, label: l.name, value: l.count })), (it) => drill({ listId: it.id }))}
            </Section>
          )}
        </div>
      </div>

      {projectId && <ProjectCharts projectId={projectId} />}
    </div>
  )
}

function ProjectCharts({ projectId }: { projectId: string }) {
  const { data, error } = useInsights(() => getProjectInsights(projectId), [projectId])
  if (error) return null // os gráficos são complemento: falha não derruba a Visão geral
  return data ? <DeliveryInsights insights={data} /> : <InsightsLoading />
}
