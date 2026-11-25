import { useEffect, useState, type ReactNode } from 'react'
import { BarList } from '@/components/charts/BarList'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { shortDay } from '@/components/charts/chartUtils'
import { Loading, Meter } from '@/components/ui'
import { Section } from './Section'
import type { ProjectInsights } from '@/services/projectsService'

/** Carrega os indicadores (projeto ou portfólio) com estado de carga e erro. */
export function useInsights(load: () => Promise<ProjectInsights>, deps: unknown[]) {
  const [data, setData] = useState<ProjectInsights | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    setData(null); setError(false)
    load().then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error }
}

/**
 * Ritmo de entrega: progresso por tipo (ou a seção `lead` de quem chama), entregas no
 * prazo, entregas por semana com marcos, burndown da sprint e fluxo cumulativo.
 */
export function DeliveryInsights({ insights, lead }: { insights: ProjectInsights; lead?: ReactNode }) {
  const { onTime } = insights
  const weeklyEvents = insights.events.map((e) => ({ x: e.week, label: e.label, detail: e.detail }))
  const last = insights.daily[insights.daily.length - 1]
  const first = insights.daily[0]
  const doneInPeriod = insights.daily.reduce((n, d) => n + d.completed, 0)
  const createdInPeriod = insights.daily.reduce((n, d) => n + d.created, 0)

  return (
    <>
      <div className="prj-cols">
        {lead ?? (
          <Section title="Progresso por tipo" sub="Concluídas sobre o total de cada tipo de task">
            <BarList ariaLabel="Progresso por tipo" max={100} labelWidth={170} format={(v) => `${v}%`}
              items={insights.byType.map((t) => ({ id: `${t.prefix}-${t.name}`, label: `${t.name}${t.prefix ? ` (${t.prefix})` : ''}`, value: t.total ? Math.round((t.done / t.total) * 100) : 0, color: 'var(--accent)', hint: `${t.done} de ${t.total}` }))}
              extra={(it) => <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{it.hint}</span>} />
          </Section>
        )}
        <Section title="Entregas no prazo" sub="Tasks concluídas até o dia do prazo, entre as que tinham prazo">
          {onTime.pct === null ? <p className="prj-note">Ainda não há tasks concluídas com prazo.</p> : (
            <div className="figure" style={{ gap: 10, paddingTop: 0 }}>
              <span className="figure-value">{onTime.pct}%</span>
              <Meter value={onTime.pct} label="Entregas no prazo" />
              <span className="figure-sub">{onTime.onTime} no prazo · {onTime.late} atrasada(s)</span>
            </div>
          )}
        </Section>
      </div>

      <div className="prj-cols">
        <Section title="Entregas por semana" sub="Tasks concluídas por semana; marcadores = marcos e épicos concluídos"
          footer={weeklyEvents.length ? `${weeklyEvents.length} marco(s)/épico(s) no período — passe o mouse no marcador.` : undefined}>
          {insights.weekly.every((w) => w.completed === 0) ? <p className="prj-note">Nenhuma entrega no período.</p> : (
            <TimeSeriesChart ariaLabel="Entregas por semana" height={240} points events={weeklyEvents}
              xLabel={shortDay} tooltipTitle={(w) => `Semana de ${shortDay(w)}`}
              data={insights.weekly.map((w) => ({ x: w.week, completed: w.completed }))}
              series={[{ key: 'completed', label: 'Concluídas', color: 'var(--accent)' }]} />
          )}
        </Section>

        {insights.burndown ? (
          <Section title={`Burndown — ${insights.burndown.sprint.name}`} sub={`${insights.burndown.unit === 'pontos' ? 'Pontos' : 'Tasks'} restantes × faixa ideal (±15%) de ${shortDay(insights.burndown.sprint.start)} a ${shortDay(insights.burndown.sprint.end)}`}>
            <TimeSeriesChart ariaLabel="Burndown da sprint" height={240}
              band={{ lowerKey: 'low', upperKey: 'high', label: 'Faixa ideal' }}
              data={insights.burndown.days.map((d) => ({ x: d.date, remaining: d.remaining, ideal: d.ideal, low: Math.max(0, Math.round(d.ideal * 0.85 * 10) / 10), high: Math.round(d.ideal * 1.15 * 10) / 10 }))}
              series={[
                { key: 'remaining', label: 'Restante', color: 'var(--accent)', type: 'line' },
                { key: 'ideal', label: 'Ideal', color: 'var(--text-3)', type: 'line', dashed: true },
              ]} />
          </Section>
        ) : (
          <Section title="Burndown da sprint" sub="Aparece quando houver uma sprint ativa (ou concluída) com datas de início e fim.">
            <p className="prj-note">Sem sprint com datas. Crie uma sprint em Configurações → Sprints e coloque tasks nela.</p>
          </Section>
        )}
      </div>

      <Section title="Fluxo cumulativo" sub="Concluídas acumuladas e tasks em aberto, dia a dia (90 dias)"
        footer={last && first ? `${doneInPeriod} concluída(s) e ${createdInPeriod} criada(s) no período · em aberto: ${first.open} → ${last.open}` : undefined}>
        <TimeSeriesChart ariaLabel="Fluxo cumulativo de tasks" stacked height={250}
          data={insights.daily.map((d) => ({ x: d.date, doneTotal: d.doneTotal, open: d.open }))}
          series={[
            { key: 'doneTotal', label: 'Concluídas (acumulado)', color: 'var(--accent)' },
            { key: 'open', label: 'Em aberto', color: 'var(--text-3)' },
          ]} />
      </Section>
    </>
  )
}

export function InsightsLoading() {
  return <Loading size="compact" label="Carregando gráficos…" style={{ minHeight: 300 }} />
}
