import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { adminService } from '@/services/adminService'
import { PageHeader, Btn, Pagination, Modal, Loading } from '@/components/ui'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { csvCell } from '@/utils/exportSafety'
import './admin.css'

type Mode = 'send' | 'ticket'
type TicketRef = { id: string; display_number: string; title: string } | null

const KIND_LABEL: Record<string, string> = {
  ticket_created: 'Abertura do chamado',
  ticket_update: 'Atualização do chamado',
  auto_reply: 'Resposta automática',
  survey: 'Pesquisa de satisfação',
  survey_resend: 'Reenvio de pesquisa',
  welcome: 'Boas-vindas',
}
const STATUS: Record<string, string> = {
  SUCCESS: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED_ACS_NOT_CONFIGURED: 'Não enviado (sem provedor)',
}
const PROVIDER_LABEL: Record<string, string> = { graph: 'Caixa de atendimento', acs: 'ACS (DoNotReply)' }
const EMPTY = { kind: '', status: '', search: '', startDate: '', endDate: '' }

const fmt = (d: string) => new Date(d).toLocaleString('pt-BR')

function TicketCell({ ticket, onOpen }: { ticket: TicketRef; onOpen?: (id: string) => void }) {
  if (!ticket) return <span style={{ color: 'var(--text-3)' }}>— sem chamado</span>
  return (
    <button type="button" className="adm-link" onClick={() => onOpen?.(ticket.id)} aria-label={`Abrir chamado ${ticket.display_number}`} title={ticket.title}>
      <span>{ticket.display_number}</span><span>{ticket.title}</span>
    </button>
  )
}

const StatusText = ({ status }: { status: string }) =>
  <span style={status === 'SUCCESS' ? undefined : { color: 'var(--danger)' }}>{STATUS[status] ?? status}</span>

/** Detalhe de um envio: metadados, erro completo e o e-mail como foi (ou seria) entregue. */
function EmailLogDetail({ id, onClose, onOpenTicket }: { id: string; onClose: () => void; onOpenTicket?: (id: string) => void }) {
  const [log, setLog] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    adminService.getEmailLog(id)
      .then(d => alive && setLog(d))
      .catch(() => alive && setError('Não foi possível carregar o detalhe do e-mail.'))
    return () => { alive = false }
  }, [id])

  // Erros do ACS chegam como JSON serializado: indenta para leitura.
  const prettyError = (e: string) => { try { return JSON.stringify(JSON.parse(e), null, 2) } catch { return e } }
  const field = (k: string, v: React.ReactNode) => (
    <div className="setting" style={{ padding: '10px 0', gridTemplateColumns: 'minmax(0, 170px) minmax(0, 1fr)', gap: 16, fontSize: 14 }}>
      <div style={{ color: 'var(--text-3)' }}>{k}</div><div style={{ minWidth: 0, wordBreak: 'break-word' }}>{v}</div>
    </div>
  )

  return (
    <Modal isOpen onClose={onClose} title="Detalhe do e-mail" width={820}>
      {error ? <p role="alert" className="adm-error">{error}</p> : !log ? (
        <Loading size="compact" />
      ) : <>
        {field('Assunto', log.subject)}
        {field('Status', <StatusText status={log.status} />)}
        {field('Data/hora', fmt(log.created_at))}
        {field('Tipo', KIND_LABEL[log.kind] ?? log.kind)}
        {field('Destinatário', log.recipient)}
        {field('Chamado', <TicketCell ticket={log.ticket} onOpen={t => { onClose(); onOpenTicket?.(t) }} />)}
        {field('Enviado por', log.provider ? PROVIDER_LABEL[log.provider] ?? log.provider : '—')}
        {field('Resposta do cliente', log.replyable ? 'Aceita (entra no chamado)' : 'Não aceita')}
        {log.error && field('Mensagem de falha',
          <pre className="adm-mono" style={{ margin: 0, color: 'var(--danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto' }}>{prettyError(log.error)}</pre>)}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <p className="adm-note" style={{ paddingBottom: 8 }}>{log.status === 'SUCCESS' ? 'E-mail enviado' : 'E-mail que seria enviado'}</p>
          {log.html ? (
            // sandbox vazio: sem scripts, sem navegação, sem acesso à origem do app.
            <iframe title="Conteúdo do e-mail" sandbox="" srcDoc={log.html} style={{ width: '100%', height: 480, border: '1px solid var(--border)', background: '#fff' }} />
          ) : (
            <p className="adm-note">Conteúdo não registrado: envio anterior ao armazenamento do corpo do e-mail.</p>
          )}
        </div>
      </>}
    </Modal>
  )
}

