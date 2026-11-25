import { apiErrorMessage } from '@/services/api'
import { AppHeader } from '@/components/AppHeader'
import { useTicketInUrl } from '@/access/useTicketInUrl'
import { toast } from '@/store/toastStore'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/store/auth'
import { TierBadge, Btn, Modal, Field, Txta, EmptyState, PageHeader, Pagination, Loading } from '@/components/ui'
import { TicketRow, TicketRowsHeader } from '@/areas/chamados/list/TicketRow'
import { toggleCsv } from '@/components/ui/SearchableSelect'
import { MessageNotificationPopup } from '@/components/ui/MessageNotificationPopup'
import { BellNotificationPopup } from '@/components/ui/BellNotificationPopup'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { ticketService } from '@/services/ticketService'
import { adminService } from '@/services/adminService'
import { surveyService } from '@/services/surveyService'
import { connectSocket } from '@/services/socketService'
import { useNotificationsStore } from '@/store/notifications'
import { notificationService } from '@/services/notificationService'
import { requestNotificationPermission, showBrowserNotification } from '@/utils/browserNotification'
import { playNotificationSound } from '@/components/ui/MessageNotificationPopup'
import { computeUnreadFromTickets, useUnreadCounts, getLastOpened } from '@/hooks/useUnreadCounts'
import { useTableSort } from '@/hooks/useTableSort'
import { useTicketPage, useTicketCounts, serverSort } from '@/hooks/useTicketPage'
import { events } from '@/utils/events'
import { Ticket } from '@/types'
import { NewTicketWizard } from './NewTicketWizard'
import { ClientHome } from '@/areas/inicio/ClientHome'
import { clientForecast } from '@/areas/inicio/clock'
import { UserTicketDetail } from './UserTicketDetail'
import { useLocation, useNavigate } from 'react-router-dom'
import { AssistantLauncher } from '@/components/assistant/AssistantPanel'
import { readDialogMode } from '@/teams/dialog'

/**
 * /solicitacoes/nova (link do bot do Teams) ou ?nova=1 abrem direto
 * no wizard. A equipe só chega ao portal por /solicitacoes, então para ela vale o ?nova=1.
 */
export function opensNewTicket(pathname: string, search: string): boolean {
  return pathname.replace(/\/+$/, '') === '/solicitacoes/nova' || new URLSearchParams(search).get('nova') === '1'
}

/**
 * Portal do solicitante. `embedded`: "Minhas solicitações" de analista/TM/gerente
 * dentro do layout deles — sem cabeçalho/sino/popups próprios (o layout já tem),
 * lista só os chamados em que o usuário é o solicitante.
 */
