import { useEffect, useState } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { Btn, Loading } from '@/components/ui'
import { Choice, DashHead } from './parts'

// Métricas de atendimento por canal de origem.
export type ChannelMetrics = {
  channel: 'portal' | 'email' | 'api' | 'teams' | 'copilot' | 'unknown'
  tickets: number
  avgOpeningSeconds: number | null
  resolved: number
  firstContactRate: number | null
  avgFirstResponseHours: number | null
  responded: number
  csat: number | null
  csatResponses: number
}

export const CHANNEL_LABEL: Record<ChannelMetrics['channel'], string> = {
  portal: 'Portal',
  email: 'E-mail',
  api: 'API',
  teams: 'Teams',
  copilot: 'Copilot',
  unknown: 'Não identificado',
}

const PERIODS = [[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], [365, '1 ano']] as const
const num = (n: number, digits = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits })

export function formatOpening(seconds: number | null) {
  if (seconds == null) return '—'
  return seconds < 60 ? `${num(seconds, 0)} s` : `${num(seconds / 60)} min`
}

/** CSV com ";" e vírgula decimal, que o Excel em português abre direto. */
export function channelsCsv(rows: ChannelMetrics[]) {
  const header = ['Canal', 'Chamados', 'Tempo médio de abertura (s)', 'Resolvidos', 'Resolvidos no 1º contato (%)', '1ª resposta média (h úteis)', 'Respondidos', 'CSAT (0-100)', 'Respostas da pesquisa']
  const cell = (v: number | null) => (v == null ? '' : num(v))
  const lines = rows.map((r) => [CHANNEL_LABEL[r.channel], r.tickets, cell(r.avgOpeningSeconds), r.resolved, cell(r.firstContactRate), cell(r.avgFirstResponseHours), r.responded, cell(r.csat), r.csatResponses].join(';'))
  return [header.join(';'), ...lines].join('\n')
}

function downloadCsv(rows: ChannelMetrics[], days: number) {
  const blob = new Blob(['﻿' + channelsCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `metricas_por_canal_${days}d_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ChannelsDashboard() {
  const [days, setDays] = useState<number>(30)
  const [rows, setRows] = useState<ChannelMetrics[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError(false)
    const from = new Date(Date.now() - days * 86_400_000).toISOString()
    dashboardService.getChannels({ from })
      .then((d: { channels: ChannelMetrics[] }) => { if (alive) setRows(d.channels) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [days])

  return (
    <div className="dash-page">
      <DashHead title="Canais de atendimento" sub="De onde os chamados chegam e como são atendidos">
        <Choice label="Período" options={PERIODS} value={days} onChange={setDays} />
        <Btn variant="secondary" size="sm" disabled={!rows?.length} onClick={() => rows && downloadCsv(rows, days)}>Exportar CSV</Btn>
      </DashHead>

      {error ? (
        <p className="empty-line">Não foi possível carregar as métricas por canal. Troque o período ou atualize a página para tentar de novo.</p>
      ) : !rows ? (
        <Loading label="Carregando dashboard…" />
      ) : rows.length === 0 ? (
        <p className="empty-line">Nenhum chamado aberto no período.</p>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>{['Canal', 'Chamados', 'Tempo de abertura', 'Resolvidos no 1º contato', '1ª resposta', 'CSAT'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channel}>
                  <td>{CHANNEL_LABEL[r.channel]}</td>
                  <td className="num">{r.tickets.toLocaleString('pt-BR')}</td>
                  <td className="num">{formatOpening(r.avgOpeningSeconds)}</td>
                  <td className="num">{r.firstContactRate == null ? '—' : `${r.firstContactRate}%`} <small>de {r.resolved} resolvidos</small></td>
                  <td className="num">{r.avgFirstResponseHours == null ? '—' : `${num(r.avgFirstResponseHours)} h úteis`} <small>{r.responded} respondidos</small></td>
                  <td className="num">{r.csat == null ? '—' : num(r.csat)} <small>{r.csatResponses} respostas</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="pairs" style={{ marginTop: 40, maxWidth: 900, fontSize: 13.5 }}>
        <dt>Tempo de abertura</dt><dd>Do formulário aberto ao envio, medido só no portal.</dd>
        <dt>1º contato</dt><dd>Resolvidos com no máximo uma resposta da equipe e sem reabertura (definição provisória, a confirmar com a operação).</dd>
        <dt>1ª resposta</dt><dd>Horas úteis até a primeira resposta pública da equipe.</dd>
        <dt>CSAT</dt><dd>Índice de 0 a 100 da pesquisa de satisfação.</dd>
        <dt>Canal não identificado</dt><dd>Chamados abertos antes do registro do canal.</dd>
      </dl>
    </div>
  )
}