function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => csvCell(c)).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}_${new Date().toISOString().slice(0, 10)}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

export function EmailLogsPanel({ onOpenTicket, showHeader = true }: { onOpenTicket?: (ticketId: string) => void; showHeader?: boolean }) {
  const [mode, setMode] = useState<Mode>('send')
  const [filters, setFilters] = useState(EMPTY)
  const [ticket, setTicket] = useState<TicketRef>(null) // drill-down vindo da visão "Por chamado"
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const params = { ...filters, ticketId: ticket?.id ?? '', groupBy: mode === 'ticket' ? 'ticket' : '' }
  const setFilter = (k: keyof typeof EMPTY, v: string) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }

  useEffect(() => {
    let alive = true
    setLoading(true)
    adminService.getEmailLogs({ ...params, page, limit: pageSize })
      .then(d => { if (alive) { setItems(d.items); setTotal(d.total); setError('') } })
      .catch(() => alive && setError('Não foi possível carregar os logs de e-mail.'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [mode, filters, ticket, page, pageSize])

  const exportCsv = async () => {
    const d = await adminService.getEmailLogs({ ...params, limit: 1000 })
    if (mode === 'ticket') {
      downloadCsv('emails_por_chamado', ['Chamado', 'Título', 'Envios', 'Falhas', 'Tipos', 'Último envio'],
        d.items.map((g: any) => [g.ticket?.display_number, g.ticket?.title, g.total, g.failed,
          Object.entries(g.kinds).map(([k, n]) => `${KIND_LABEL[k] ?? k}: ${n}`).join('; '), fmt(g.last_sent_at)]))
    } else {
      downloadCsv('emails_enviados', ['Data/hora', 'Tipo', 'Destinatário', 'Assunto', 'Chamado', 'Status', 'Erro'],
        d.items.map((l: any) => [fmt(l.created_at), KIND_LABEL[l.kind] ?? l.kind, l.recipient, l.subject,
          l.ticket?.display_number ?? '', STATUS[l.status] ?? l.status, l.error ?? '']))
    }
  }

  // Troca de visão limpa as linhas: o formato muda (envio x grupo) e a linha antiga quebraria o render.
  const switchView = (m: Mode, t: TicketRef) => { setItems([]); setMode(m); setTicket(t); setPage(1) }

  return (
    <div>
      {showHeader && <PageHeader title="Logs de e-mail" subtitle="Todo e-mail disparado pelo sistema: atualizações de chamado, pesquisas e boas-vindas" />}
      <div style={{ padding: '0 var(--page-gutter) 40px' }}>
        <div className="adm-filters">
          <label className="grow">Busca
            <input type="search" placeholder="Destinatário, assunto, nº do chamado..." maxLength={100} value={filters.search} onChange={e => setFilter('search', e.target.value)} />
          </label>
          <div className="field">Tipo
            <FilterSelect value={filters.kind} onChange={v => setFilter('kind', v)}>
              <option value="">Todos</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </FilterSelect>
          </div>
          <div className="field">Status
            <FilterSelect value={filters.status} onChange={v => setFilter('status', v)}>
              <option value="">Todos</option>
              {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </FilterSelect>
          </div>
          <label>De<input type="date" value={filters.startDate} onChange={e => setFilter('startDate', e.target.value)} /></label>
          <label>Até<input type="date" value={filters.endDate} onChange={e => setFilter('endDate', e.target.value)} /></label>
        </div>
        <div className="adm-tools">
          <div role="tablist" aria-label="Agrupamento" className="subtabs" style={{ marginLeft: -14 }}>
            {([['send', 'Por envio'], ['ticket', 'Por chamado']] as const).map(([m, txt]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => mode !== m && switchView(m, null)}>{txt}</button>
            ))}
          </div>
          {ticket && (
            <span title={ticket.title} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 13.5 }}>
              Chamado {ticket.display_number}
              <button type="button" className="icon-act" aria-label="Remover filtro de chamado" onClick={() => { setTicket(null); setPage(1) }}><X size={14} aria-hidden /></button>
            </span>
          )}
          <Btn variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={exportCsv} disabled={total === 0}>Exportar CSV</Btn>
          <Pagination variant="toolbar" page={page} pageSize={pageSize} total={total} onPageChange={setPage}
            onPageSizeChange={n => { setPageSize(n); setPage(1) }} label={mode === 'ticket' ? 'chamados' : 'envios'} />
        </div>

        {error ? <p role="alert" className="adm-error">{error}</p>
          : loading && items.length === 0 ? <Loading label="Carregando logs de e-mail…" />
          : <div className="adm-scroll">{mode === 'send' ? (
            <table className="table" aria-label="E-mails enviados" style={{ minWidth: 900 }}>
              <thead><tr>{['Data/hora', 'Tipo', 'Destinatário / assunto', 'Chamado', 'Status'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>Nenhum e-mail encontrado. Não há envios registrados para os filtros selecionados.</td></tr>}
                {items.map(l => (
                  <tr key={l.id} className="email-log-row" tabIndex={0} aria-label={`Ver detalhe do e-mail para ${l.recipient}`} style={{ cursor: 'pointer' }}
                    onClick={() => setDetailId(l.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetailId(l.id) } }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(l.created_at)}</td>
                    <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td style={{ maxWidth: 280 }}>
                      <span className="adm-clip">{l.recipient}</span>
                      <span className="adm-clip adm-sub" title={l.subject}>{l.subject}</span>
                    </td>
                    <td style={{ maxWidth: 240 }} onClick={e => e.stopPropagation()}><TicketCell ticket={l.ticket} onOpen={onOpenTicket} /></td>
                    <td style={{ maxWidth: 200 }}>
                      <StatusText status={l.status} />
                      {l.error && <span className="adm-clip adm-sub" title={l.error}>{l.error}</span>}
                      {l.provider && <div className="adm-sub">{l.provider === 'graph' ? 'via caixa' : 'via ACS'}{l.replyable ? ' · aceita resposta' : ''}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table" aria-label="E-mails por chamado" style={{ minWidth: 900 }}>
              <thead><tr>{['Chamado', 'Envios', 'Falhas', 'Tipos', 'Último envio'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>Nenhum e-mail encontrado. Não há envios registrados para os filtros selecionados.</td></tr>}
                {items.map(g => (
                  <tr key={g.ticket_id}>
                    <td style={{ maxWidth: 320 }}><TicketCell ticket={g.ticket} onOpen={onOpenTicket} /></td>
                    <td><button type="button" className="adm-link" onClick={() => switchView('send', g.ticket)} aria-label={`Ver os ${g.total} envios do chamado ${g.ticket?.display_number ?? ''}`}><span>{g.total}</span></button></td>
                    <td style={g.failed > 0 ? { color: 'var(--danger)' } : { color: 'var(--text-3)' }}>{g.failed}</td>
                    <td>{Object.entries(g.kinds as Record<string, number>).map(([k, n]) => `${KIND_LABEL[k] ?? k} (${n})`).join(', ')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(g.last_sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}</div>}
      </div>
      {detailId && <EmailLogDetail id={detailId} onClose={() => setDetailId(null)} onOpenTicket={onOpenTicket} />}
    </div>
  )
}
