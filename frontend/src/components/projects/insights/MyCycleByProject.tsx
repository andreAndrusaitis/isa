import { useEffect, useState } from 'react'
import { Loading } from '@/components/ui'
import { BarList } from '@/components/charts/BarList'
import { getMyCycle, type MyCycle } from '@/services/projectsService'
import { taskLabel } from '@/components/projects/taskKey'
import { Section } from './Section'
import { SegmentedToggle } from './SegmentedToggle'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink } from '@/components/projects/drill/drillUi'
import { useTaskDrawer } from '@/components/projects/taskDrawerContext'

const PERIODS = [30, 90, 180] as const
const hours = (h: number) => `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

/**
 * Meu ciclo por projeto (Minha área): quanto tempo levo, em horas úteis, da entrada
 * em andamento até concluir, nas tasks em que sou responsável ou co-responsável;
 * o que está comigo em andamento agora e as últimas entregas.
 */
export function MyCycleByProject() {
  const { open } = useDrill()
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90)
  const [data, setData] = useState<MyCycle | null>(null)
  const [error, setError] = useState(false)
  // Task abre num drawer sobre a Minha área; ao fechar, recalcula.
  const [refreshKey, setRefreshKey] = useState(0)
  const { openTask: openDrawer } = useTaskDrawer(() => setRefreshKey((k) => k + 1))

  useEffect(() => {
    let alive = true
    setError(false)
    getMyCycle(days)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) { setData(null); setError(true) } })
    return () => { alive = false }
  }, [days, refreshKey])

  const openTask = (t: MyCycle['recent'][number] | MyCycle['current'][number]) => openDrawer(t.projectId, t.taskId)
  const measured = data?.projects.filter((p) => p.avgCycleHours != null) ?? []
  const done = data?.projects.reduce((n, p) => n + p.done, 0) ?? 0

  const taskCell = (t: MyCycle['recent'][number] | MyCycle['current'][number]) => (
    <td style={{ minWidth: 180 }}>
      <DrillLink onClick={() => openTask(t)} title="Ver os detalhes da task">
        <span style={{ color: 'var(--text-3)', marginRight: 6 }}>{taskLabel(t)}</span>{t.title}
      </DrillLink>
    </td>
  )

  return (
    <>
      {data && (
        <div className="prj-cols">
          <Section title="Em andamento comigo">
            {data.current.length === 0 ? (
              <p className="prj-note">Nada seu em andamento agora.</p>
            ) : (
              <div className="prj-scroll">
                <table aria-label="Minhas tasks em andamento" className="table prj">
                  <thead><tr><th>Task</th><th>Projeto</th><th className="num">Há quanto tempo</th></tr></thead>
                  <tbody>
                    {data.current.map((t) => (
                      <ClickableRow key={t.taskId} onOpen={() => openTask(t)}>
                        {taskCell(t)}
                        <td>{t.projectName}</td>
                        <td className="num" title={`Em andamento desde ${new Date(t.startedAt).toLocaleString('pt-BR')}`}>{hours(t.hoursSoFar)} úteis</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Concluídas recentemente">
            {data.recent.length === 0 ? (
              <p className="prj-note">Você não concluiu tasks nos últimos {days} dias.</p>
            ) : (
              <div className="prj-scroll">
                <table aria-label="Minhas tasks concluídas recentemente" className="table prj">
                  <thead><tr><th>Task</th><th>Projeto</th><th>Concluída</th><th className="num">Ciclo</th></tr></thead>
                  <tbody>
                    {data.recent.map((t) => (
                      <ClickableRow key={t.taskId} onOpen={() => openTask(t)}>
                        {taskCell(t)}
                        <td>{t.projectName}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{date(t.completedAt)}</td>
                        <td className="num" title={t.cycleHours == null ? 'Concluída sem passar por andamento' : undefined}>
                          {t.cycleHours == null ? '—' : hours(t.cycleHours)}
                        </td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      <Section
        title="Meu ciclo por projeto"
        sub={`Tempo médio da entrada em andamento até a conclusão, em horas úteis, nas tasks em que você é responsável ou co-responsável. ${done} concluída(s) nos últimos ${days} dias.`}
        action={<SegmentedToggle ariaLabel="Período" value={days} onChange={setDays} options={PERIODS.map((p) => ({ value: p, label: `${p} dias` }))} />}
      >
        {error ? (
          <p className="prj-note">Não foi possível carregar o seu ciclo. Atualize a página para tentar de novo.</p>
        ) : !data ? (
          <Loading size="compact" />
        ) : (
          <BarList
            ariaLabel="Meu tempo médio de ciclo por projeto"
            emptyText="Nenhuma task sua concluída neste período passou por andamento."
            format={hours}
            labelWidth={160}
            onSelect={(it) => open({ kind: 'project', projectId: it.id, title: it.label })}
            items={measured.map((p) => ({
              id: p.projectId,
              label: p.name,
              value: p.avgCycleHours!,
              color: 'var(--accent)',
              hint: `${p.done} concluída(s) · média ${hours(p.avgCycleHours!)} · mediana ${hours(p.medianCycleHours ?? p.avgCycleHours!)} · ${p.open} aberta(s)`,
            }))}
            extra={(it) => {
              const p = measured.find((x) => x.projectId === it.id)!
              return <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>mediana {hours(p.medianCycleHours ?? p.avgCycleHours!)} · {p.done}</span>
            }}
          />
        )}
      </Section>
    </>
  )
}
