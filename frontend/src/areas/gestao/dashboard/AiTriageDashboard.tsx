import { useEffect, useState, type CSSProperties } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { Btn, Card, Figures, Sel, StatCard, Loading } from '@/components/ui'
import { aiService, type AiInsights } from '@/services/aiService'
import { adminService } from '@/services/adminService'
import { spDate } from '@/components/AiInsightsUi'
import { FunnelBars } from '@/components/charts/FunnelBars'
import { AxisBars } from '@/components/charts/AxisBars'
import { BarList } from '@/components/charts/BarList'
import { DashHead } from './parts'

// Gestor: como a triagem da IA está indo (automática x manual, reclassificação, acurácia, tempo até a atribuição).

const fmtInt = (n: number) => n.toLocaleString('pt-BR')
const fmtPct = (r: number) => `${Math.round(r * 100)}%`
/** 80 -> "1h 20min" (mesmo formato do dashboard de SLA). */
export { fmtMinutes } from '@/utils/duration'
import { fmtMinutes } from '@/utils/duration'

const FIELD_LABEL: Record<string, string> = { type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', priority: 'Prioridade' }

export function AiTriageDashboard({ orgs }: { orgs: any[] }) {
  const [from, setFrom] = useState(() => spDate(29))
  const [to, setTo] = useState(() => spDate())
  const [orgId, setOrgId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<AiInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { adminService.getCategories().then(c => setCategories(c ?? [])).catch(() => {}) }, [])

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    aiService.getInsights({ from, to, org_id: orgId || undefined, category_id: categoryId || undefined })
      .then(d => { if (alive) setData(d) })
      .catch((e: any) => {
        if (!alive) return
        setData(null)
        setError(e?.response?.status === 400 && typeof e.response.data?.error === 'string'
          ? e.response.data.error
          : 'Não foi possível carregar os indicadores da triagem.')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to, orgId, categoryId, tick])
  const load = () => setTick(t => t + 1)

  return (
    <div className="dash-page" aria-busy={loading}>
      <DashHead title="Triagem IA" sub="Acurácia e uso da triagem automática">
        <label className="dash-field">De<input type="date" value={from} max={to || undefined} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="dash-field">Até<input type="date" value={to} min={from || undefined} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <label className="dash-field">Empresa
          <Sel value={orgId} onChange={e => setOrgId(e.target.value)} style={{ minHeight: 36, padding: '4px 8px', minWidth: 150 }}>
            <option value="">Todas</option>
            {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Sel>
        </label>
        <label className="dash-field">Categoria
          <Sel value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ minHeight: 36, padding: '4px 8px', minWidth: 150 }}>
            <option value="">Todas</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Sel>
        </label>
      </DashHead>

      {error && (
        <div role="alert" className="notice" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="urgent">{error}</span>
          <Btn variant="secondary" size="sm" onClick={load}>Tentar de novo</Btn>
        </div>
      )}

      {!error && !data && loading && <Loading />}

      {data?.empty && <p className="empty-line"><strong style={{ display: 'block', fontWeight: 500, color: 'var(--text-1)' }}>Nenhum chamado no período</strong>Não há chamados para os filtros escolhidos. Amplie o período ou limpe a empresa e a categoria.</p>}

      {data && !data.empty && (
        <>
          <Figures>
            <StatCard label={<span title="Chamados que passaram pela triagem da IA.">Chamados triados</span>} value={fmtInt(data.triaged)} sub={`de ${fmtInt(data.tickets)} chamados`} />
            <StatCard label={<span title="A IA aplicou ao menos um campo.">Triagem automática</span>} value={fmtPct(data.automatic_rate)} sub={`${fmtInt(data.automatic)} chamados`} />
            <StatCard label={<span title="Triados sem nada aplicado (sugestão ou sombra).">Triagem manual</span>} value={data.triaged ? fmtPct(data.manual / data.triaged) : '—'} sub={`${fmtInt(data.manual)} chamados`} />
            <StatCard label={<span title="Campo aplicado pela IA e desfeito por uma pessoa (% das automáticas).">Reclassificação</span>} value={fmtPct(data.reclassification_rate)} sub={`${fmtInt(data.reclassified)} chamados`} />
            <StatCard label={<span title="Marcados como incompletos; complementado = o cliente respondeu.">Sem informação</span>} value={fmtInt(data.intake.incomplete)} sub={`${fmtInt(data.intake.complemented)} complementados`} />
            <StatCard label={<span title={`O cliente resolveu com a orientação da ${SKADI_NAME}, sem atendimento.`}>Deflexões</span>} value={fmtInt(data.guidance.deflected)} sub={`${fmtInt(data.guidance.linked)} vinculados a duplicado`} />
          </Figures>

          <div className="two-col">
            <Card className="sect">
              <h3>Acurácia por campo</h3>
              <p>Valor da IA comparado ao valor final em chamados resolvidos ou fechados (vale também no modo sombra).</p>
              <div className="sect-body">
                <AxisBars ariaLabel="Acurácia da IA por campo" label="Acurácia"
                  axes={data.accuracy.map(r => ({ id: r.field, label: FIELD_LABEL[r.field] ?? r.field, value: r.total ? r.rate : null, hint: r.total ? `${fmtInt(r.correct)} de ${fmtInt(r.total)} corretos` : 'Sem chamados avaliados' }))} />
              </div>
            </Card>
            <Card className="sect">
              <h3>Tempo até a atribuição</h3>
              <p>Do chamado aberto até ter um responsável. {fmtInt(data.time_to_assign.triaged.count)} chamados com triagem, {fmtInt(data.time_to_assign.not_triaged.count)} sem.</p>
              <div className="sect-body">
                <BarList ariaLabel="Tempo até a atribuição com e sem triagem IA" format={fmtMinutes}
                  items={[
                    { id: 'med-ia', group: 'Mediana', label: 'Com triagem IA', value: data.time_to_assign.triaged.median_minutes as number, hint: `${fmtInt(data.time_to_assign.triaged.count)} chamados` },
                    { id: 'med-no', group: 'Mediana', label: 'Sem triagem', value: data.time_to_assign.not_triaged.median_minutes as number, color: 'var(--text-3)', hint: `${fmtInt(data.time_to_assign.not_triaged.count)} chamados` },
                    { id: 'p90-ia', group: 'p90 (9 em 10 chamados até)', label: 'Com triagem IA', value: data.time_to_assign.triaged.p90_minutes as number },
                    { id: 'p90-no', group: 'p90 (9 em 10 chamados até)', label: 'Sem triagem', value: data.time_to_assign.not_triaged.p90_minutes as number, color: 'var(--text-3)' },
                  ].filter(it => it.value !== null)} />
              </div>
            </Card>
          </div>
          <Card className="sect">
            <h3>Do chamado à triagem aceita</h3>
            <p>Quantos chamados chegam a cada etapa da triagem automática no período.</p>
            <div className="sect-body" style={{ '--label-w': '260px' } as CSSProperties}>
              <FunnelBars ariaLabel="Funil da triagem por IA" steps={[
                { id: 'tickets', label: 'Chamados', value: data.tickets, color: 'var(--text-3)' },
                { id: 'triaged', label: 'Triados pela IA', value: data.triaged },
                { id: 'automatic', label: 'Aplicados automaticamente', value: data.automatic },
                { id: 'kept', label: 'Mantidos (sem reclassificação)', value: Math.max(0, data.automatic - data.reclassified), hint: 'Aplicados pela IA e não desfeitos por ninguém' },
              ]} />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
