import { useEffect, useState } from 'react'
import { BarList } from '@/components/charts/BarList'
import { getCycleTimeByType, type CycleTimeByType as CycleData, type ReportScope } from '@/services/projectsService'
import { useDrill } from '@/components/projects/drill/drillContext'
import { Loading } from '@/components/ui'
import { Section } from './Section'
import { SegmentedToggle } from './SegmentedToggle'

const PERIODS = [30, 90, 180] as const
const hours = (h: number) => `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`

/**
 * Tempo médio de ciclo por tipo de task (ex.: Feature, 4 h). Ciclo =
 * da 1ª entrada em andamento até a conclusão, em horas úteis; só concluídas
 * no período que passaram por andamento. `scope`: lente do BI (sem ela, a da equipe).
 */
export function CycleTimeByType({ scope }: { scope?: ReportScope } = {}) {
  const { open } = useDrill()
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90)
  const [data, setData] = useState<CycleData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setError(false)
    ;(scope ? getCycleTimeByType(days, scope) : getCycleTimeByType(days))
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) { setData(null); setError(true) } })
    return () => { alive = false }
  }, [days, scope])

  const total = data?.byType.reduce((n, r) => n + r.tasks, 0) ?? 0

  return (
    <Section
      title="Tempo médio por tipo de atividade"
      sub={`Da entrada em andamento até a conclusão, em horas úteis. ${total} task(s) concluída(s) nos últimos ${days} dias.`}
      action={<SegmentedToggle ariaLabel="Período" value={days} onChange={setDays} options={PERIODS.map((p) => ({ value: p, label: `${p} dias` }))} />}
    >
      {error ? (
        <p className="prj-note">Não foi possível carregar o tempo por tipo. Atualize a página para tentar de novo.</p>
      ) : !data ? (
        <Loading size="compact" />
      ) : (
        <BarList
          ariaLabel="Tempo médio de ciclo por tipo de task"
          emptyText="Nenhuma task concluída no período passou por andamento."
          format={hours}
          labelWidth={150}
          onSelect={(it) => open({ kind: 'tasks', title: `${it.label} · concluídas em ${days} dias`, query: { type: it.id, days, scope } })}
          items={data.byType.map((r) => ({
            id: r.type,
            label: r.type,
            value: r.avgHours,
            color: 'var(--accent)',
            hint: `${r.tasks} task(s) · média ${hours(r.avgHours)} · mediana ${hours(r.medianHours)}`,
          }))}
          extra={(item) => {
            const r = data.byType.find((x) => x.type === item.id)!
            return <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>mediana {hours(r.medianHours)} · {r.tasks}</span>
          }}
        />
      )}
    </Section>
  )
}