export default function UserPortalPage({ embedded = false, organizations }: { embedded?: boolean; organizations?: any[] } = {}) {
  const user = useAuthStore(s => s.user)!
  const accessToken = useAuthStore(s => s.accessToken)
  const { notifications, bellItems, bellPopups, addNotification, addBellItem, addBellPopup, dismissBellPopup, setBellItems, dismissNotification, markTicketRead, unreadByTicket, setUnreadBatch } = useNotificationsStore()
  const { markRead } = useUnreadCounts()

  const handleMarkTicketRead = useCallback((ticketId: string) => {
    markTicketRead(ticketId)
    markRead(ticketId)
    notificationService.markTicketRead(ticketId).catch(() => {})
  }, [markTicketRead, markRead])

  const handleMarkAllRead = useCallback(() => {
    setBellItems([])
    notificationService.markAllRead().catch(() => {})
  }, [setBellItems])
  const location = useLocation()
  const navigate = useNavigate()
  // Dialog do Teams (?dialog=1 aberto pelo bot): abre direto no wizard, sem o botão do assistente por cima.
  const [inDialog] = useState(() => readDialogMode() !== null)
  const [openedAsNew] = useState(() => inDialog || opensNewTicket(location.pathname, location.search))
  const [view, setView] = useState<'list' | 'new' | 'detail'>(openedAsNew ? 'new' : 'list')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [initial, setInitial] = useState<{ text?: string; category?: string } | undefined>(location.state?.ask)
  // Início em /solicitacoes; a lista completa em /solicitacoes/todas. Dentro da tela da equipe, só a lista.
  const atHome = !embedded && location.pathname.replace(/\/+$/, '') !== '/solicitacoes/todas'
  const [homeKey, setHomeKey] = useState(0)
  // O endereço manda: /solicitacoes/nova abre o formulário e sair dele volta à lista.
  useEffect(() => {
    if (embedded) return
    if (opensNewTicket(location.pathname, location.search)) { setInitial(location.state?.ask); setView('new') }
    else if (!inDialog) setView(v => (v === 'new' ? 'list' : v))
  }, [embedded, inDialog, location.pathname, location.state, location.search])
  const startNew = (ask?: { text?: string; category?: string }) => {
    if (embedded) { setInitial(ask); setView('new') } else navigate('/solicitacoes/nova', { state: { ask } })
  }
  const selectedRef = useRef<Ticket | null>(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const colSort = useTableSort<string>()
  // Lista paginada no servidor; sem coluna clicada: pendências primeiro, depois ativos
  const ticketPage = useTicketPage({
    status: filterStatus === 'all' ? undefined : filterStatus.replace('resolved', 'resolved,closed'),
    ...serverSort(colSort.sort, {
      'ID': 'id', 'Título / categoria': 'title', 'Status': 'status', 'Prioridade': 'priority', 'SLA': 'sla', 'Criado em': 'date',
    }, { sort: 'portal', dir: 'asc' }),
    ...(embedded && { requested: true }),
  })
  const { rows: tickets, setRows: setTickets } = ticketPage
  const { counts, refresh: refreshCounts, scheduleRefresh: scheduleCounts } = useTicketCounts(embedded ? { requested: true } : {})
  const reloadListRef = useRef(() => {})
  reloadListRef.current = () => { ticketPage.scheduleReload(); scheduleCounts(); setHomeKey(k => k + 1) }
  const [org, setOrg] = useState<any>(null)
  const [categories, setCategories] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingSurveys, setPendingSurveys] = useState<any[]>([])
  const [verifyingSurveys, setVerifyingSurveys] = useState(false)
  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)

  const isContractExpired = !embedded && org?.expires_at ? new Date(org.expires_at) < new Date() : false

  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => { loadData() }, [])

  // Não-lidos das linhas visíveis (latestMessage vem na página)
  useEffect(() => {
    setUnreadBatch(computeUnreadFromTickets(tickets, user.id))
  }, [tickets, user.id, setUnreadBatch])

  // Abre um chamado pelo id (sino/popups/deep link): linha da página ou busca no servidor
  const openTicket = async (ticketId: string) => {
    const t = tickets.find(t => t.id === ticketId) ?? (await ticketService.getTicket(ticketId).catch(() => null))
    if (t) { setSelected(t); setView('detail'); handleMarkTicketRead(ticketId) }
  }

  // Chamado aberto ↔ ?ticket= (link do e-mail /c/<id>, nova aba, voltar).
  useTicketInUrl(view === 'detail' ? selected?.id : null, (id) => { void openTicket(id) }, () => setView('list'))

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  useEffect(() => {
    const handleFocus = () => {
      if (pendingSurveys.length > 0) {
        setVerifyingSurveys(true)
        surveyService.getPendingSurveys()
          .then(setPendingSurveys)
          .catch(() => {})
          .finally(() => setVerifyingSurveys(false))
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [pendingSurveys.length])


  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)

    const onNewMessage = (data: {
      ticketId: string; ticketNumber: string; title: string; senderName: string; text: string; type: string
    }) => {
      if (selectedRef.current?.id === data.ticketId) return
      addNotification({ ticketId: data.ticketId, ticketNumber: data.ticketNumber, title: data.title, senderName: data.senderName, text: data.text })
      showBrowserNotification(`Nova mensagem — ${data.title}`, `${data.senderName}: ${data.text}`, data.ticketId)
    }

    const onNotification = (data: {
      id: string; ticketId: string; ticketNumber: string; type: any; title: string; body: string; senderName: string | null; createdAt: string
    }) => {
      addBellItem({ id: data.id, ticketId: data.ticketId, ticketNumber: data.ticketNumber, type: data.type, title: data.title, body: data.body, senderName: data.senderName, createdAt: data.createdAt })
      playNotificationSound()
      showBrowserNotification(data.title, data.body, data.ticketId)
      if (data.type === 'ticket_assigned') {
        addBellPopup({ id: data.id, ticketId: data.ticketId, ticketNumber: data.ticketNumber, type: data.type, title: data.title, body: data.body })
      }
    }

    const onCreated = () => reloadListRef.current()

    const onUpdated = (updatedTicket: Ticket) => {
      setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? { ...t, ...updatedTicket } : t)));
      reloadListRef.current();
      setSelected((current) => {
        if (current && current.id === updatedTicket.id) {
          return { ...current, ...updatedTicket };
        }
        return current;
      });
      if (!embedded && updatedTicket.status === 'resolved') {
        surveyService.getPendingSurveys()
          .then(setPendingSurveys)
          .catch(() => {})
      }
    }

    // Embutido: sino/popups de mensagem são do layout que hospeda
    if (!embedded) {
      socket.on('ticket:new_message', onNewMessage)
      socket.on('notification:new', onNotification)
    }
    socket.on('ticket:created', onCreated)
    socket.on('ticket:updated', onUpdated)

    return () => {
      socket.off('ticket:new_message', onNewMessage)
      socket.off('notification:new', onNotification)
      socket.off('ticket:created', onCreated)
      socket.off('ticket:updated', onUpdated)
    }
  }, [embedded, accessToken, user.id, setUnreadBatch, addNotification, addBellItem, addBellPopup])

  useEffect(() => {
    return events.onTicketUpdate((data) => {
      const { ticketId, ...updates } = data
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t))
      if (selected?.id === ticketId) {
        setSelected(prev => prev ? { ...prev, ...updates } : null)
      }
    })
  }, [selected?.id])

  async function handleReopen() {
    if (!reopenTargetId || reopenReason.trim().length < 10 || reopening) return
    setReopening(true)
    try {
      await ticketService.reopenTicket(reopenTargetId, reopenReason)
      setReopenTargetId(null)
      setReopenReason('')
      toast.success('Chamado reaberto.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível reabrir o chamado.'))
    } finally {
      setReopening(false)
    }
  }

  async function loadData() {
    try {
      const [activity, orgData, cats, pendingSvs] = await Promise.all([
        embedded ? [] : ticketService.getActivity().catch(() => []),
        // Dados da empresa (vencimento de contrato) são do cliente final. Funcionário só
        // lê empresas da própria carteira (scope.ts) — pedir aqui dava 403 e derrubava a tela.
        user.orgId && (user.role === 'user' || user.role === 'admin')
          ? adminService.getOrganization(user.orgId).catch(() => null)
          : Promise.resolve(null),
        adminService.getAvailableCategories().catch(() => [] as any[]),
        embedded ? [] : surveyService.getPendingSurveys().catch(() => [])
      ])
      setOrg(orgData)
      setCategories(cats)
      setPendingSurveys(pendingSvs)
      if (!embedded) {
        const merged = await notificationService.getUnreadMerged(activity, user.id, getLastOpened())
        setBellItems(merged)
      }

      setError(null)
    } catch {
      setError('Não foi possível carregar os dados. Verifique sua conexão.')
    }
  }

  const refreshAll = () => { loadData(); ticketPage.reload(); refreshCounts(); setHomeKey(k => k + 1) }

  const pendingCount = counts.status_pending ?? 0
  const byStatus = (...st: string[]) => st.reduce((n, k) => n + (counts[`status_${k}`] ?? 0), 0)
  const filterTabs = [
    { id: 'all', label: 'Todos', count: byStatus('open', 'in_progress', 'pending', 'resolved', 'closed') },
    { id: 'pending', label: 'Aguardando você', count: pendingCount },
    { id: 'open', label: 'Abertos', count: byStatus('open') },
    { id: 'in_progress', label: 'Em andamento', count: byStatus('in_progress') },
    { id: 'resolved', label: 'Resolvidos', count: byStatus('resolved', 'closed') },
  ]

  return (
    <div style={embedded
      ? { flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg-app)', fontFamily: 'var(--font)' }
      : undefined} className={embedded ? undefined : 'app-shell'}>
      {!embedded && <AppHeader responsive right={<>
        {org && <div className="hide-on-tablet" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12, color: 'var(--text-3)' }}>{org.name}</span><TierBadge tier={org.tier} /></div>}
        <NotificationBell
          bellItems={bellItems}
          onOpenTicket={(ticketId) => {
            void openTicket(ticketId)
          }}
          onMarkRead={(ticketId) => handleMarkTicketRead(ticketId)}
          onMarkAllRead={() => handleMarkAllRead()}
        />
      </>} />}


      <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', overflowY: embedded ? undefined : 'auto' }}>
        {error && <EmptyState title="Ops! Algo deu errado" desc={error} action={<Btn onClick={refreshAll}>Tentar novamente</Btn>} />}

        {!error && isContractExpired && (
          <div className="notice" style={{ margin: '16px var(--page-gutter) 0' }}>
            <strong style={{ color: 'var(--danger)' }}>Contrato de suporte expirado.</strong>{' '}
            {org?.expiry_message || 'A abertura de novos chamados está temporariamente suspensa para a sua empresa devido ao vencimento do plano de SLA/contrato de suporte.'}
          </div>
        )}

        {!error && view === 'list' && atHome && (
          <ClientHome reloadKey={homeKey} onConfirmed={() => { surveyService.getPendingSurveys().then(setPendingSurveys).catch(() => {}) }} user={user} categories={categories} disabled={isContractExpired}
            onAsk={startNew} counts={counts} onFilter={s => { setFilterStatus(s); navigate('/solicitacoes/todas') }}
            onOpen={t => { setSelected(t); setView('detail'); handleMarkTicketRead(t.id) }} />
        )}

        {!error && view === 'list' && !atHome && (
          <>
            <PageHeader
              title={embedded ? 'Minhas solicitações' : 'Meus chamados'}
              // O cliente já tem o botão no topo.
              actions={embedded && (
                <Btn
                  onClick={() => { if (!isContractExpired) startNew() }}
                  disabled={isContractExpired}
                  title={isContractExpired ? "Abertura de chamados suspensa temporariamente" : undefined}
                >
                  Nova solicitação
                </Btn>
              )}
            />
            <div className="filter-bar">
              <div className="subtabs" style={{ flexWrap: 'nowrap', overflowX: 'auto', maxWidth: '100%', flex: '1 1 auto' }}>
                {filterTabs.map(t => {
                  const active = filterStatus.split(',').includes(t.id)
                  return (
                    <button key={t.id} type="button" aria-pressed={active} onClick={() => setFilterStatus(cur => toggleCsv(cur, t.id, ['all'], 'all'))}>
                      {t.label}{t.count > 0 && <span style={{ marginLeft: 6, opacity: 0.8, fontWeight: 400 }}>{t.count}</span>}
                    </button>
                  )
                })}
              </div>
              <Pagination
                variant="toolbar"
                page={ticketPage.page}
                pageSize={ticketPage.pageSize}
                total={ticketPage.total}
                onPageChange={ticketPage.setPage}
                onPageSizeChange={ticketPage.setPageSize}
              />
            </div>
            {ticketPage.loading && !tickets.length
              ? <Loading label="Carregando chamados…" />
              : tickets.length === 0
                ? <EmptyState title="Nenhum chamado" desc="Use Nova solicitação para contar o que aconteceu." />
                : (
                  <div className="stack-list"><div className="ticket-list">
                    <TicketRowsHeader
                      className="portal-grid-header"
                      number={['ID', 'Número']}
                      subject={['Título / categoria', 'Assunto']}
                      status={['Status', 'Situação']}
                      owner={['Criado em', 'Criado em']}
                      due={['SLA', 'Previsão']}
                      header={colSort.header}
                    />
                    {tickets.map(t => {
                      const category = categories.find((c: any) => c.id === t.categoryId)
                      const subcategory = t.subcategoryId && (category?.subcategories.find((s: any) => s.id === t.subcategoryId)?.name || t.subcategoryId)
                      return (
                        <TicketRow
                          key={t.id}
                          className="portal-grid-row"
                          status={t.status}
                          number={t.displayNumber}
                          title={t.title}
                          type={t.type}
                          unread={unreadByTicket[t.id] ?? 0}
                          done={['resolved', 'closed'].includes(t.status)}
                          meta={[
                            t.status === 'pending' && t.pendingReason === 'pending_user' && <span className="strong">Aguarda você</span>,
                            category && <span>{category.name}{subcategory ? ` › ${subcategory}` : ''}</span>,
                          ]}
                          deadline={['resolved', 'closed'].includes(t.status) ? (t.resolved_at ? `Resolvido em ${new Date(t.resolved_at).toLocaleDateString('pt-BR')}` : 'Resolvido') : <span className="req-when">{clientForecast(t).text}</span>}
                          owner={t.status === 'resolved' && t.canReopen
                            ? <Btn size="xs" variant="ghost" style={{ padding: 0, minHeight: 20 }} onClick={e => { e.stopPropagation(); setReopenTargetId(t.id); setReopenReason('') }}>Reabrir</Btn>
                            : <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>}
                          onOpen={() => { setSelected(t); setView('detail'); handleMarkTicketRead(t.id) }}
                        />
                      )
                    })}
                  </div></div>
                )
            }
          </>
        )}

        {view === 'new' && isContractExpired && <EmptyState title="Abertura suspensa" desc="Novos chamados voltam quando o contrato da sua empresa for renovado." action={<Btn variant="secondary" onClick={() => navigate('/solicitacoes')}>Voltar ao início</Btn>} />}

        {view === 'new' && !isContractExpired && (
          <NewTicketWizard
            categories={categories}
            org={org}
            organizations={organizations}
            initial={initial}
            onBack={() => {
              setView('list')
              // Saindo do wizard aberto pelo endereço: volta para a lista (recarregar não reabre o wizard).
              if (!embedded && !inDialog) navigate('/solicitacoes', { replace: true })
            }}
            onRefresh={async () => { refreshAll() }}
          />
        )}

        {!error && view === 'detail' && selected && (
          <UserTicketDetail
            ticket={selected}
            currentUserId={user.id}
            categories={categories}
            onBack={() => setView('list')}
            unreadCount={unreadByTicket[selected.id] ?? 0}
            onChatRead={() => handleMarkTicketRead(selected.id)}
          />
        )}
      </div>

      {!embedded && <>
      {user.role === 'user' && !inDialog && <AssistantLauncher userId={user.id} onTicketChange={refreshAll} />}
      <MessageNotificationPopup
        notifications={notifications}
        onDismiss={dismissNotification}
        onOpen={(ticketId) => {
          const t = tickets.find(t => t.id === ticketId)
          if (t) { setSelected(t); setView('detail'); handleMarkTicketRead(ticketId) }
        }}
      />
      <BellNotificationPopup
        items={bellPopups}
        onDismiss={dismissBellPopup}
        onOpen={(ticketId) => {
          const t = tickets.find(t => t.id === ticketId)
          if (t) { setSelected(t); setView('detail'); handleMarkTicketRead(ticketId) }
        }}
      />
      </>}

      <Modal isOpen={!!reopenTargetId} onClose={() => { setReopenTargetId(null); setReopenReason('') }} title="Reabrir chamado"
        footer={<><Btn variant="ghost" onClick={() => { setReopenTargetId(null); setReopenReason('') }}>Cancelar</Btn><Btn disabled={reopenReason.trim().length < 10 || reopening} onClick={handleReopen}>{reopening ? '...' : 'Confirmar reabertura'}</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
            Ao reabrir, o chamado voltará para a fila de atendimento. Descreva por que o problema não foi completamente resolvido.
          </div>
          <Field label="Motivo da reabertura (obrigatório)">
            <Txta value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="Ex: O problema voltou após reiniciar o equipamento..." rows={4} maxLength={1000} showCount />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                {reopenReason.trim().length} / mín. 10 caracteres
              </span>
            </div>
          </Field>
        </div>
      </Modal>

      <Modal 
        isOpen={pendingSurveys.length > 0} 
        onClose={() => {}} 
        title="Como foi o atendimento?"
        hideCloseButton={true}
        preventBackdropClose={true}
        width={460}
        footer={
          <Btn 
            disabled={verifyingSurveys} 
            onClick={() => {
              setVerifyingSurveys(true)
              surveyService.getPendingSurveys()
                .then(setPendingSurveys)
                .catch(() => {})
                .finally(() => setVerifyingSurveys(false))
            }}
          >
            {verifyingSurveys ? 'Verificando…' : 'Já respondi'}
          </Btn>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            Antes de continuar, conte como foi. Leva menos de um minuto e abre em outra aba.
          </p>
          <div>
            {pendingSurveys.map(sv => (
              <div key={sv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Chamado {sv.ticket.id}</div>
                  <div style={{ fontSize: 14, color: 'var(--text-1)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{sv.ticket.title}</div>
                </div>
                <Btn 
                  size="sm" 
                  onClick={() => window.open(`/survey/${sv.link_token}`, '_blank')}
                  style={{ flexShrink: 0 }}
                >
                  Responder
                </Btn>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}
