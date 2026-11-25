import { useEffect, useState } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { Btn, Card, Figures, Sel, StatCard, Loading } from '@/components/ui'
import { aiService, type KnowledgeMetrics } from '@/services/aiService'
import { spDate } from '@/components/AiInsightsUi'
import { BarList } from '@/components/charts/BarList'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { DashHead } from './parts'

// Gerente e admin: quanto a base de conhecimento resolve sem chegar à equipe.

const fmtInt = (n: number) => n.toLocaleString('pt-BR')
const fmtPct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const axisDate = (d: string) => {
  const [year, month, day] = d.split('-')
  return day ? `${day}/${month}` : `${MONTHS[Number(month) - 1]}/${year.slice(2)}`
}

/** Taxa contra a meta: a barra dá a noção de distância, o texto dá o número. */
function TargetMeter({ rate, target }: { rate: number | null; target: number }) {
  const pct = Math.min(100, Math.round((rate ?? 0) * 100))
  const goal = Math.round(target * 100)
  const gap = goal - Math.round((rate ?? 0) * 100)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 34, fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1.1, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(rate)}</span>
        <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
          {rate === null ? `Meta: ${goal}%` : gap > 0 ? `Faltam ${gap} pontos para a meta de ${goal}%` : `Meta de ${goal}% atingida`}
        </span>
      </div>
      <div role="meter" aria-label={`Chamados resolvidos pela ${SKADI_NAME}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${fmtPct(rate)}, meta de ${goal}%`}
        style={{ position: 'relative', height: 14, marginTop: 12, background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-card))' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
        <div aria-hidden title={`Meta: ${goal}%`} style={{ position: 'absolute', left: `${goal}%`, top: -3, bottom: -3, width: 2, background: 'var(--text-1)' }} />
      </div>
    </div>
  )
}

export function KnowledgeMetricsDashboard({ orgs }: { orgs: any[] }) {
  const [from, setFrom] = useState(() => spDate(29))
  const [to, setTo] = useState(() => spDate())
  const [orgId, setOrgId] = useState('')
  const [data, setData] = useState<KnowledgeMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    aiService.getKnowledgeMetrics({ from, to, org_id: orgId || undefined })
      .then(d => { if (alive) setData(d) })
      .catch((e: any) => {
        if (!alive) return
        setData(null)
        setError(e?.response?.status === 400 && typeof e.response.data?.error === 'string'
          ? e.response.data.error
          : 'Não foi possível carregar as métricas da base de conhecimento.')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to, orgId, tick])

  const r = data?.resolution
  const rated = data ? data.feedback.useful + data.feedback.not_useful : 0

  return (
    <div className="dash-page" aria-busy={loading}>
      <DashHead title="Base de conhecimento" sub={`O que a ${SKADI_NAME} resolve sozinha com os artigos da base`}>
        <label className="dash-field">De<input type="date" value={from} max={to || undefined} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="dash-field">Até<input type="date" value={to} min={from || undefined} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <label className="dash-field">Empresa
          <Sel value={orgId} onChange={e => setOrgId(e.target.value)} style={{ minHeight: 36, padding: '4px 8px', minWidth: 150 }}>
            <option value="">Todas</option>
            {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Sel>
        </label>
      </DashHead>

      {error && (
        <div role="alert" className="notice" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="urgent">{error}</span>
          <Btn variant="secondary" size="sm" onClick={() => setTick(t => t + 1)}>Tentar de novo</Btn>
        </div>
      )}

      {!error && !data && loading && <Loading />}

      {data?.empty && <p className="empty-line"><strong style={{ display: 'block', fontWeight: 500, color: 'var(--text-1)' }}>Nada no período</strong>Não há chamados nem interações com a {SKADI_NAME} para os filtros escolhidos. Amplie o período ou limpe a empresa.</p>}

      {data && r && !data.empty && (
        <>
          <Figures>
            <StatCard label={<span title="Útil ÷ (Útil + Não útil). Quem não avaliou não entra.">Feedback útil</span>} value={fmtPct(data.feedback.rate)} sub={`${fmtInt(data.feedback.useful)} de ${fmtInt(rated)} avaliações`} />
            <StatCard label={<span title={`Perguntas feitas à ${SKADI_NAME} no período, inclusive em modo sombra.`}>Interações</span>} value={fmtInt(data.interactions.total)} sub={`${fmtInt(data.interactions.answered)} com resposta`} />
          </Figures>

          <div className="two-col">
            <Card className="sect">
              <h3>Chamados resolvidos pela {SKADI_NAME}</h3>
              <p>Abertos no período e resolvidos sem chegar à equipe.</p>
              <div className="sect-body">
                <TargetMeter rate={r.rate} target={r.target} />
                <p style={{ margin: '16px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-2)' }}>
                  Resolvidos pela {SKADI_NAME} ÷ (resolvidos pela {SKADI_NAME} + abertos para a equipe) = {fmtInt(r.ai_resolved)} ÷ ({fmtInt(r.ai_resolved)} + {fmtInt(r.team_opened)})
                  {r.rate !== null && ` = ${fmtPct(r.rate)}`}. Chamado reaberto deixa de contar para a {SKADI_NAME} e passa a ser da equipe.
                </p>
              </div>
            </Card>
            <Card className="sect">
              <h3>Artigos mais usados</h3>
              <p>Quantas respostas citaram cada artigo no período.</p>
              <div className="sect-body">
                <BarList ariaLabel="Artigos mais usados" labelWidth={220} emptyText="Nenhuma resposta citou artigos no período."
                  items={data.top_articles.map(a => ({ id: a.article_id, label: a.title, value: a.uses }))} />
              </div>
            </Card>
          </div>
          <Card className="sect">
            <h3>Interações por período</h3>
            <p>{data.interactions.bucket === 'month' ? 'Total por mês.' : 'Total por dia.'}</p>
            <div className="sect-body">
              <TimeSeriesChart ariaLabel="Interações por período" height={220} xLabel={axisDate} tooltipTitle={axisDate}
                data={data.interactions.series.map(p => ({ x: p.date, count: p.count }))}
                series={[{ key: 'count', label: 'Interações', color: 'var(--accent)', type: 'bar' }]} />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
