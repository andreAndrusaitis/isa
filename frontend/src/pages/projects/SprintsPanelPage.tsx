import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, Figures, StatCard, Btn, Field, Sel, EmptyState, Modal, Loading } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { listSprintOwners, listGlobalSprints, getGlobalSprintOverview, globalSprintApi } from '@/services/projectsService'
import { GlobalSprint, GlobalSprintOverview, SprintOwner } from '@/types/projects'
import { SprintManager } from '@/components/projects/SprintManager'
import { Section } from '@/components/projects/insights/Section'
import { ClickableRow, DrillLink, ProgressBar } from '@/components/projects/drill/drillUi'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { BarList } from '@/components/charts/BarList'
import { useDrill } from '@/components/projects/drill/drillContext'

const STATUS_LABEL = { planned: 'Planejado', active: 'Ativo', completed: 'Encerrado' } as const

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' }) : '—'
}

function sprintLabel(s: GlobalSprint) {
  return `${s.name} · ${fmtDate(s.startDate)}–${fmtDate(s.endDate)} · ${STATUS_LABEL[s.status]}`
}

/** Sprint padrão ao abrir: o ativo, senão o próximo planejado, senão o último. */
function defaultSprint(sprints: GlobalSprint[]) {
  return sprints.find(s => s.status === 'active') ?? sprints.find(s => s.status === 'planned') ?? sprints[sprints.length - 1]
}

/**
 * Visão geral por sprint: escolhe o calendário (Gerente) e o sprint, e vê as
 * tasks de todos os projetos que seguem esse calendário. Gerente/admin
 * gerenciam o calendário daqui. Seleção fica na URL (link compartilhável).
 */
