import { apiErrorMessage } from '@/services/api'
import { useState, useEffect, useRef } from 'react'
import { Ticket, TicketMessage } from '@/types'
import { SkadiAvatar, StatusBadge, AiResolvedBadge, isAiResolved, Btn, Txta, EmptyState, Modal, Field, Loading } from '@/components/ui'
import { ArrowLeft, Eye, Download, X, Edit2, Trash2 } from 'lucide-react'
import { ticketService } from '@/services/ticketService'
import { events } from '@/utils/events'
import { toast } from '@/store/toastStore'
import { sysAlert } from '@/store/alertStore'
import { getSocket, joinTicketRoom, leaveTicketRoom } from '@/services/socketService'
import { linkify } from '@/utils/linkify'
import { downloadAttachment, openAttachment, getFileTypeInfo, filterValidAttachments, ATTACHMENT_ACCEPT, fileDropPasteHandlers, PASTE_HINT } from '@/utils/attachments'
import { getApiErrorMessage } from '@/utils/apiError'
import { AttachmentLightbox } from '@/components/AttachmentLightbox'
import { AttachmentChipList } from '@/components/ImageAttachmentChip'
import { groupAttachmentMessages, type MessageAttachment } from '@/utils/groupAttachmentMessages'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { GuidanceActions } from '@/components/GuidanceActions'
import { isSkadiMessage, withoutSkadiSignature } from '@/components/AiNote'
import { SKADI_NAME } from '@/utils/skadi'
import { formatDateTime } from '@/utils/dateTime'
import { clientForecast } from '@/areas/inicio/clock'
import { RequestSteps } from '@/areas/inicio/RequestSteps'
import { Entry, EntryAttachment } from '@/areas/chamados/detail/Entry'
import { FileDrop } from '@/areas/chamados/detail/FileDrop'
import '@/areas/chamados/chamados.css'


/** "Previsão: amanhã até 9h." ao lado do rótulo vira "Amanhã até 9h". */
const forecastValue = (text: string) => { const v = text.replace(/^(Nova previsão|Previsão): /, '').replace(/\.$/, ''); return v.charAt(0).toUpperCase() + v.slice(1) }

