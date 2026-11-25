/**
 * Carteira (gerente): três respostas em frase antes da reunião e, embaixo, a tabela
 * que prova. O relatório de um cliente sai pronto, sem dado de pessoa da equipe.
 */
import { useEffect, useState } from 'react'
import { Btn, EmptyState, Loading, Modal, PageHeader } from '@/components/ui'
import { homesService, type Portfolio, type PortfolioClient } from '@/services/homesService'
import { toast } from '@/store/toastStore'
import './home.css'

const DAYS = [30, 90]
const pts = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'ponto' : 'pontos'}`
const delta = (now: number | null, before: number | null) => (now === null || before === null ? null : now - before)

/** O que observar em um cliente, do mais grave ao mais leve. */
export function clientNote(c: PortfolioClient): { text: string; level: 0 | 1 | 2 } {
  const working = c.active - c.paused
  if (c.overdue > 0 && c.overdue * 2 >= working) return { text: `${c.overdue} de ${working} em atendimento já venceram`, level: 2 }
  const d = delta(c.rate, c.previous)
  if (d !== null && d <= -10) return { text: `Caiu ${pts(d)} no período`, level: 2 }
  if (c.overdue > 0) return { text: `${c.overdue} ${c.overdue === 1 ? 'vencido' : 'vencidos'}`, level: 1 }
  if (c.openedBefore >= 3 && c.opened >= c.openedBefore * 1.3) return { text: `Volume cresceu ${Math.round((c.opened / c.openedBefore - 1) * 100)}%`, level: 1 }
  if (c.csat !== null && c.csat < 3.5) return { text: `Satisfação em ${fmt(c.csat)}`, level: 1 }
  return { text: 'Nada a fazer', level: 0 }
}
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** Texto do relatório de um cliente: só números dele, nada da equipe. */
export function reportText(c: PortfolioClient, p: Pick<Portfolio, 'from' | 'to' | 'days'>): string {
  const date = (s: string) => new Date(s).toLocaleDateString('pt-BR')
  const d = delta(c.rate, c.previous)
  return [
    `${c.org.name}: atendimento de ${date(p.from)} a ${date(p.to)}`,
    '',
    c.rate === null ? 'Nenhum chamado concluído ou vencido no período.' : `${c.rate}% dos chamados dentro do prazo (${c.done} de ${c.done + c.late}).`,
    d === null ? null : d === 0 ? `Igual aos ${p.days} dias anteriores.` : `${pts(d)} ${d > 0 ? 'acima' : 'abaixo'} dos ${p.days} dias anteriores.`,
    `${c.opened} ${c.opened === 1 ? 'chamado aberto' : 'chamados abertos'} no período (${c.openedBefore} no anterior).`,
    `Hoje: ${c.active} ${c.active === 1 ? 'ativo' : 'ativos'}${c.paused ? `, ${c.paused} aguardando` : ''}${c.overdue ? `, ${c.overdue} fora do prazo` : ''}.`,
    c.csat === null ? null : `Satisfação: ${fmt(c.csat)} de 5.`,
  ].filter(l => l !== null).join('\n')
}

function Weeks({ values }: { values: (number | null)[] }) {
  return (
    <svg className="hm-weeks" viewBox="0 0 96 28" role="img" aria-label={`No prazo por semana: ${values.map(v => (v === null ? 'sem dados' : `${v}%`)).join(', ')}`}>
      {values.map((v, i) => v === null
        ? <circle key={i} cx={i * 12 + 5} cy="26" r="1.4" fill="var(--border-strong)" />
        : <rect key={i} x={i * 12} y={28 - Math.max(3, v * 0.28)} width="9" height={Math.max(3, v * 0.28)} rx="2.5" fill="var(--c1)" opacity={i === values.length - 1 ? 1 : 0.5} />)}
    </svg>
  )
}

export function PortfolioPage({ onNavigate }: { onNavigate: (action: { view: string; filters?: any }) => void }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState(false)
  const [report, setReport] = useState<PortfolioClient | null>(null)

  useEffect(() => {
    let alive = true
    setError(false)
    homesService.getPortfolio(days).then(d => { if (alive) setData(d) }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [days])

  if (error && !data) return <EmptyState title="Não foi possível carregar a carteira" desc="Verifique a conexão e tente de novo." action={<Btn onClick={() => setDays(d => d)}>Tentar de novo</Btn>} />
  if (!data) return <Loading label="Carregando a carteira…" />

  const { total, causes, clients } = data
  const risk = clients.map(c => ({ c, note: clientNote(c) })).filter(x => x.note.level === 2).sort((a, b) => b.c.overdue - a.c.overdue)
  const change = delta(total.rate, total.previous)
  const cause = causes.category?.name ?? (causes.unassigned ? 'Sem responsável' : causes.person ? 'Sobrecarga' : null)
  const copy = async (c: PortfolioClient) => {
    try { await navigator.clipboard.writeText(reportText(c, data)); toast.success('Texto copiado.') } catch { toast.error('O navegador não deixou copiar. Selecione o texto.') }
  }

  return (
    <div className="hm">
      <PageHeader title="Carteira" subtitle={`${clients.length} ${clients.length === 1 ? 'cliente com movimento' : 'clientes com movimento'}`} actions={
        <div className="subtabs" role="group" aria-label="Período">
          {DAYS.map(d => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} dias</button>)}
        </div>
      } />
      <div className="hm-body">
        <div className="hm-answers">
          <article className="hm-answer">
            <h2>Estamos cumprindo os prazos?</h2>
            <p>{total.rate === null ? 'Sem movimento' : `${total.rate}% no prazo`}</p>
            <small>{total.rate === null ? 'Nada concluído ou vencido no período.' : `${total.done} de ${total.done + total.late}. ${change === null ? 'Sem período anterior para comparar.' : change === 0 ? 'Igual ao período anterior.' : `${pts(change)} ${change > 0 ? 'a mais' : 'a menos'} que no anterior.`}`}</small>
          </article>
          <article className="hm-answer">
            <h2>Quem está em risco?</h2>
            <p>{risk.length ? risk[0].c.org.name : 'Ninguém agora'}</p>
            <small>{risk.length ? `${risk[0].note.text}.${risk.length > 1 ? ` E mais ${risk.length - 1}.` : ''}` : 'Nenhum cliente com vencidos na metade dos ativos ou queda de 10 pontos.'}</small>
          </article>
          <article className="hm-answer">
            <h2>Por quê?</h2>
            <p>{cause ?? 'Nada vencido'}</p>
            <small>{[causes.category && `${causes.category.count} vencidos nessa categoria`, causes.person && `${causes.person.count} com ${causes.person.name}`, causes.unassigned > 0 && `${causes.unassigned} sem responsável`].filter(Boolean).join(', ') || 'A equipe está em dia.'}</small>
          </article>
        </div>

        {clients.length === 0
          ? <EmptyState title="Nenhum cliente com movimento" desc="Quando houver chamados das empresas da sua carteira, elas aparecem aqui." />
          : (
            <div className="hm-table">
              <table className="table">
                <thead><tr><th>Cliente</th><th className="num">No prazo</th><th>Oito semanas</th><th className="num">Ativos</th><th className="num">Vencidos</th><th className="num">Satisfação</th><th>O que observar</th><th /></tr></thead>
                <tbody>
                  {clients.map(c => {
                    const note = clientNote(c)
                    const d = delta(c.rate, c.previous)
                    return (
                      <tr key={c.org.id}>
                        <td><b>{c.org.name}</b><small>{c.org.tier.charAt(0).toUpperCase() + c.org.tier.slice(1)}</small></td>
                        <td className="num"><b className="hm-rate">{c.rate === null ? '—' : `${c.rate}%`}</b>{d !== null && d !== 0 && <small>{d > 0 ? '+' : '−'}{Math.abs(d)} pts</small>}</td>
                        <td><Weeks values={c.weeks} /></td>
                        <td className="num">{c.active}{c.paused > 0 && <small>{c.paused} aguardando</small>}</td>
                        <td className="num" data-late={c.overdue > 0 || undefined}>{c.overdue}</td>
                        <td className="num">{c.csat === null ? '—' : fmt(c.csat)}</td>
                        <td data-level={note.level}>{note.text}</td>
                        <td className="hm-row-actions">
                          <Btn size="sm" variant={note.level === 2 ? 'secondary' : 'ghost'} onClick={() => onNavigate({ view: 'queue', filters: { orgId: c.org.id, status: 'open,in_progress,pending' } })}>Chamados</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setReport(c)}>Relatório</Btn>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        <p className="hm-note">No prazo: concluídos até a data do plano, sobre concluídos mais os que venceram e seguem abertos no período. {data.csat.score !== null && `Satisfação geral ${fmt(data.csat.score)} de 5, com ${data.csat.responses} ${data.csat.responses === 1 ? 'resposta' : 'respostas'}.`}</p>
      </div>

      <Modal isOpen={!!report} onClose={() => setReport(null)} title="Relatório do cliente" width={520}
        footer={<><Btn variant="ghost" onClick={() => setReport(null)}>Fechar</Btn><Btn onClick={() => report && void copy(report)}>Copiar texto</Btn></>}>
        {report && <><pre className="hm-report">{reportText(report, data)}</pre><Weeks values={report.weeks} /></>}
      </Modal>
    </div>
  )
}