export default function SprintsPanelPage() {
  const user = useAuthStore(s => s.user)!
  const { open } = useDrill()
  const [params, setParams] = useSearchParams()
  const [owners, setOwners] = useState<SprintOwner[]>([])
  const [sprints, setSprints] = useState<GlobalSprint[]>([])
  const [overview, setOverview] = useState<GlobalSprintOverview | null>(null)
  const [loading, setLoading] = useState(false)
  // Até a lista de sprints chegar não dá para dizer que o calendário está vazio.
  const [listing, setListing] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)

  const ownerId = params.get('owner') ?? ''
  const sprintId = params.get('sprint') ?? ''
  // Gerenciar: admin em qualquer calendário; quem tem "Calendário de sprints e pastas", só no próprio (regra do servidor).
  const canManage = !!ownerId && (user.role === 'admin' || (!!user.capabilities?.includes('projects.global.manage') && user.id === ownerId))
  const manageApi = useMemo(() => (ownerId ? globalSprintApi(ownerId) : null), [ownerId])

  function select(next: { owner?: string; sprint?: string }) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    setParams(p, { replace: true })
  }

  useEffect(() => {
    listSprintOwners().then(list => {
      setOwners(list)
      if (!list.length) setListing(false)
      else if (!ownerId) select({ owner: (list.find(o => o.id === user.id) ?? list[0]).id })
    }).catch(() => setListing(false))
  }, [])

  function loadSprints() {
    if (!ownerId) return
    setListing(true)
    listGlobalSprints(ownerId).then(list => {
      setSprints(list)
      if (!list.some(s => s.id === sprintId)) {
        const next = defaultSprint(list)?.id ?? ''
        if (next) setLoading(true) // o carregamento segue até a visão geral chegar, sem piscar
        select({ sprint: next })
      }
    }).finally(() => setListing(false))
  }
  useEffect(loadSprints, [ownerId])

  useEffect(() => {
    if (!sprintId) { setOverview(null); return }
    setLoading(true)
    getGlobalSprintOverview(sprintId).then(setOverview).catch(() => setOverview(null)).finally(() => setLoading(false))
  }, [sprintId])

  const totals = useMemo(() => {
    const tasks = overview?.projects.flatMap(p => p.tasks) ?? []
    const done = tasks.filter(t => t.status.category === 'done')
    const sum = (list: typeof tasks) => list.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0)
    return { total: tasks.length, done: done.length, points: sum(tasks), pointsDone: sum(done) }
  }, [overview])

  return (
    <div>
      <PageHeader
        title="Sprints"
        subtitle="Visão geral por sprint em todos os projetos que seguem o calendário"
        actions={canManage && <Btn variant="secondary" size="sm" onClick={() => setManageOpen(true)}>Gerenciar sprints</Btn>}
      />
      <div className="prj-body" style={{ gap: 32 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Field label="Calendário" style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <Sel value={ownerId} onChange={(e: any) => select({ owner: e.target.value, sprint: '' })}>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Sel>
          </Field>
          <Field label="Sprint" style={{ flex: '2 1 280px', maxWidth: 460 }}>
            <Sel value={sprintId} onChange={(e: any) => select({ sprint: e.target.value })} disabled={!sprints.length}>
              {!sprints.length && <option value="">Nenhum sprint neste calendário</option>}
              {sprints.map(s => <option key={s.id} value={s.id}>{sprintLabel(s)}</option>)}
            </Sel>
          </Field>
        </div>

        {!listing && !sprintId && (
          <div className="prj-empty"><EmptyState
            title="Nenhum sprint para mostrar"
            desc={canManage ? 'Crie o primeiro sprint do calendário em "Gerenciar sprints". Os projetos escolhem seguir este calendário em Configurações › Sprints.' : 'Este calendário ainda não tem sprints.'}
          /></div>
        )}

        {overview && (
          <>
            <Figures>
              <StatCard label="Projetos" value={overview.projects.length} />
              <StatCard label="Tasks" value={totals.total} />
              <StatCard label="Concluídas" value={totals.done} sub={totals.total ? `${Math.round((totals.done / totals.total) * 100)}%` : undefined} />
              <StatCard label="Story points" value={`${totals.pointsDone}/${totals.points}`} />
            </Figures>

            {overview.projects.length === 0 && (
              <div className="prj-empty"><EmptyState title="Nenhum projeto neste sprint" desc="Nenhum projeto seu segue este calendário. O dono do projeto escolhe a origem dos sprints em Configurações." /></div>
            )}

            {overview.projects.map(p => {
              const done = p.tasks.filter(t => t.status.category === 'done').length
              const pct = p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0
              return (
                <Section key={p.id}
                  title={<DrillLink onClick={() => open({ kind: 'project', projectId: p.id, title: p.name })}>{p.name}</DrillLink>}
                  sub={`${done}/${p.tasks.length} concluídas`}
                  action={<div style={{ width: 200 }}><ProgressBar value={pct} label={`Progresso de ${p.name}`} /></div>}>
                  {p.tasks.length === 0 ? <p className="prj-note">Nenhuma task neste sprint.</p> : (
                    <div className="prj-scroll">
                      <table className="table prj" style={{ minWidth: 560 }}>
                        <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Responsável</th><th scope="col">Prazo</th></tr></thead>
                        <tbody>
                          {p.tasks.map(t => {
                            const details = () => open({ kind: 'task', projectId: p.id, taskId: t.id, title: `${t.key ?? `#${t.seq}`} ${t.title}` })
                            return (
                              <ClickableRow key={t.id} onOpen={details}>
                                <td><DrillLink onClick={details}><span style={{ color: 'var(--text-3)', marginRight: 6 }}>{t.key ?? `#${t.seq}`}</span>{t.title}</DrillLink></td>
                                <td>{t.status.name}</td>
                                <td>{t.assignee?.name ?? 'Sem responsável'}</td>
                                <td>{fmtDate(t.dueDate)}</td>
                              </ClickableRow>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              )
            })}

            {overview.projects.length > 0 && (
              <div className="prj-cols">
                <Section title="Progresso por projeto" sub="Concluídas sobre o total do projeto nesta sprint — clique para abrir as tasks">
                  <BarList ariaLabel="Progresso da sprint por projeto" max={100} format={(v) => `${v}%`} labelWidth={150}
                    items={overview.projects.map(p => {
                      const done = p.tasks.filter(t => t.status.category === 'done').length
                      return { id: p.id, label: p.name, value: p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0, color: 'var(--accent)', hint: `${done} de ${p.tasks.length} concluídas` }
                    })}
                    onSelect={(it) => open({ kind: 'project', projectId: it.id, title: it.label })} />
                </Section>
                {overview.burndown ? (
                  <Section title="Burndown da sprint" sub={`${overview.burndown.unit === 'pontos' ? 'Pontos' : 'Tasks'} restantes somando os projetos × linha ideal`}>
                    <TimeSeriesChart ariaLabel="Burndown da sprint global" height={220}
                      band={{ lowerKey: 'low', upperKey: 'high', label: 'Faixa ideal' }}
                      data={overview.burndown.days.map(d => ({ x: d.date, remaining: d.remaining, ideal: d.ideal, low: Math.max(0, Math.round(d.ideal * 0.85 * 10) / 10), high: Math.round(d.ideal * 1.15 * 10) / 10 }))}
                      series={[
                        { key: 'remaining', label: 'Restante', color: 'var(--accent)', type: 'line' },
                        { key: 'ideal', label: 'Ideal', color: 'var(--text-3)', type: 'line', dashed: true },
                      ]} />
                  </Section>
                ) : (
                  <Section title="Burndown da sprint">
                    <p className="prj-note">Sprint sem datas. Defina início e fim em Gerenciar sprints para ver o burndown.</p>
                  </Section>
                )}
              </div>
            )}
          </>
        )}
        {(loading || listing) && !overview && <Loading label="Carregando sprints…" />}
      </div>

      <Modal isOpen={manageOpen} onClose={() => { setManageOpen(false); loadSprints() }} title={`Sprints de ${owners.find(o => o.id === ownerId)?.name ?? ''}`} width={520}>
        {manageOpen && manageApi && <SprintManager api={manageApi} />}
      </Modal>
    </div>
  )
}
