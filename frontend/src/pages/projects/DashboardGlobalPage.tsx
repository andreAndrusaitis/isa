import { useEffect, useState, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Btn, Figures, Loading, StatCard } from '@/components/ui'
import {
  getDashboardGlobal, getTeamWorkload, listProjects, getMyProjectsReport,
  DashboardGlobal, TeamWorkloadEntry, MyProjectReportRow, ReportScope
} from '@/services/projectsService'
import { getPortfolioInsights } from '@/services/projectsService'
import { DeliveryInsights, InsightsLoading, useInsights } from '@/components/projects/insights/DeliveryInsights'
import { CycleTimeByType } from '@/components/projects/insights/CycleTimeByType'
import { MyProjectsTable } from '@/components/projects/insights/MyProjectsTable'
import { Section } from '@/components/projects/insights/Section'
import { SegmentedToggle } from '@/components/projects/insights/SegmentedToggle'
import { BarList } from '@/components/charts/BarList'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import { Project, PRIVACY_LABEL } from '@/types/projects'
import { ProjectsTimeSummary } from '@/components/projects/time/ProjectsTimeSummary'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { useFilterPanel } from '@/components/filters/useFilterPanel'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink, HealthPill, ProgressBar, fmtDate } from '@/components/projects/drill/drillUi'
import { projectHealth } from '@/components/projects/projectHealth'
import type { DrillTaskQuery } from '@/services/drillService'

export { projectHealth }

interface EnrichedProject extends Project {
  health?: 'healthy' | 'warning' | 'risk'
}

/**
 * Projeto ativo = 1 ou mais tasks abertas (nem concluídas nem canceladas,
 * fora as arquivadas). Zerou, sai da conta; abriu task nova, volta sozinho.
 */
export function countActiveProjects(projects: Array<Pick<Project, 'openTasks'>>): number {
  return projects.filter(p => (p.openTasks ?? 0) > 0).length
}

/** Carga em texto: mais de 6 abertas = sobrecarga; até 1 = disponível. */
const loadLabel = (count: number) => (count > 6 ? 'Sobrecarga' : count <= 1 ? 'Disponível' : 'Balanceada')

/** A API camelizada devolve "inProgress"; versões antigas, "in_progress". */
function categoryCount(raw: Record<string, number>, category: string) {
  const camel = category.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return raw[category] ?? raw[camel] ?? 0
}

/** Etapa do pipeline → categorias de status das tasks. */
const PIPELINE_CATEGORIES: Record<string, string> = { todo: 'backlog,open', review: 'in_review' }