export function UserTicketDetail({ ticket: initialTicket, currentUserId, categories, onBack, unreadCount = 0, onChatRead }: {
  ticket: Ticket
  currentUserId: string
  categories: any[]
  onBack: () => void
  unreadCount?: number
  onChatRead?: () => void
}) {
  const isMobile = useMediaQuery('(max-width: 900px)')
  const [ticket, setTicket] = useState<Ticket>(initialTicket)
  const [messages, setMessages] = useState<TicketMessage[]>(initialTicket.messages || [])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [tab, setTab] = useState<'chat' | 'documents' | 'realtime'>('chat')
  const [realtimeCompose, setRealtimeCompose] = useState('')
  const [realtimeSending, setRealtimeSending] = useState(false)
  const [chatBanner, setChatBanner] = useState<null | 'on' | 'off'>(null)
  const [realtimeUnread, setRealtimeUnread] = useState(0)
  const [reopenModal, setReopenModal] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)
  const [replyModal, setReplyModal] = useState(false)
  const [compose, setCompose] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [editingMessage, setEditingMessage] = useState<TicketMessage | null>(null)
  const [editText, setEditText] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const hasConnectedRef = useRef(false)
  const chatEnabledRef = useRef(!!initialTicket.chatEnabled)
  const tabRef = useRef(tab)

  async function handleReopen() {
    if (reopenReason.trim().length < 10 || reopening) return
    setReopening(true)
    try {
      await ticketService.reopenTicket(ticket.id, reopenReason)
      ticketService.getMessages(ticket.id).then(setMessages).catch(() => { })
      setReopenModal(false)
      setReopenReason('')
      toast.success('Chamado reaberto.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível reabrir o chamado.'))
    } finally {
      setReopening(false)
    }
  }

  const [confirming, setConfirming] = useState(false)
  async function handleConfirm() {
    setConfirming(true)
    try {
      const updated = await ticketService.confirmResolution(ticket.id)
      setTicket(prev => ({ ...prev, ...updated }))
      toast.success('Obrigado por confirmar. Chamado encerrado.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível confirmar agora.'))
    } finally {
      setConfirming(false)
    }
  }

  const cat = categories.find((c: any) => c.id === ticket.categoryId)

  const visible = messages.filter(m =>
    tab === 'documents' ? m.attachmentUrl
      : tab === 'realtime' ? (m.type !== 'internal' && m.isRealtime)
      : (m.type !== 'internal' && !m.isRealtime)
  )
  // Aba Documentos: anexo inicial + anexos do chamado (ex.: vindos do e-mail via API) + anexos das mensagens.
  const documents = [
    ...(ticket.attachmentUrl ? [{ key: 'initial', url: ticket.attachmentUrl, name: `anexo-inicial-${ticket.id}`, label: 'Inicial' }] : []),
    ...(ticket.attachments ?? []).map(a => ({ key: a.id, url: a.url, name: a.name, label: a.name })),
    ...visible.filter(m => m.attachmentUrl).map(m => ({ key: m.id, url: m.attachmentUrl!, name: `anexo-${m.id}`, label: new Date(m.createdAt).toLocaleDateString('pt-BR') })),
  ]
  // Solução aplicada entra na conversa como mensagem do atendimento, na data da resolução
  // (vale para qualquer caminho de resolução: analista, autoatendimento, API, automação).
  const RESOLUTION_ID = 'resolution'
  // Vários arquivos num envio viram uma mensagem por arquivo ("Anexo adicional"): agrupa de volta.
  const grouped: TicketMessage[] = groupAttachmentMessages(visible).messages
  const extrasOf = (m: TicketMessage): MessageAttachment[] => (m as TicketMessage & { extraAttachments?: MessageAttachment[] }).extraAttachments ?? []
  const conversation = tab === 'chat' && ['resolved', 'closed'].includes(ticket.status) && ticket.resolution_details
    ? [...grouped, { id: RESOLUTION_ID, ticketId: ticket.id, userId: '', type: 'agent', text: ticket.resolution_details, createdAt: ticket.resolved_at ?? new Date().toISOString() } as TicketMessage]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : grouped
  const realtimeMessages = messages.filter(m => m.type !== 'internal' && m.isRealtime)
  // Solicitação original: o que motivou o chamado, sempre o 1º item da trilha.
  const openingFields = ticket.special_data ? Object.entries(ticket.special_data).filter(([, v]) => v !== '' && v != null) : []
  const hasOpening = !!(ticket.description?.trim() || openingFields.length)
  const openedByMe = ticket.userId === currentUserId
  const requesterName = openedByMe ? 'Você' : ticket.user?.name ?? 'Solicitante'
  const openingMeta = `Aberto por ${openedByMe ? 'você' : requesterName} em ${formatDateTime(ticket.createdAt)}${ticket.channel === 'email' ? ' · por e-mail' : ''}`
  const openingContent = openingFields.length > 0
    ? openingFields.map(([key, value]) => (
        <div key={key} className="td-field"><small>{key.replace(/_/g, ' ')}</small>{Array.isArray(value) ? value.join(', ') : value}</div>
      ))
    : linkify(ticket.description ?? '')
  const showRealtimeTab = !!ticket.chatEnabled || realtimeMessages.length > 0

  useEffect(() => {
    ticketService.getMessages(ticket.id)
      .then(msgs => { setMessages(msgs); setMessagesLoaded(true) })
      .catch(() => { setMessages(ticket.messages || []); setMessagesLoaded(true) })
    onChatRead?.()
    // A listagem não traz ticket_attachments (ex.: anexos do e-mail via API) nem o
    // vínculo com projeto (previsão = prazo da task).
    ticketService.getTicket(ticket.id)
      .then(full => setTicket(prev => ({ ...prev, attachments: full.attachments, project_task: full.project_task, pendingReason: full.pendingReason })))
      .catch(() => {})
  }, [ticket.id])

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleMessage = (msg: any) => {
      if (msg.type === 'internal') return
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      // Badge de não lidas no Chat ao vivo: conta mensagens realtime de outros
      // recebidas enquanto o usuário não está com a aba aberta
      if (msg.isRealtime && msg.userId !== currentUserId && tabRef.current !== 'realtime') {
        setRealtimeUnread(c => c + 1)
      }
    }

    const handleMessageUpdate = (msg: any) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
    }

    const handleMessageDelete = (data: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId))
    }

    const handleTicketUpdate = (updated: any) => {
      if (!updated || updated.id !== ticket.id) return
      const now = !!updated.chatEnabled
      if (chatEnabledRef.current !== now) {
        chatEnabledRef.current = now
        setChatBanner(now ? 'on' : 'off')
        if (now) setTab('realtime')
      }
      setTicket(prev => ({ ...prev, ...updated }))
    }

    socket.on('ticket:message', handleMessage)
    socket.on('ticket:message:updated', handleMessageUpdate)
    socket.on('ticket:message:deleted', handleMessageDelete)
    socket.on('ticket:updated', handleTicketUpdate)

    const doJoin = () => {
      joinTicketRoom(ticket.id)
      if (hasConnectedRef.current) {
        // reconexão — busca mensagens perdidas durante a janela de desconexão
        ticketService.getMessages(ticket.id)
          .then(msgs => setMessages(msgs))
          .catch(() => { })
      }
      hasConnectedRef.current = true
    }
    if (socket.connected) {
      doJoin()
    }
    socket.on('connect', doJoin)

    return () => {
      socket.off('ticket:message', handleMessage)
      socket.off('ticket:message:updated', handleMessageUpdate)
      socket.off('ticket:message:deleted', handleMessageDelete)
      socket.off('ticket:updated', handleTicketUpdate)
      socket.off('connect', doJoin)
      leaveTicketRoom(ticket.id)
      hasConnectedRef.current = false
    }
  }, [ticket.id])

  useEffect(() => {
    return events.onTicketUpdate((data) => {
      const { ticketId, ...updates } = data
      if (ticketId === ticket.id) {
        setTicket(prev => ({ ...prev, ...updates }))
      }
    })
  }, [ticket.id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  // Mantém o ref de chat sincronizado com atualizações vindas por outros canais
  useEffect(() => { chatEnabledRef.current = !!ticket.chatEnabled }, [ticket.chatEnabled])

  // Banner transitório (auto-dismiss)
  useEffect(() => {
    if (!chatBanner) return
    const t = setTimeout(() => setChatBanner(null), 7000)
    return () => clearTimeout(t)
  }, [chatBanner])

  // Mantém ref da aba atual e zera o contador de não lidas ao abrir o Chat ao vivo
  useEffect(() => {
    tabRef.current = tab
    if (tab === 'realtime') setRealtimeUnread(0)
  }, [tab])

  async function send() {
    if ((!compose.trim() && selectedFiles.length === 0) || sending) return
    setSendError(false)
    setSending(true)
    try {
      let firstAttachmentUrl: string | undefined = undefined
      if (selectedFiles.length > 0) {
        firstAttachmentUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(selectedFiles[0])
        })
      }

      const newMsg = await ticketService.addMessage(ticket.id, compose, 'user', firstAttachmentUrl)
      setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])

      // Envia arquivos adicionais como mensagens consecutivas de anexo
      if (selectedFiles.length > 1) {
        for (let i = 1; i < selectedFiles.length; i++) {
          const file = selectedFiles[i]
          const extraAttachmentUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const extraMsg = await ticketService.addMessage(ticket.id, `Anexo adicional: ${file.name}`, 'user', extraAttachmentUrl)
          setMessages(prev => prev.some(m => m.id === extraMsg.id) ? prev : [...prev, extraMsg])
        }
      }

      setCompose('')
      setSelectedFiles([])
      setReplyModal(false)
    } catch (err) {
      setSendError(true)
      toast.error(getApiErrorMessage(err, 'Erro ao enviar a mensagem. Tente novamente.'))
    } finally {
      setSending(false)
    }
  }

  async function sendRealtime() {
    if (!realtimeCompose.trim() || realtimeSending || !ticket.chatEnabled) return
    setRealtimeSending(true)
    try {
      const newMsg = await ticketService.addMessage(ticket.id, realtimeCompose, 'user', undefined, undefined, true)
      setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
      setRealtimeCompose('')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Mensagem não enviada. Tente novamente.'))
    } finally {
      setRealtimeSending(false)
    }
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return
    const valid = filterValidAttachments(files, msg => toast.error(msg))
    if (valid.length > 0) setSelectedFiles(prev => [...prev, ...valid])
  }

  async function handleEditMessage() {
    if (!editingMessage || !editText.trim()) return
    try {
      const updated = await ticketService.updateMessage(ticket.id, editingMessage.id, editText)
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
      setEditingMessage(null)
      setEditText('')
      toast.success('Mensagem editada com sucesso!')
    } catch (err) {
      toast.error('Erro ao editar a mensagem.')
    }
  }

  async function handleDeleteMessage(msgId: string) {
    if (!(await sysAlert.confirm('Excluir mensagem', 'Tem certeza que deseja excluir esta mensagem?', 'danger', 'Excluir', 'Cancelar'))) return
    try {
      await ticketService.deleteMessage(ticket.id, msgId)
      setMessages(prev => prev.filter(m => m.id !== msgId))
      toast.success('Mensagem excluída com sucesso!')
    } catch (err) {
      toast.error('Erro ao excluir a mensagem.')
    }
  }



  // Chamado vinculado a uma task de projeto: fora do SLA, vale o prazo da task.
  const inProject = ticket.status === 'pending' && ticket.pendingReason === 'pending_project' && !!ticket.project_task

  const isFinished = ['resolved', 'closed'].includes(ticket.status)
  const canReopen = ticket.status === 'resolved' && ticket.canReopen
  const reopenExpired = isFinished && !ticket.canReopen && !ticket.is_reopened
  const pendingSurvey = ticket.status === 'resolved' && ticket.surveyInstance?.status === 'enviada'
  const subcategory = ticket.subcategoryId && (cat?.subcategories.find((s: any) => s.id === ticket.subcategoryId)?.name || ticket.subcategoryId)
  const closeReply = () => { setReplyModal(false); setCompose(''); setSelectedFiles([]); setSendError(false) }

  const pair = (label: string, value: React.ReactNode) => (
    <div className="td-pair"><span>{label}</span><div>{value}</div></div>
  )
  const facts = (
    <>
      <div className="td-pairs">
        {!isAiResolved(ticket) && pair(isFinished ? 'Resolvido em' : 'Previsão', inProject && ticket.project_task?.due_date
          ? <>{new Date(ticket.project_task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}<small>Prazo do projeto que está tratando este chamado.</small></>
          : isFinished
            ? formatDateTime(ticket.resolved_at)
            : forecastValue(clientForecast(ticket).text))}
        {pair('Categoria', <>{cat?.name ?? '—'}{cat && subcategory && <small>{subcategory}</small>}</>)}
        {pair('Aberto em', new Date(ticket.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}
      </div>
      <section className="td-sec" aria-label="Solicitação original">
        <h2>Solicitação original</h2>
        <small>{openingMeta}</small>
        {openingFields.length > 0
          ? <div style={{ marginTop: 10 }}>{openingContent}</div>
          : <p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{ticket.description?.trim() ? openingContent : 'Sem descrição.'}</p>}
      </section>
      {ticket.resolution_details && (
        <div className="td-sec"><h2>Solução aplicada</h2><p>{ticket.resolution_details}</p></div>
      )}
      {reopenExpired && (
        <div className="td-sec">O prazo para reabertura deste chamado foi encerrado. Caso o problema persista ou algo similar volte a ocorrer, por favor <strong>abra uma nova solicitação</strong>.</div>
      )}
    </>
  )

  const documentsTab = (
    <table className="table">
      <thead><tr><th>Arquivo</th><th>Tipo</th><th /></tr></thead>
      <tbody>
        {documents.map(doc => {
          const info = getFileTypeInfo(doc.url)
          const open = () => info.isImage ? setLightbox({ url: doc.url, name: doc.name }) : openAttachment(doc.url)
          return (
            <tr key={doc.key} title={doc.name}>
              <td style={{ overflowWrap: 'anywhere' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {info.isImage && <img src={doc.url} alt={doc.name} onClick={open} style={{ width: 56, height: 40, objectFit: 'cover', cursor: 'zoom-in' }} />}
                  {doc.label}
                </span>
              </td>
              <td>{info.friendlyName}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button type="button" className="icon-act" onClick={open} title="Ver" aria-label={`Ver ${doc.label}`}><Eye size={15} /></button>
                <button type="button" className="icon-act" onClick={() => downloadAttachment(doc.url, doc.name)} title="Baixar" aria-label={`Baixar ${doc.label}`}><Download size={15} /></button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const conversationTab = (
    <>
      {tab === 'chat' && hasOpening && (
        <Entry testId="opening-request" who={requesterName} date={ticket.createdAt} tags={<span>Abertura do chamado</span>}>{openingContent}</Entry>
      )}
      {conversation.map(msg => {
        if (msg.id === RESOLUTION_ID) return (
          <Entry key={msg.id} who="Solução aplicada" avatar={isAiResolved(ticket) && <SkadiAvatar size={20} decorative />} date={ticket.resolved_at}>{linkify(msg.text)}</Entry>
        )
        const isMe = msg.userId === currentUserId
        const fromSkadi = isSkadiMessage(msg)
        const name = isMe ? 'Você' : 'Equipe de suporte'
        return (
          <Entry key={msg.id} who={fromSkadi ? SKADI_NAME : msg.user?.name ?? name} avatar={fromSkadi && <SkadiAvatar size={20} decorative />} date={msg.createdAt}
            actions={isMe && !isFinished && <>
              <button type="button" className="icon-act" onClick={() => { setEditingMessage(msg); setEditText(msg.text || '') }} title="Editar" aria-label="Editar"><Edit2 size={13} /></button>
              <button type="button" className="icon-act danger" onClick={() => handleDeleteMessage(msg.id)} title="Excluir" aria-label="Excluir"><Trash2 size={13} /></button>
            </>}>
            {msg.text && <div>{linkify(fromSkadi ? withoutSkadiSignature(msg.text) : msg.text)}</div>}
            {msg.attachmentUrl && <EntryAttachment url={msg.attachmentUrl} downloadName={`anexo-${msg.id}`} onView={setLightbox} />}
            <AttachmentChipList items={extrasOf(msg)} onOpenImage={a => setLightbox({ url: a.url, name: a.name })} onDownload={a => downloadAttachment(a.url, a.name)} />
          </Entry>
        )
      })}
    </>
  )

  const replyEditor = isFinished ? (
    <p className="notice">Este chamado está finalizado. Caso o problema persista, use "Ainda não" acima.</p>
  ) : replyModal ? (
    <section className="td-reply" data-open aria-label="Responder ao chamado">
      {sendError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--danger)' }}>Ocorreu um erro ao enviar a resposta. Tente novamente.</div>}
      <Txta autoFocus aria-label="Mensagem" value={compose} onChange={e => setCompose(e.target.value)} placeholder="Digite sua resposta ou atualização sobre o chamado..." rows={5} maxLength={5000} showCount {...fileDropPasteHandlers(addFiles)} />
      <FileDrop hint={`PDF, Imagens, Documentos (Limite 10MB) · ${PASTE_HINT}`} accept={ATTACHMENT_ACCEPT} files={selectedFiles} onFiles={addFiles} onRemove={i => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))} />
      <div className="td-reply-foot">
        <Btn variant="ghost" onClick={closeReply}>Cancelar</Btn>
        <Btn disabled={(!compose.trim() && selectedFiles.length === 0) || sending} onClick={send}>{sending ? 'Enviando...' : 'Enviar resposta'}</Btn>
      </div>
    </section>
  ) : (
    <div className="td-reply td-reply-bar">
      <button type="button" className="td-reply-field" aria-label="Responder" onClick={() => setReplyModal(true)}>Envie uma atualização ou informação adicional…</button>
    </div>
  )

  const realtimeEditor = ticket.chatEnabled ? (
    <div className="td-reply">
      <Txta
        value={realtimeCompose}
        onChange={e => setRealtimeCompose(e.target.value)}
        rows={2}
        placeholder="Converse com o agente em tempo real..."
        maxLength={2000}
        showCount
        style={{ resize: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRealtime() } }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-3)' }}>Enter para enviar · Shift+Enter para quebrar linha</span>
        <Btn size="sm" onClick={sendRealtime} disabled={!realtimeCompose.trim() || realtimeSending}>{realtimeSending ? '...' : 'Enviar'}</Btn>
      </div>
    </div>
  ) : (
    <p className="notice">O chat em tempo real foi encerrado pelo agente. O histórico permanece visível, mas não é possível enviar novas mensagens ao vivo. Use a aba "Trilha de atendimento" para atualizações.</p>
  )

  const openTab = (id: typeof tab) => { setTab(id); if (id !== 'documents') onChatRead?.() }
  const unreadOf = (id: typeof tab) => id === 'chat' ? unreadCount : id === 'realtime' ? realtimeUnread : 0
  const tabs: [id: typeof tab, label: string][] = [
    ['chat', 'Trilha de atendimento'],
    ...(showRealtimeTab ? [['realtime', 'Chat ao vivo'] as [typeof tab, string]] : []),
    ['documents', 'Documentos'],
  ]

  return (
    <div className="td" data-flow data-compact={isMobile || undefined}>
      <header className="td-head">
        <div className="td-head-top">
          <button type="button" className="td-back" onClick={onBack}><ArrowLeft size={15} />Voltar</button>
          <span>{ticket.displayNumber}</span>
        </div>
        <h1>{ticket.title}</h1>
        <RequestSteps status={ticket.status} />
        {canReopen && (
          <div className="req-confirm">
            <b>Resolveu o seu problema?</b>
            <Btn size="sm" disabled={confirming} onClick={handleConfirm}>Resolveu</Btn>
            <Btn size="sm" variant="secondary" onClick={() => setReopenModal(true)}>Ainda não</Btn>
          </div>
        )}
        <div className="td-line">
          <StatusBadge status={ticket.is_reopened ? 'reopened' : ticket.status} />
          {/* Chamado vinculado a uma task de projeto: o cliente vê só a previsão (projeto/task são internos). */}
          {inProject && <span>Em projeto{ticket.project_task?.due_date ? ` · previsão ${new Date(ticket.project_task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}</span>}
          {isAiResolved(ticket)
            ? <AiResolvedBadge />
            : !isFinished && <span>{clientForecast(ticket).text}</span>}
          {reopenExpired && <span>Prazo de reabertura encerrado</span>}
        </div>
      </header>

      <div className="td-body">
        {isMobile
          ? <details className="td-fold"><summary>Dados do chamado</summary>{facts}</details>
          : <aside className="td-facts">{facts}</aside>}
        <div className="td-main">
          {chatBanner && (
            <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }}>{chatBanner === 'on'
                ? 'O agente habilitou o chat em tempo real. Abra a aba "Chat ao vivo" para conversar agora.'
                : 'O chat em tempo real foi encerrado pelo agente. O histórico continua disponível na aba "Chat ao vivo".'}</span>
              <button type="button" className="icon-act" aria-label="Fechar aviso" onClick={() => setChatBanner(null)}><X size={14} /></button>
            </div>
          )}
          {pendingSurvey && (
            <div className="notice" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: '1 1 240px' }}><strong>Pesquisa de satisfação disponível.</strong> Avalie o atendimento deste chamado: sua resposta ajuda a melhorar nossos serviços.</span>
              <Btn size="sm" onClick={() => window.open(`/survey/${ticket.surveyInstance?.linkToken}`, '_blank')}>Responder pesquisa</Btn>
            </div>
          )}
          <GuidanceActions ticketId={ticket.id} refreshKey={messages.length}
            onAnswered={() => ticketService.getTicket(ticket.id).then(full => setTicket(prev => ({ ...prev, ...full }))).catch(() => { })} />
          <div className="td-tabs">
            <div className="subtabs" style={{ flexWrap: 'nowrap' }}>
              {tabs.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={tab === id} onClick={() => openTab(id)}>
                  {label}{tab !== id && unreadOf(id) > 0 && <span className="chat-tab-unread">{unreadOf(id) > 9 ? '9+' : unreadOf(id)}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="td-scroll">
            {!messagesLoaded
              ? <Loading size="compact" label="Carregando mensagens…" />
              : (tab === 'documents' ? documents.length === 0 : conversation.length === 0 && !(tab === 'chat' && hasOpening))
                ? <EmptyState title="Sem registros" desc={tab === 'documents' ? 'Nenhum documento foi enviado ainda.' : tab === 'realtime' ? 'Nenhuma mensagem no chat ao vivo ainda.' : 'Envie uma mensagem para iniciar a conversa.'} />
                : tab === 'documents' ? documentsTab : conversationTab}
            <div ref={chatEndRef} />
          </div>
          {tab === 'chat' ? replyEditor : tab === 'realtime' && realtimeEditor}
        </div>
      </div>

      <Modal isOpen={reopenModal} onClose={() => { setReopenModal(false); setReopenReason('') }} title="Reabrir chamado"
        footer={<><Btn variant="ghost" onClick={() => { setReopenModal(false); setReopenReason('') }}>Cancelar</Btn><Btn disabled={reopenReason.trim().length < 10 || reopening} onClick={handleReopen}>{reopening ? '...' : 'Confirmar reabertura'}</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
            Ao reabrir, o chamado voltará para a fila de atendimento. Descreva por que o problema não foi completamente resolvido.
          </div>
          <Field label="Motivo da reabertura (obrigatório)">
            <Txta value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="Ex: O problema voltou após reiniciar o equipamento..." rows={4} maxLength={1000} showCount />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {reopenReason.trim().length} / mín. 10 caracteres
              </span>
            </div>
          </Field>
        </div>
      </Modal>

      <Modal 
        isOpen={!!editingMessage} 
        onClose={() => { setEditingMessage(null); setEditText('') }} 
        title="Editar mensagem"
        footer={
          <>
            <Btn variant="ghost" onClick={() => { setEditingMessage(null); setEditText('') }}>
              Cancelar
            </Btn>
            <Btn disabled={!editText.trim()} onClick={handleEditMessage}>
              Salvar alterações
            </Btn>
          </>
        }
      >
        <Field label="Mensagem">
          <Txta 
            value={editText} 
            onChange={e => setEditText(e.target.value)} 
            rows={4} 
            
            maxLength={2000}
            showCount
          />
        </Field>
      </Modal>

      <AttachmentLightbox
        url={lightbox?.url ?? null}
        filename={lightbox?.name}
        onClose={() => setLightbox(null)}
      />
    </div>
  )
}
