import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import { Btn, Field, Inp, Sel, Toggle, PageHeader, AlertModal, Modal, StatusBadge, SortHeader, TruncatedText, Pagination, Loading } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { useTicketPage, serverSort } from '@/hooks/useTicketPage'
import { useQueueName } from '@/hooks/useQueueName'
import './configuracoes.css'

function toDatetimeLocal(dateStr: string) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const tzOffset = date.getTimezoneOffset() * 60000
  const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)
  return localISOTime
}

// Colunas ordenáveis no servidor (as demais ficam sem seta)
const REOPEN_COL_SORT: Record<string, 'id' | 'title' | 'status' | 'sla'> = {
  'Chamado': 'id', 'Título': 'title', 'Status atual': 'status', 'Prazo do SLA': 'sla',
}

export function ReopenSLAPanel() {
  const queueName = useQueueName()
  const [config, setConfig] = useState<any>(null)
  const colSort = useTableSort<string>()
  // Reabertos paginados no servidor
  const reopened = useTicketPage({ isReopened: true, ...serverSort(colSort.sort, REOPEN_COL_SORT, { sort: 'date', dir: 'desc' }) })
  const reopenedTickets = reopened.rows
  const [loadingConfig, setLoadingConfig] = useState(true)
  const loadingTickets = reopened.loading
  const [savingGlobal, setSavingGlobal] = useState(false)
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null)
  
  // Ticket Editing Modal State
  const [editingTicket, setEditingTicket] = useState<any>(null)
  const [savingTicket, setSavingTicket] = useState(false)
  const [ticketSlaDeadline, setTicketSlaDeadline] = useState('')
  const [ticketReopenEnabled, setTicketReopenEnabled] = useState(true)
  const [ticketReopenHours, setTicketReopenHours] = useState(24)

  const loadConfig = async () => {
    setLoadingConfig(true)
    try {
      const cfg = await adminService.getReopenSlaConfig()
      setConfig(cfg)
    } catch (err) {
      console.error('[ReopenSLAPanel] Erro ao carregar configurações:', err)
    } finally {
      setLoadingConfig(false)
    }
  }

  const loadTickets = () => reopened.reload()

  useEffect(() => {
    loadConfig()
  }, [])

  const saveGlobal = async () => {
    if (!config.reopen_limit_hours || config.reopen_limit_hours <= 0) {
      return setAlert({ title: 'Configuração inválida', message: 'O tempo limite deve ser maior que 0 horas.' })
    }
    setSavingGlobal(true)
    try {
      const updated = await adminService.updateReopenSlaConfig(config)
      setConfig(updated)
      setAlert({ title: 'Salvo', message: 'Configurações de SLA de reabertura atualizadas com sucesso.' })
    } catch (err) {
      console.error('[ReopenSLAPanel] Erro ao salvar configurações:', err)
      setAlert({ title: 'Erro', message: 'Não foi possível salvar as configurações globais.' })
    } finally {
      setSavingGlobal(false)
    }
  }

  const openEditTicketModal = (ticket: any) => {
    setEditingTicket(ticket)
    setTicketSlaDeadline(toDatetimeLocal(ticket.slaDeadline || ticket.sla_deadline))
    setTicketReopenEnabled(ticket.reopenSlaEnabled ?? ticket.reopen_sla_enabled ?? true)
    setTicketReopenHours(ticket.reopenSlaLimitHours ?? ticket.reopen_sla_limit_hours ?? 24)
  }

  const saveTicketSla = async () => {
    if (!editingTicket) return
    if (!ticketSlaDeadline) {
      return setAlert({ title: 'Campo obrigatório', message: 'O prazo de SLA não pode estar vazio.' })
    }
    if (ticketReopenHours <= 0) {
      return setAlert({ title: 'Valor inválido', message: 'O limite de reabertura em horas deve ser maior que 0.' })
    }

    setSavingTicket(true)
    try {
      await ticketService.updateTicket(editingTicket.id, {
        sla_deadline: new Date(ticketSlaDeadline).toISOString(),
        reopen_sla_enabled: ticketReopenEnabled,
        reopen_sla_limit_hours: ticketReopenHours
      } as any)
      setAlert({ title: 'Sucesso', message: `Chamado ${editingTicket.displayNumber} atualizado com sucesso.` })
      setEditingTicket(null)
      loadTickets()
    } catch (err: any) {
      console.error('[ReopenSLAPanel] Erro ao salvar SLA do chamado:', err)
      const errorMsg = err.response?.data?.error || 'Não foi possível salvar as alterações do chamado.'
      setAlert({ title: 'Erro', message: errorMsg })
    } finally {
      setSavingTicket(false)
    }
  }

  const isLoading = loadingConfig || !config

  if (isLoading) {
    return (
      <Loading />
    )
  }

  return (
    <div className="cfg-page">
      <PageHeader
        title="Reabertura"
        subtitle="Gerencie regras globais e prazos de chamados reabertos"
      />

      <div className="cfg-body">
        <div className="cfg-settings">
          <div className="setting">
            <div>Status da regra de reabertura<small>Se ativo, impede que clientes ou analistas reabram chamados já resolvidos após o vencimento do prazo configurado.</small></div>
            <div className="cfg-inline">
              <Toggle value={config.enabled} onChange={enabled => setConfig({ ...config, enabled })} label="Status da regra de reabertura" />
              <span style={{ fontSize: 14 }}>{config.enabled ? 'Ativo' : 'Desativado'}</span>
            </div>
          </div>
          <div className="setting">
            <div>Prazo limite para reabertura<small>Em horas corridas.</small></div>
            <div className="cfg-inline">
              <Inp
                type="number"
                min={1}
                max={8760}
                aria-label="Prazo limite para reabertura (em horas corridas)"
                value={config.reopen_limit_hours}
                onChange={e => setConfig({ ...config, reopen_limit_hours: parseInt(e.target.value) || 24 })}
                style={{ width: 120 }}
              />
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>horas</span>
            </div>
          </div>
          <div className="setting">
            <div>Prazo na reabertura</div>
            <Sel aria-label="Prazo na reabertura" value={config.reopen_deadline_rule ?? 'org_sla'} onChange={e => setConfig({ ...config, reopen_deadline_rule: e.target.value })}>
              <option value="org_sla">Prazo cheio da empresa (padrão)</option>
              <option value="fixed_hours">Prazo fixo (em horas)</option>
              <option value="keep_original">Manter o prazo anterior à resolução</option>
              <option value="extra_hours">Adicionar horas ao prazo anterior</option>
            </Sel>
          </div>
          {(config.reopen_deadline_rule === 'fixed_hours' || config.reopen_deadline_rule === 'extra_hours') && (
            <div className="setting">
              <div>{config.reopen_deadline_rule === 'fixed_hours' ? 'Prazo fixo' : 'Horas a adicionar'}</div>
              <div className="cfg-inline">
                <Inp
                  type="number"
                  min={1}
                  max={8760}
                  aria-label={config.reopen_deadline_rule === 'fixed_hours' ? 'Prazo fixo (horas)' : 'Horas a adicionar'}
                  value={config.reopen_deadline_hours ?? 8}
                  onChange={e => setConfig({ ...config, reopen_deadline_hours: parseInt(e.target.value) || 8 })}
                  style={{ width: 120 }}
                />
                <span style={{ fontSize: 14, color: 'var(--text-2)' }}>horas</span>
              </div>
            </div>
          )}
        </div>
        <div className="cfg-save">
          <div><Btn onClick={saveGlobal} disabled={savingGlobal}>{savingGlobal ? 'Salvando...' : 'Salvar regra'}</Btn></div>
        </div>

        <section className="cfg-section">
          <div className="cfg-section-head">
            <div>
              <h2>Chamados reabertos pendentes</h2>
              <p className="cfg-sub">Lista de chamados que foram reabertos e necessitam de reavaliação de SLA</p>
            </div>
            <div className="cfg-inline">
              <Pagination
                variant="toolbar"
                page={reopened.page}
                pageSize={reopened.pageSize}
                total={reopened.total}
                onPageChange={reopened.setPage}
                onPageSizeChange={reopened.setPageSize}
              />
              <Btn size="xs" variant="ghost" onClick={loadTickets} disabled={loadingTickets}>Atualizar lista</Btn>
            </div>
          </div>

          {reopened.loading && reopenedTickets.length === 0 ? (
            <Loading size="compact" label="Carregando chamados…" />
          ) : reopenedTickets.length === 0 ? (
            <div className="cfg-empty">Nenhum chamado reaberto no momento. Todos estão em conformidade com as regras normais.</div>
          ) : (
            <div className="cfg-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {['Chamado', 'Título', 'Solicitante / fila', 'Status atual', 'Prazo do SLA', 'Regra de reabertura', 'Ações'].map(h => (
                      <th key={h}>{REOPEN_COL_SORT[h] ? <SortHeader label={h} {...colSort.header(h)} /> : h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reopenedTickets.map((ticket: any) => {
                    const deadline = new Date(ticket.slaDeadline || ticket.sla_deadline)
                    const isOverdue = deadline < new Date()

                    const isCustomRule = (ticket.reopenSlaEnabled !== null && ticket.reopenSlaEnabled !== undefined) ||
                                         (ticket.reopenSlaLimitHours !== null && ticket.reopenSlaLimitHours !== undefined)
                    const ruleLabel = ticket.reopenSlaEnabled === false ? 'Desativado' :
                                      isCustomRule ? `Personalizado (${ticket.reopenSlaLimitHours}h)` : `Padrão (${config.reopen_limit_hours}h)`

                    return (
                      <tr key={ticket.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{ticket.displayNumber}</td>
                        <td className="cfg-strong" style={{ maxWidth: 220, overflow: 'hidden' }}>
                          <TruncatedText text={ticket.title} style={{ display: 'block' }} />
                        </td>
                        <td>
                          {ticket.user?.name || 'Cliente'}
                          <div className="cfg-sub" style={{ margin: 0 }}>Fila: {queueName(ticket.queue) || 'Sem fila'}</div>
                        </td>
                        <td><StatusBadge status={ticket.status} /></td>
                        <td style={{ whiteSpace: 'nowrap', color: isOverdue ? 'var(--danger)' : undefined }}>
                          {deadline.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          {isOverdue && <div style={{ fontSize: 13 }}>Vencido</div>}
                        </td>
                        <td style={{ color: 'var(--text-2)' }}>{ruleLabel}</td>
                        <td><button type="button" className="cfg-link" onClick={() => openEditTicketModal(ticket)}>Ajustar SLA</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Ticket SLA Editing Modal */}
      {editingTicket && (
        <Modal
          isOpen={true}
          onClose={() => setEditingTicket(null)}
          title={`Ajustar SLA e Regra de reabertura — Chamado ${editingTicket.displayNumber}`}
          width={520}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setEditingTicket(null)} disabled={savingTicket}>Cancelar</Btn>
              <Btn onClick={saveTicketSla} disabled={savingTicket}>{savingTicket ? 'Salvando...' : 'Salvar alterações'}</Btn>
            </>
          }
        >
          <div className="cfg-form">
            <div style={{ fontSize: 14, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{editingTicket.title}</div>

            <Field label="Novo prazo (data e hora)">
              <Inp
                type="datetime-local"
                value={ticketSlaDeadline}
                onChange={e => setTicketSlaDeadline(e.target.value)}
              />
            </Field>

            <div className="cfg-row">
              <span>Prazo individual<small>Permitir reaberturas personalizadas para este chamado</small></span>
              <Toggle value={ticketReopenEnabled} onChange={setTicketReopenEnabled} label="Prazo individual" />
            </div>

            {ticketReopenEnabled && (
              <Field label="Prazo limite individual para reabertura (em horas corridas)">
                <div className="cfg-inline">
                  <Inp
                    type="number"
                    min={1}
                    max={8760}
                    value={ticketReopenHours}
                    onChange={e => setTicketReopenHours(parseInt(e.target.value) || 24)}
                    style={{ width: 120 }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--text-2)' }}>horas</span>
                </div>
              </Field>
            )}
          </div>
        </Modal>
      )}

      {alert && (
        <AlertModal isOpen onClose={() => setAlert(null)} title={alert.title} message={alert.message} />
      )}
    </div>
  )
}