export default function DashboardGlobalPage() {
  const navigate = useNavigate()
  const { open } = useDrill()
  const [dashboard, setDashboard] = useState<DashboardGlobal | null>(null)
  const [teamWorkload, setTeamWorkload] = useState<TeamWorkloadEntry[]>([])
  const [projects, setProjects] = useState<EnrichedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [searchProject, setSearchProject] = useState('')
  const portfolioFilters = useFilterPanel('projects-bi-portfolio', { health: 'all', privacy: 'all' })
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  // Lente: 'team' (padrão) = projetos de que a equipe participa; 'mine' = os que sou dono ou gerente.
  const [scope, setScope] = useState<ReportScope>('team')
  const [myProjects, setMyProjects] = useState<MyProjectReportRow[] | null>(null)
  const [myProjectsError, setMyProjectsError] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [dashRes, teamRes, projRes, mineRes] = await Promise.allSettled([
        getDashboardGlobal(scope === 'mine' ? 'mine' : undefined),
        getTeamWorkload(),
        listProjects(),
        scope === 'mine' ? getMyProjectsReport() : Promise.resolve(null),
      ])
      setMyProjects(mineRes.status === 'fulfilled' ? mineRes.value?.projects ?? null : null)
      setMyProjectsError(mineRes.status === 'rejected')

      const dashData = dashRes.status === 'fulfilled' ? dashRes.value : null
      const teamData = teamRes.status === 'fulfilled' ? teamRes.value : []
      const projData = projRes.status === 'fulfilled' ? projRes.value : []

      setDashboard(dashData)
      setTeamWorkload(teamData)

      // Os números de cada projeto já vêm em GET /projects.
      const enriched: EnrichedProject[] = projData.map((p) => ({ ...p, health: projectHealth(p) }))

      setProjects(enriched)
      setLastRefreshed(new Date())
    } catch (err) {
      console.error('Erro ao carregar dados do BI:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  const openTasks = (title: string, query: DrillTaskQuery) => open({ kind: 'tasks', title, query: { ...query, scope } })
  const openProject = (p: { id: string; name?: string; label?: string }) => open({ kind: 'project', projectId: p.id, title: p.name ?? p.label ?? 'Projeto' })

  // Em "Meus projetos", a matriz e os KPIs de projeto ficam só nos projetos da tabela.
  const scopedProjects = useMemo(() => {
    if (scope !== 'mine') return projects
    const ids = new Set((myProjects ?? []).map((p) => p.id))
    return projects.filter((p) => ids.has(p.id))
  }, [projects, scope, myProjects])

  // Métricas calculadas para os KPIs Executivos
  const biMetrics = useMemo(() => {
    if (!dashboard) {
      return {
        totalTasks: 0,
        doneTasks: 0,
        activeTasks: 0,
        efficiencyRate: 0,
        overdueCount: 0,
        upcomingCount: 0,
        activeProjects: countActiveProjects(scopedProjects),
        riskProjectsCount: 0,
      }
    }

    const byStatus = dashboard.byStatus || {}
    const done = (byStatus['done'] || 0) + (byStatus['concluido'] || 0) + (byStatus['resolvido'] || 0)
    const total = dashboard.totalTasks || 1
    const efficiencyRate = Math.round((done / total) * 100)
    const riskProjectsCount = scopedProjects.filter(p => p.health === 'risk').length

    return {
      totalTasks: dashboard.totalTasks,
      doneTasks: done,
      activeTasks: dashboard.totalTasks - done - (byStatus['cancelled'] || 0),
      efficiencyRate,
      overdueCount: dashboard.overdueCount,
      upcomingCount: dashboard.upcomingCount,
      activeProjects: countActiveProjects(scopedProjects),
      riskProjectsCount,
    }
  }, [dashboard, scopedProjects])

  // Filtragem de projetos
  const filteredProjects = useMemo(() => {
    const q = searchProject.trim().toLowerCase()
    const f = portfolioFilters.values
    return scopedProjects.filter(p =>
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)) &&
      matchesFilter(f.health, p.health) && matchesFilter(f.privacy, p.privacy)
    )
  }, [scopedProjects, searchProject, portfolioFilters.values])

  // Categorização de status do pipeline operacional
  const pipelineBreakdown = useMemo(() => {
    if (!dashboard?.byStatus) return []
    const raw = dashboard.byStatus
    const categories = [
      { id: 'todo', label: 'Backlog & Abertas', count: categoryCount(raw, 'backlog') + categoryCount(raw, 'open') },
      { id: 'in_progress', label: 'Em execução', count: categoryCount(raw, 'in_progress') },
      { id: 'review', label: 'Revisão & Aprovação', count: categoryCount(raw, 'in_review') },
      { id: 'done', label: 'Concluídas', count: categoryCount(raw, 'done') },
      { id: 'cancelled', label: 'Canceladas / descartadas', count: categoryCount(raw, 'cancelled') },
    ]
    const valid = categories.filter(c => c.count > 0)
    return valid.length > 0 ? valid : Object.entries(raw).map(([key, count]) => ({ id: key, label: key, count }))
  }, [dashboard])

  if (loading && !dashboard) {
    return (
      <>
        <PageHeader title="Painel de projetos" />
        <Loading label="Carregando o painel…" />
      </>
    )
  }

  // O que exige ação primeiro: projetos com tasks vencidas, do pior para o melhor.
  const lateProjects = scopedProjects.filter((p) => (p.overdueTasks ?? 0) > 0).sort((a, b) => (b.overdueTasks ?? 0) - (a.overdueTasks ?? 0))

  return (
    <div>
      <PageHeader
        title="Painel de projetos"
        subtitle={`Atrasos, carga da equipe e andamento. Atualizado às ${lastRefreshed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}
        actions={<>
          <SegmentedToggle ariaLabel="Projetos do relatório" value={scope} onChange={setScope}
            options={[{ value: 'mine', label: 'Meus projetos' }, { value: 'team', label: 'Projetos da equipe' }]} />
          <Btn variant="secondary" size="sm" onClick={fetchData} title="Recarregar os números">Atualizar</Btn>
        </>}
      />

      <div className="prj-body">
        <Figures>
          <StatCard label="Atrasadas" value={String(biMetrics.overdueCount)} sub={biMetrics.overdueCount > 0 ? 'Prazo vencido' : 'Nenhuma demanda vencida'}
            onClick={() => openTasks('Tasks atrasadas', { kind: 'overdue' })} />
          <StatCard label="Próximos 7 dias" value={String(biMetrics.upcomingCount)} sub="Entregas a vencer"
            onClick={() => openTasks('Próximos 7 dias', { kind: 'upcoming' })} />
          <StatCard label="Projetos ativos" value={String(biMetrics.activeProjects)} sub={biMetrics.riskProjectsCount > 0 ? `${biMetrics.riskProjectsCount} em risco` : 'Com pelo menos 1 task aberta'}
            onClick={() => open({ kind: 'projects', title: 'Projetos ativos', subtitle: 'Projetos com pelo menos 1 task aberta.', items: scopedProjects.filter((p) => (p.openTasks ?? 0) > 0) })} />
          <StatCard label="Demandas" value={String(biMetrics.totalTasks)} sub={`${biMetrics.doneTasks} entregues • ${biMetrics.activeTasks} ativas`}
            onClick={() => openTasks('Demandas totais', { kind: 'all' })} />
          <StatCard label="Conclusão" value={`${biMetrics.efficiencyRate}%`} sub="Entregues sobre o total"
            onClick={() => openTasks('Tasks concluídas', { kind: 'done' })} />
        </Figures>

        <div className="prj-cols">
          <Section title="O que está atrasado" sub="Projetos com tasks de prazo vencido"
            action={biMetrics.overdueCount > 0 ? <Btn variant="ghost" size="xs" onClick={() => openTasks('Tasks atrasadas', { kind: 'overdue' })}>Ver as tasks</Btn> : undefined}>
            {lateProjects.length === 0 ? <p className="prj-note">Nenhum projeto com tasks atrasadas.</p> : (
              <div className="prj-scroll">
                <table className="table prj" aria-label="Projetos com tasks atrasadas">
                  <thead><tr><th scope="col">Projeto</th><th scope="col" className="num">Atrasadas</th><th scope="col" className="num">Em aberto</th></tr></thead>
                  <tbody>
                    {lateProjects.map((p) => (
                      <ClickableRow key={p.id} onOpen={() => openProject(p)}>
                        <td><DrillLink onClick={() => openProject(p)}>{p.name}</DrillLink></td>
                        <td className="num late">{p.overdueTasks}</td>
                        <td className="num">{p.openTasks ?? 0}</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Carga da equipe" sub={`Tarefas em aberto por subordinado direto, ${teamWorkload.length} pessoa(s)`}>
            {teamWorkload.length === 0 ? (
              <p className="prj-note">Sem subordinados diretos no organograma. A carga aparece aqui conforme tarefas forem atribuídas a eles.</p>
            ) : (
              <BarList ariaLabel="Tarefas em aberto por pessoa da equipe" labelWidth={170}
                onSelect={(it) => open({ kind: 'person', userId: it.id, title: it.label })}
                items={[...teamWorkload].sort((a, b) => b.taskCount - a.taskCount).map(m => ({
                  id: m.userId, label: m.name, value: m.taskCount, color: 'var(--accent)', hint: `${m.taskCount} tarefa(s) em aberto`,
                }))}
                extra={(it) => <span style={{ minWidth: 84, textAlign: 'left', fontSize: 13, fontWeight: it.value > 6 ? 600 : 400, color: it.value > 6 ? 'var(--text-1)' : 'var(--text-3)' }}>{loadLabel(it.value)}</span>} />
            )}
          </Section>
        </div>

        {scope === 'mine' && (
          <MyProjectsTable rows={myProjects} days={90} error={myProjectsError} />
        )}

        <Section title="Andamento dos projetos" sub={scope === 'mine' ? 'Só os seus projetos. A carga, os gráficos de entrega e as horas continuam com a equipe.' : 'Progresso, prazo e saúde de cada projeto'}
          action={(
            <div className="prj-tools">
              <FilterSearchInput value={searchProject} onChange={setSearchProject} placeholder="Buscar projeto…" width={220} />
              <div style={{ position: 'relative' }}>
                <FilterButton {...portfolioFilters.buttonProps} />
                <FilterDropdown {...portfolioFilters.dropdownProps}>
                  <FilterField label="Saúde">
                    <FilterSelect value={portfolioFilters.values.health} onChange={(v) => portfolioFilters.set('health', v)}>
                      <option value="all">Todas</option>
                      <option value="risk">Em risco</option>
                      <option value="warning">Atenção</option>
                      <option value="healthy">Saudável</option>
                    </FilterSelect>
                  </FilterField>
                  <FilterField label="Visibilidade">
                    <FilterSelect value={portfolioFilters.values.privacy} onChange={(v) => portfolioFilters.set('privacy', v)}>
                      <option value="all">Todas</option>
                      {Object.entries(PRIVACY_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </FilterSelect>
                  </FilterField>
                </FilterDropdown>
              </div>
            </div>
          )}>
          {filteredProjects.length === 0 ? (
            <p className="prj-note">Nenhum projeto encontrado com os critérios de busca informados.</p>
          ) : (
            <div className="prj-scroll">
              <table className="table prj" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th scope="col">Projeto</th>
                    <th scope="col" style={{ width: '24%' }}>Progresso</th>
                    <th scope="col" className="num">Do aberto, atrasado</th>
                    <th scope="col">Saúde</th>
                    <th scope="col">Prazo</th>
                    <th scope="col">Visibilidade</th>
                    <th scope="col"><span style={visuallyHidden}>Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((p) => (
                    <ClickableRow key={p.id} onOpen={() => openProject(p)}>
                      <td style={{ minWidth: 200 }}><DrillLink onClick={() => openProject(p)}>{p.name}</DrillLink></td>
                      <td><ProgressBar value={p.progress || 0} label={`Progresso de ${p.name}`} /></td>
                      <td className="num">{p.openTasks ? Math.round(((p.overdueTasks ?? 0) / p.openTasks) * 100) : 0}%</td>
                      <td><HealthPill health={p.health ?? 'healthy'} /></td>
                      <td className={p.targetDate && new Date(p.targetDate) < new Date() ? 'late' : undefined} style={{ whiteSpace: 'nowrap' }}>{p.targetDate ? fmtDate(p.targetDate) : 'Não definido'}</td>
                      <td>{PRIVACY_LABEL[p.privacy] ?? p.privacy}</td>
                      <td className="num"><Btn variant="ghost" size="xs" onClick={() => navigate(`/projetos/${p.id}/overview`)}>Visão geral</Btn></td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <PortfolioCharts lead={(
          <Section title="Tarefas por etapa" sub={`${biMetrics.totalTasks} tarefas pelas etapas do fluxo`}>
            <BarList ariaLabel="Tarefas por etapa do fluxo" showShare labelWidth={170} emptyText="Nenhum dado de status registrado no momento."
              items={pipelineBreakdown.map(item => ({ ...item, value: item.count, color: 'var(--accent)' }))}
              onSelect={(it) => openTasks(it.label, { categories: PIPELINE_CATEGORIES[it.id] ?? it.id })} />
          </Section>
        )} />

        {/* Tempo por último: por tipo de atividade, horas por pessoa e projeto, chamados em projeto. */}
        <CycleTimeByType scope={scope === 'mine' ? 'mine' : undefined} />
        <ProjectsTimeSummary />
      </div>
    </div>
  )
}

function PortfolioCharts({ lead }: { lead: ReactNode }) {
  const { data, error } = useInsights(getPortfolioInsights, [])
  if (error) return <>{lead}</>
  if (!data) return <>{lead}<InsightsLoading /></>
  return <DeliveryInsights insights={data} lead={lead} />
}
