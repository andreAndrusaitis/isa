import { Fragment, useState, useEffect, useCallback } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { AnalystWorkload } from '@/types'
import { Meter, SortHeader, StatusBadge, TruncatedText, Loading } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { Choice, DashHead } from './parts'

const PERIOD_OPTIONS = [['7d', '7 dias'], ['30d', '30 dias'], ['90d', '3 meses'], ['365d', '1 ano']] as const
const ROLES: Record<string, string> = { admin: 'Administrador', manager: 'Gerente', supervisor: 'Ticket Manager', agent: 'Analista' }

export function ProductivityDashboard() {
  const [data, setData] = useState<AnalystWorkload[]>([])
  const [period, setPeriod] = useState<string>('30d')
  const [expanded, setExpanded] = useState<string | null>(null)
  const colSort = useTableSort<string>()
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await dashboardService.getProductivity({ period })
      setData(d)
    } catch (err) {
      console.error('[ProductivityDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const maxResolved = Math.max(...data.map(d => d.resolved), 1)

  return (
    <div className="dash-page">
      <DashHead title="Produtividade dos analistas" sub="Ordenada pelos chamados resolvidos no período">
        <Choice label="Período" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </DashHead>

      {loading ? (
        <Loading label="Carregando produtividade…" />
      ) : data.length === 0 ? (
        <p className="empty-line">Nenhum analista encontrado</p>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr>{['#', 'Analista', 'Resolvidos', 'Ativos', 'Reabertos', 'Tempo médio', 'SLA %'].map(h => <th key={h}><SortHeader label={h} {...colSort.header(h)} /></th>)}</tr></thead>
            <tbody>
              {/* idx = posição original no ranking (não muda ao reordenar) */}
              {colSort.apply(data.map((item, idx) => ({ item, idx })), {
                '#': r => r.idx,
                'Analista': r => r.item.analyst.name,
                'Ativos': r => r.item.active,
                'Resolvidos': r => r.item.resolved,
                'Reabertos': r => r.item.reopened,
                'Tempo médio': r => r.item.avgResolutionHours,
                'SLA %': r => r.item.slaRate,
              }).map(({ item, idx }) => {
                const open = expanded === item.analyst.id
                return (
                  <Fragment key={item.analyst.id}>
                    <tr data-link="" className={open ? 'open' : undefined} onClick={() => setExpanded(open ? null : item.analyst.id)}>
                      <td className="id">{idx + 1}</td>
                      <td>{item.analyst.name}<br /><small>{ROLES[item.analyst.role] ?? item.analyst.role}</small></td>
                      <td className="num" style={{ width: '28%' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 28 }}>{item.resolved}</span><Meter value={item.resolved} max={maxResolved} /></span>
                      </td>
                      <td className="num">{item.active}</td>
                      <td className="num">{item.reopened}</td>
                      <td className="num">{item.avgResolutionHours}h</td>
                      <td className={`num ${item.slaRate < 70 ? 'urgent' : ''}`}>{item.slaRate}%</td>
                    </tr>
                    {open && (
                      <tr className="detail">
                        <td colSpan={7}>
                          {item.activeTickets.length === 0 ? <p className="empty-line" style={{ padding: 0 }}>Nenhum chamado ativo no momento.</p> : (
                            <table className="table">
                              <caption style={{ padding: '4px 0 8px', textAlign: 'left', fontSize: 13, color: 'var(--text-3)' }}>Chamados ativos de {item.analyst.name.split(' ')[0]} ({item.activeTickets.length})</caption>
                              <tbody>
                                {item.activeTickets.map(t => (
                                  <tr key={t.id}>
                                    <td className="id">{t.display_number}</td>
                                    <td className="main"><TruncatedText text={t.title} /></td>
                                    <td>{t.queue}</td>
                                    <td><StatusBadge status={t.status} compact /></td>
                                    <td className={`num ${new Date(t.sla_deadline) < new Date() ? 'urgent' : ''}`}>SLA: {new Date(t.sla_deadline).toLocaleDateString('pt-BR')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
