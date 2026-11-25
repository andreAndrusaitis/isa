import { useEffect, useState } from 'react'
import { PageHeader, EmptyState, Loading, Meter } from '@/components/ui'
import { getTeamWorkload, TeamWorkloadEntry, getProjectsActivity } from '@/services/projectsService'
import { Section } from '@/components/projects/insights/Section'
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink } from '@/components/projects/drill/drillUi'

export default function TeamPage() {
  const { open } = useDrill()
  const [entries, setEntries] = useState<TeamWorkloadEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTeamWorkload()
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <PageHeader title="Equipe" subtitle="Distribuição de carga e tarefas" />
        <Loading label="Carregando carga da equipe…" />
      </div>
    )
  }

  const maxTasks = Math.max(1, ...entries.map((e) => e.taskCount))

  return (
    <div>
      <PageHeader
        title="Equipe"
        subtitle="Tarefas em aberto por pessoa nos projetos de que você participa"
      />

      {entries.length === 0 ? (
        <EmptyState
          title="Nenhum membro encontrado"
          desc="Não há subordinados ou membros com projetos em comum atribuídos a você."
        />
      ) : (
        <div className="prj-body">
          <div className="prj-scroll">
            <table className="table prj">
              <thead><tr><th scope="col">Pessoa</th><th scope="col" style={{ width: '50%' }}>Carga</th><th scope="col" className="num">Em aberto</th></tr></thead>
              <tbody>
                {entries.map((entry) => {
                  const details = () => open({ kind: 'person', userId: entry.userId, title: entry.name })
                  return (
                    <ClickableRow key={entry.userId} onOpen={details}>
                      <td><DrillLink onClick={details}>{entry.name}</DrillLink></td>
                      <td><Meter value={entry.taskCount} max={maxTasks} /></td>
                      <td className="num">{entry.taskCount}</td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TeamActivity people={entries} />
        </div>
      )}
    </div>
  )
}

/** Mapa de calor da atividade do time (ou de uma pessoa) nos projetos do usuário. */
function TeamActivity({ people }: { people: TeamWorkloadEntry[] }) {
  const [userId, setUserId] = useState('')
  const [days, setDays] = useState<Array<{ date: string; count: number }> | null>(null)
  useEffect(() => {
    setDays(null)
    getProjectsActivity(userId || undefined).then(setDays).catch(() => setDays([]))
  }, [userId])
  return (
    <Section title="Atividade" sub="Mudanças em tasks e comentários por dia, nos projetos de que você participa"
      action={(
        <select aria-label="Pessoa" value={userId} onChange={(e) => setUserId(e.target.value)}
          className="prj-select">
          <option value="">Toda a equipe</option>
          {people.filter((p) => p.userId).map((p) => <option key={p.userId!} value={p.userId!}>{p.name}</option>)}
        </select>
      )}>
      {days ? <CalendarHeatmap days={days} ariaLabel={userId ? 'Atividade da pessoa por dia' : 'Atividade da equipe por dia'} /> : <Loading size="compact" label="Carregando atividade…" style={{ minHeight: 150 }} />}
    </Section>
  )
}
