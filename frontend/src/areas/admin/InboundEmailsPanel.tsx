import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'
import { Pagination, Loading } from '@/components/ui'
import { FilterSelect } from '@/components/filters/FilterSelect'
import './admin.css'

// Desfecho de cada e-mail recebido na caixa de atendimento (inbound_emails.status).
const STATUS: Record<string, string> = {
  ticket_created: 'Chamado aberto',
  message_added: 'Resposta no chamado',
  note_added: 'Nota interna',
  ignored: 'Ignorado',
  failed: 'Falhou (nova tentativa)',
  processing: 'Processando',
}
const EMPTY = { status: '', search: '', startDate: '', endDate: '' }
const fmt = (d: string) => new Date(d).toLocaleString('pt-BR')

/** E-mails que chegaram na caixa de atendimento e o que o ISA fez com cada um. */
export function InboundEmailsPanel({ onOpenTicket }: { onOpenTicket?: (ticketId: string) => void }) {
  const [filters, setFilters] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const setFilter = (k: keyof typeof EMPTY, v: string) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }

  useEffect(() => {
    let alive = true
    setLoading(true)
    adminService.getInboundEmails({ ...filters, page, limit: pageSize })
      .then(d => { if (alive) { setItems(d.items); setTotal(d.total); setError('') } })
      .catch(() => alive && setError('Não foi possível carregar os e-mails recebidos.'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [filters, page, pageSize])

  return (
    <div style={{ padding: '0 var(--page-gutter) 40px' }}>
      <div className="adm-filters">
        <label className="grow">Busca
          <input type="search" placeholder="Remetente, assunto, nº do chamado..." maxLength={100} value={filters.search} onChange={e => setFilter('search', e.target.value)} />
        </label>
        <div className="field">Desfecho
          <FilterSelect value={filters.status} onChange={v => setFilter('status', v)}>
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </FilterSelect>
        </div>
        <label>De<input type="date" value={filters.startDate} onChange={e => setFilter('startDate', e.target.value)} /></label>
        <label>Até<input type="date" value={filters.endDate} onChange={e => setFilter('endDate', e.target.value)} /></label>
        <div style={{ marginLeft: 'auto' }}>
          <Pagination variant="toolbar" page={page} pageSize={pageSize} total={total} onPageChange={setPage}
            onPageSizeChange={n => { setPageSize(n); setPage(1) }} label="e-mails" />
        </div>
      </div>

      {error ? <p role="alert" className="adm-error">{error}</p>
        : loading && items.length === 0 ? <Loading label="Carregando e-mails recebidos…" />
        : (
          <div className="adm-scroll">
            <table className="table" aria-label="E-mails recebidos" style={{ minWidth: 960 }}>
              <thead><tr>{['Recebido em', 'Remetente / assunto', 'Chamado', 'Desfecho', 'Detalhe'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>Nenhum e-mail recebido. Nada chegou na caixa de atendimento para os filtros selecionados (ou a leitura da caixa ainda está desligada).</td></tr>}
                {items.map(m => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(m.received_at)}</td>
                    <td style={{ maxWidth: 300 }}>
                      <span className="adm-clip" title={m.from_email}>{m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</span>
                      <span className="adm-clip adm-sub" title={m.subject}>{m.subject || '(sem assunto)'}</span>
                    </td>
                    <td style={{ maxWidth: 240 }}>
                      {m.ticket ? (
                        <button type="button" className="adm-link" onClick={() => onOpenTicket?.(m.ticket.id)} aria-label={`Abrir chamado ${m.ticket.display_number}`} title={m.ticket.title}>
                          <span>{m.ticket.display_number}</span><span>{m.ticket.title}</span>
                        </button>
                      ) : <span style={{ color: 'var(--text-3)' }}>— sem chamado</span>}
                    </td>
                    <td>
                      <span style={m.status === 'failed' ? { color: 'var(--danger)' } : m.status === 'ignored' ? { color: 'var(--text-3)' } : undefined}>{STATUS[m.status] ?? m.status}</span>
                      {m.attempts > 1 && <div className="adm-sub">{m.attempts} tentativas</div>}
                    </td>
                    <td style={{ maxWidth: 220 }}><span className="adm-clip" style={{ color: 'var(--text-3)' }} title={m.detail ?? undefined}>{m.detail ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
