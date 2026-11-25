import { useState, useEffect, useRef, useMemo } from 'react'
import { useTicketMessages } from './detail/useTicketMessages'
import { ChoiceModal } from './detail/ChoiceModal'
import { Entry, EntryAttachment } from './detail/Entry'
import { FileDrop } from './detail/FileDrop'
import { ForecastModal } from '@/areas/inicio/ForecastModal'
import { MacroPicker } from './detail/MacroPicker'
import { ticketAbilities } from '@/access/ticketAbilities'
import { AuthUser } from '@/store/auth'
import { Ticket, TicketMessage, User, Queue, Category, Organization, TicketStatus, TicketPendingReason, QueueId, TicketPriority, TicketType, TicketEvent, TicketParticipant, TicketAttachment, Macro } from '@/types'
import { SkadiAvatar, StatusBadge, PriorityBadge, PriorityDot, TypeBadge, SLABadge, AiResolvedBadge, isAiResolved, Btn, Field, Txta, EmptyState, Modal, AccessDeniedView, SearchableSelect, Loading } from '@/components/ui'
import { ArrowLeft, FileText, X, Eye, Download, Paperclip, Trash2, Edit2 } from 'lucide-react'
import { ticketService, type TicketFamily } from '@/services/ticketService'
import { describeRule, ruleAppliesToQueue, TYPE_META } from '@/areas/configuracoes/escalationRules'
import { adminService } from '@/services/adminService'
import { macroService } from '@/services/macroService'
import { linkify, richText } from '@/utils/linkify'
import { AiNote, isAiNote, isSkadiMessage, withoutSkadiSignature } from '@/components/AiNote'
import { SKADI_NAME } from '@/utils/skadi'
import { formatDateTime } from '@/utils/dateTime'
import { downloadAttachment, openAttachment, getFileTypeInfo, filterValidAttachments, fileDropPasteHandlers, PASTE_HINT } from '@/utils/attachments'
import { IntakeFlag } from '@/components/IntakeFlag'
import { GuidancePanel } from '@/components/GuidancePanel'
import { TriagePanel } from '@/components/TriagePanel'
import { TriageSuggestions } from '@/components/TriageSuggestions'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { AttachmentLightbox } from '@/components/AttachmentLightbox'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import { sysAlert } from '@/store/alertStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { FileAttachmentChip, AttachmentChipList } from '@/components/ImageAttachmentChip'
import { groupAttachmentMessages, type MessageAttachment } from '@/utils/groupAttachmentMessages'
import { TicketProjectLink, LinkTicketToTaskModal, CreateTaskFromTicketModal, canOfferTaskLink } from '@/components/projects/TicketProjectLink'
import './chamados.css'

const STATUS_LABEL: Record<string, string> = { open: 'Aberto', in_progress: 'Em atendimento', pending: 'Pendente', resolved: 'Resolvido', closed: 'Fechado' }

const ROLE_LABEL: Record<string, string> = { agent: 'Analista', supervisor: 'Ticket Manager', manager: 'Gerente', admin: 'Administrador', user: 'Cliente' }

const PENDING_REASON_LABELS: Record<TicketPendingReason, string> = {
  pending_user: 'Pendente usuário',
  pending_vendor: 'Pendente fornecedor',
  pending_approval: 'Pendente aprovação interna',
  pending_parts: 'Pendente peça/material',
  pending_schedule: 'Pendente agendamento',
  pending_project: 'Em projeto',
}

export function TicketDetail({ ticket, currentUser, users, queues, categories, orgs, onClose, onTicketUpdate, unreadCount = 0, onChatRead, backLabel = 'Chamados' }: {
  ticket: Ticket
  currentUser: AuthUser
  users: User[]
  queues: Queue[]
  categories: Category[]
  orgs: Organization[]
  onClose: () => void
  onTicketUpdate: (id: string, updates: Partial<Ticket>) => void
  unreadCount?: number
  onChatRead?: () => void
  backLabel?: string
}) {
  const isCompact = useMediaQuery('(max-width: 1024px)')
  const [tab, setTab] = useState('timeline')
  // Mensagens do chamado + tempo real (sala do chamado, reconexão).
  const { messages, setMessages, messagesLoaded } = useTicketMessages(ticket, { onTicketUpdate, onChatRead })
  const [eventsList, setEventsList] = useState<TicketEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  // Solicitante e empresa como vieram no GET /tickets/:id: cobrem cadastros
  // feitos depois que as listas de usuários/empresas foram carregadas.
  const [detailRequester, setDetailRequester] = useState<Ticket['user']>()
  const [detailOrg, setDetailOrg] = useState<Organization>()
  const [accessError, setAccessError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [participants, setParticipants] = useState<TicketParticipant[]>(ticket.participants || [])
  // A listagem não traz ticket_attachments — vêm do GET /tickets/:id (loadEvents).
  const [attachments, setAttachments] = useState<TicketAttachment[]>(ticket.attachments || [])
  const [savingReopenSla, setSavingReopenSla] = useState(false)
  // Chamado pai/filhos (escalonamento por chamado filho).
  const [family, setFamily] = useState<TicketFamily | null>(null)

  useEffect(() => {
    adminService.getTicketTypeConfigs()
      .then((configs: { type: string; enabled: boolean }[]) => setEnabledTypes(new Set(configs.filter(c => c.enabled).map(c => c.type))))
      .catch(err => console.error('Erro ao carregar tipos de chamado habilitados:', err))
  }, [])

  const loadEvents = async () => {
    setEventsLoading(true)
    try {
      const fullTicket = await ticketService.getTicket(ticket.id)
      setEventsList(fullTicket.events || [])
      setParticipants(fullTicket.participants || [])
      setAttachments(fullTicket.attachments || [])
      setDetailRequester(fullTicket.user)
      setDetailOrg(fullTicket.org as Organization | undefined)
      // A lista não traz o vínculo com projeto: o card de Projeto depende disto.
      if (fullTicket.project_task !== undefined) onTicketUpdate(ticket.id, { project_task: fullTicket.project_task })
      Promise.resolve(ticketService.getFamily?.(ticket.id)).then(f => setFamily(f ?? null)).catch(() => setFamily(null))
    } catch (err: any) {
      if (err?.response?.status === 403) setAccessError(apiErrorMessage(err, 'Você não tem acesso a este chamado.'))
      console.error('Erro ao carregar eventos:', err)
    } finally {
      setEventsLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [ticket.id])

  const [compose, setCompose] = useState('')
  const [surveyDispatchChannel, setSurveyDispatchChannel] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [macros, setMacros] = useState<Macro[]>([])

  useEffect(() => {
    macroService.getMacros()
      .then(ms => setMacros(ms.filter(m => m.active)))
      .catch(() => setMacros([]))
  }, [])

  // Variáveis substituídas no backend (mesma função para chat e resposta).
  async function renderMacro(content: string) {
    try {
      const r = await macroService.render(content, ticket.id)
      if (r.surveyLink) setSurveyDispatchChannel('chat_macro')
      return r.content
    } catch (err) {
      console.error('[renderMacro] Erro ao substituir variáveis:', err)
      return content
    }
  }

  async function applyMacro(content: string) {
    const text = await renderMacro(content)
    setCompose(prev => (prev.trim() ? `${prev}\n${text}` : text))
  }

  async function applyMacroToReply(content: string) {
    const text = await renderMacro(content)
    setReplyText(prev => (prev.trim() ? `${prev}\n${text}` : text))
  }
  const [statusModal, setStatusModal] = useState(false)
  const [resolutionModal, setResolutionModal] = useState(false)
  const [queueModal, setQueueModal] = useState(false)
  const [catModal, setCatModal] = useState(false)
  const [priorityModal, setPriorityModal] = useState(false)
  const [typeModal, setTypeModal] = useState(false)
  const [agentModal, setAgentModal] = useState(false)
  const [requesterModal, setRequesterModal] = useState(false)
  const [tempRequester, setTempRequester] = useState('')
  const [escalateModal, setEscalateModal] = useState(false)
  const [escalationRules, setEscalationRules] = useState<any[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [escalationNote, setEscalationNote] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [reverting, setReverting] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [taskLinkModal, setTaskLinkModal] = useState<'create' | 'link' | null>(null)

  // Editor do pé da conversa: resposta ao cliente ou nota interna.
  const [replyModal, setReplyModal] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replyStatus, setReplyStatus] = useState(ticket.status)
  const [replyPriority, setReplyPriority] = useState(ticket.priority)
  const [replyQueue, setReplyQueue] = useState(ticket.queue)
  const [replyCat, setReplyCat] = useState({ id: ticket.categoryId, subId: ticket.subcategoryId })
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [loads, setLoads] = useState<Record<string, number>>({})
  const [editingMessage, setEditingMessage] = useState<TicketMessage | null>(null)
  const [editText, setEditText] = useState('')

  const [internalNoteModal, setInternalNoteModal] = useState(false)
  const [descriptionModal, setDescriptionModal] = useState(false)
  const [internalNoteText, setInternalNoteText] = useState('')
  const [internalNoteFiles, setInternalNoteFiles] = useState<File[]>([])

  useEffect(() => {
    setReplyStatus(ticket.status)
    setReplyPriority(ticket.priority)
    setReplyQueue(ticket.queue)
    setReplyCat({ id: ticket.categoryId, subId: ticket.subcategoryId })
    setReplyText('')
    setInternalNoteText('')
    setReplyFiles([])
    setInternalNoteFiles([])
    setMoreOpen(false)
    setInternalNoteModal(false)
    setReplyModal(false)
  }, [ticket.id])

  // Trocar o responsável mostra a carga de cada pessoa.
  useEffect(() => {
    if (!agentModal) return
    Promise.resolve(ticketService.getGroupedCounts?.('assignee'))
      .then(g => setLoads(Object.fromEntries(Object.entries(g ?? {}).map(([id, st]) => [id, (st.open ?? 0) + (st.in_progress ?? 0) + (st.pending ?? 0)]))))
      .catch(() => setLoads({}))
  }, [agentModal])

  // Atuação unificada (escalonamento no mesmo chamado)
  const activeCollaborators = participants.filter(p => p.role === 'collaborator' && p.active)
  const isOwner = ticket.assignedToId === currentUser.id
  const myParticipation = participants.find(p => p.agentId === currentUser.id && p.active)
  // O que a pessoa pode fazer aqui (regras com nome em access/ticketAbilities.ts).
  // Admin só olha — não assume, não responde, não modera.
  const can = ticketAbilities(currentUser, ticket, { isOwner, participation: myParticipation })
  const isAdminReadOnly = !can.act
  const canModerate = can.moderate
  const isCollaboratorOnly = can.collaboratorOnly
  const canManageTicket = can.act
  const canUseProjects = can.useProjects
  const canReassign = can.reassign
  const canJoin = can.join

  const handleJoin = async () => {
    setJoining(true)
    try {
      await ticketService.joinTicket(ticket.id)
      toast.success('Você entrou como colaborador e já pode alterar este chamado.')
      await loadEvents()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível entrar como colaborador.'))
    } finally {
      setJoining(false)
    }
  }
  const canRevert = can.revert
  const canDelete = can.delete

  const [tempStatus, setTempStatus] = useState(ticket.status)

  // Sincroniza estados locais quando o ticket prop é atualizado externamente
  useEffect(() => { setTempStatus(ticket.status) }, [ticket.status])
  useEffect(() => { if (statusModal) { setTempPendingReason(''); setPendingEvidenceFile(null); setTempPendingScheduleAt('') } }, [statusModal])
  useEffect(() => { setTempQueue(ticket.queue) }, [ticket.queue])
  useEffect(() => { setTempPriority(ticket.priority) }, [ticket.priority])
  useEffect(() => { setTempAgent(ticket.assignedToId ?? '') }, [ticket.assignedToId])
  useEffect(() => { setTempRequester(ticket.userId) }, [ticket.userId])
  const [tempQueue, setTempQueue] = useState(ticket.queue)
  const [tempCat, setTempCat] = useState({ id: ticket.categoryId, subId: ticket.subcategoryId })
  // Categorias desligadas para a empresa do chamado (Categorias › Empresas) não
  // aparecem para recategorizar; a categoria atual continua visível.
  const [blockedCatIds, setBlockedCatIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!ticket.orgId) { setBlockedCatIds(new Set()); return }
    let alive = true
    adminService.getOrgBlockedCategories(ticket.orgId)
      .then(ids => { if (alive) setBlockedCatIds(new Set(ids)) })
      .catch(() => { if (alive) setBlockedCatIds(new Set()) })
    return () => { alive = false }
  }, [ticket.orgId])
  const selectableCategories = useMemo(
    () => categories.filter(c => !blockedCatIds.has(c.id) || c.id === ticket.categoryId),
    [categories, blockedCatIds, ticket.categoryId],
  )
  const [tempPriority, setTempPriority] = useState(ticket.priority)
  const [tempType, setTempType] = useState<TicketType>(ticket.type)
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(['incident', 'request', 'problem', 'change']))
  const [tempAgent, setTempAgent] = useState(ticket.assignedToId ?? '')
  const [actionNote, setActionNote] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [requesterSearch, setRequesterSearch] = useState('')
  const motivoSuffix = actionNote.trim() ? ` Motivo: ${actionNote.trim()}` : ''
  const [resolutionDetails, setResolutionDetails] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [tempPendingReason, setTempPendingReason] = useState<TicketPendingReason | ''>('')
  const [pendingEvidenceFile, setPendingEvidenceFile] = useState<File | null>(null)
  const [tempPendingScheduleAt, setTempPendingScheduleAt] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const getUser = (id: string) => users.find(u => u.id === id)
  const getOrg  = (id: string) => orgs.find(o => o.id === id) ?? (detailOrg?.id === id ? detailOrg : undefined)
  const getCat  = (id: string) => categories.find(c => c.id === id)
  const requester = getUser(ticket.userId) ?? (detailRequester?.id === ticket.userId ? detailRequester as User : undefined)
  const agents = users.filter(u => 
    u.role === 'agent' || 
    u.role === 'supervisor' ||
    (requester?.manager_id && u.id === requester.manager_id)
  )
  const requesterCandidates = users.filter(u => u.role === 'user' && u.active)

  const req = requester
  const org = ticket.orgId ? getOrg(ticket.orgId) : null
  const slaPlan = org?.sla_config
  const slaResp = slaPlan?.[`${ticket.type}_first_response_hours`] ?? slaPlan?.incident_first_response_hours
  const slaSol = slaPlan?.[`${ticket.type}_resolution_hours`] ?? slaPlan?.incident_resolution_hours
  const cat = getCat(ticket.categoryId)


  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages])

  async function send() {
    if ((!compose.trim() && !selectedImage) || sending) return
    const typeMap: Record<string, 'agent' | 'email' | 'internal'> = { chat: 'agent', images: 'agent', internal: 'internal' }
    setSending(true)
    try {
      const sentType = typeMap[tab] || 'agent'
      // Mensagens enviadas pela aba "Chat" são do chat em tempo real (thread separado)
      const isRealtime = tab === 'chat'
      const newMsg = await ticketService.addMessage(ticket.id, compose, sentType, selectedImage || undefined, surveyDispatchChannel, isRealtime)
      setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
      setCompose('')
      setSelectedImage(null)
      setSurveyDispatchChannel(undefined)
      // Reabertura no mesmo chamado: mensagem (não interna) em chamado resolvido/fechado o reativa.
      if (sentType !== 'internal' && ['open', 'resolved', 'closed'].includes(ticket.status)) {
        const wasClosedOrResolved = ticket.status === 'resolved' || ticket.status === 'closed'
        onTicketUpdate(ticket.id, { status: 'in_progress', ...(wasClosedOrResolved ? { is_reopened: true } : {}) })
        if (wasClosedOrResolved) loadEvents()
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Mensagem não enviada. Tente novamente.'))
    } finally {
      setSending(false)
    }
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) readChatFile(file)
  }

  // Anexos vindos do input, de drop ou de Ctrl+V passam pela mesma validação do backend.
  const validFiles = (fs: File[]) => filterValidAttachments(fs, msg => toast.error(msg))
  const addReplyFiles = (fs: File[]) => setReplyFiles(prev => [...prev, ...validFiles(fs)])
  const addInternalNoteFiles = (fs: File[]) => setInternalNoteFiles(prev => [...prev, ...validFiles(fs)])
  const addResolutionFiles = (fs: File[]) => setFiles(prev => [...prev, ...validFiles(fs)])
  function addPendingEvidence(fs: File[]) {
    const valid = validFiles(fs)
    const img = valid.find(f => f.type.startsWith('image/'))
    if (img) setPendingEvidenceFile(img)
    else if (valid.length > 0) toast.error('A evidência da pendência precisa ser uma imagem.')
  }

  function readChatFile(file: File) {
    const reader = new FileReader()
    reader.onloadend = () => {
      setSelectedImage(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  async function addInternalNote(text: string, ticketUpdates?: Record<string, any>) {
    // Aplica a mudança no chamado ANTES de registrar a nota interna — se o
    // backend rejeitar (ex: 403 por não ser o responsável), nenhuma nota
    // "fantasma" descrevendo uma mudança que não aconteceu fica no histórico.
    if (ticketUpdates && Object.keys(ticketUpdates).length > 0) {
      try {
        await ticketService.updateTicket(ticket.id, ticketUpdates)
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Não foi possível salvar a alteração. Você precisa assumir o chamado antes de modificá-lo.')
        throw err
      }
      const stateUpdates = { ...ticketUpdates }
      // Mapeia snake_case do backend para camelCase do frontend para consistência da UI
      if (stateUpdates.assigned_to_id !== undefined) stateUpdates.assignedToId = stateUpdates.assigned_to_id
      if (stateUpdates.pending_reason) {
        stateUpdates.pendingReason = stateUpdates.pending_reason
        stateUpdates.pendingScheduleAt = stateUpdates.pending_schedule_at ?? null
      } else if (stateUpdates.status && stateUpdates.status !== 'pending') {
        stateUpdates.pendingReason = null
        stateUpdates.pendingScheduleAt = null
      }
      if (stateUpdates.requesterId !== undefined) {
        const newRequester = users.find(u => u.id === stateUpdates.requesterId)
        stateUpdates.userId = stateUpdates.requesterId
        stateUpdates.orgId = newRequester?.orgId ?? newRequester?.org_id ?? null
        delete stateUpdates.requesterId
      }
      onTicketUpdate(ticket.id, stateUpdates as Partial<Ticket>)
    }
    await ticketService.addMessage(ticket.id, text, 'internal')
    ticketService.getMessages(ticket.id).then(setMessages).catch(() => {})
    loadEvents()
  }

  async function handleResolve() {
    if (!resolutionDetails.trim() || resolutionDetails.trim().length < 10) return
    setSending(true)
    try {
      // 1. Adiciona a nota interna principal e atualiza o status/resolução
      await addInternalNote(`Chamado resolvido por ${currentUser.name}. Detalhes: ${resolutionDetails}`, { 
        status: 'resolved', 
        resolution_details: resolutionDetails 
      })

      // 2. Se houver arquivos, envia cada um como uma nota interna com anexo
      if (files.length > 0) {
        for (const file of files) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          await ticketService.addMessage(ticket.id, `Anexo de resolução: ${file.name}`, 'internal', dataUrl)
        }
        // Recarrega mensagens para incluir os novos anexos
        const msgs = await ticketService.getMessages(ticket.id)
        setMessages(msgs)
      }

      setResolutionModal(false)
      setResolutionDetails('')
      setFiles([])
      toast.success('Chamado resolvido com sucesso!')
    } catch (err: any) {
      console.error('Erro ao resolver chamado:', err)
      toast.error(apiErrorMessage(err, 'Erro ao salvar anexos da resolução.'))
    } finally {
      setSending(false)
    }
  }

  // Pendência: tipo e justificativa obrigatórios; evidência opcional.
  // Compartilhado pelos modais "Mudar status" e "Responder ao cliente" (o backend
  // exige o mesmo). Na resposta, o texto já é a justificativa e o anexo a evidência.
  const pendingTypeValid = !!tempPendingReason &&
    (tempPendingReason !== 'pending_schedule' || (!!tempPendingScheduleAt && new Date(tempPendingScheduleAt).getTime() > Date.now()))
  const pendingFieldsValid = actionNote.trim().length > 0 && pendingTypeValid
  const replyEntersPending = replyStatus === 'pending' && ticket.status !== 'pending'
  // Já pendente: o tipo é opcional na resposta (vazio = mantém o atual).
  const replyChangesPending = replyStatus === 'pending' && ticket.status === 'pending' && !!tempPendingReason
  const replyPendingValid = !(replyEntersPending || replyChangesPending) || (pendingTypeValid && !!replyText.trim())

  async function buildPendingUpdates(note = actionNote, evidenceFile = pendingEvidenceFile): Promise<Record<string, any>> {
    const updates: Record<string, any> = { note, pending_reason: tempPendingReason }
    if (evidenceFile) {
      updates.pending_evidence_url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(evidenceFile)
      })
    }
    if (tempPendingReason === 'pending_schedule') updates.pending_schedule_at = new Date(tempPendingScheduleAt).toISOString()
    return updates
  }

  // Sem noteLabel (resposta ao cliente): só tipo e agendamento.
  function renderPendingFields(noteLabel?: string) {
    return (
      <>
        <Field label={!noteLabel && ticket.status === 'pending' ? 'Trocar tipo de pendência (opcional)' : 'Tipo de pendência (obrigatório)'}>
          <select value={tempPendingReason} onChange={e => setTempPendingReason(e.target.value as TicketPendingReason)}>
            <option value="">{!noteLabel && ticket.status === 'pending' ? `Manter atual (${PENDING_REASON_LABELS[ticket.pendingReason as TicketPendingReason] ?? '—'})` : 'Selecione...'}</option>
            {/* 'Em projeto' só entra pelo vínculo com uma task (pausa o SLA), nunca à mão. */}
            {Object.entries(PENDING_REASON_LABELS).filter(([v]) => v !== 'pending_project').map(([v, l]) => (
              // Já pendente: a subpendência atual não é opção de troca.
              <option key={v} value={v} disabled={ticket.status === 'pending' && v === ticket.pendingReason}>{l}{ticket.status === 'pending' && v === ticket.pendingReason ? ' (atual)' : ''}</option>
            ))}
          </select>
        </Field>
        {tempPendingReason === 'pending_schedule' && (
          <Field label="Agendado para (obrigatório)">
            <input
              type="datetime-local"
              value={tempPendingScheduleAt}
              min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
              onChange={e => setTempPendingScheduleAt(e.target.value)}
              style={{ width: '100%', padding: '9px 10px', fontSize: 14, border: '1px solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', fontFamily: 'var(--font)' }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              O chamado volta automaticamente para "Em atendimento" nesta data/hora.
            </div>
          </Field>
        )}
        {noteLabel && <>
        <Field label={noteLabel}>
          <Txta value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Descreva o motivo desta mudança..." rows={3} style={{ fontSize: 13 }} maxLength={1000} showCount {...fileDropPasteHandlers(addPendingEvidence)} />
        </Field>
        <Field label="Evidência (imagem, opcional)">
          <FileDrop id="pending-evidence-file" accept="image/*" multiple={false} hint={`Comprovação da pendência (JPG, PNG) · ${PASTE_HINT}`}
            files={pendingEvidenceFile ? [pendingEvidenceFile] : []} onFiles={addPendingEvidence} onRemove={() => setPendingEvidenceFile(null)} />
        </Field>
        </>}
      </>
    )
  }

  // Mover para uma fila que o analista responsável não
  // participa deixa o chamado sem responsável — avisa antes de salvar.
  function renderQueueDropWarning(queueId: QueueId) {
    const assignee = users.find(u => u.id === ticket.assignedToId)
    if (!assignee || assignee.role !== 'agent' || queueId === ticket.queue || (assignee.queues ?? []).includes(queueId)) return null
    return (
      <p className="notice" style={{ color: 'var(--warning)' }}>
        {assignee.id === currentUser.id ? 'Você não participa' : `${assignee.name} não participa`} desta fila: ao salvar, o chamado ficará sem responsável.
      </p>
    )
  }

  async function handleSendReply() {
    if (!replyText.trim() && replyFiles.length === 0) return
    if (!replyPendingValid) return
    setSending(true)
    try {
      const updates: any = {}
      if (replyStatus !== ticket.status) updates.status = replyStatus
      if (replyPriority !== ticket.priority) updates.priority = replyPriority
      if (replyQueue !== ticket.queue) updates.queue = replyQueue
      if (replyCat.id !== ticket.categoryId || replyCat.subId !== ticket.subcategoryId) {
        updates.categoryId = replyCat.id
        updates.subcategoryId = replyCat.subId
      }
      if (replyEntersPending || replyChangesPending) Object.assign(updates, { status: 'pending' }, await buildPendingUpdates(replyText, null))

      const applyUpdates = async () => {
        if (Object.keys(updates).length === 0) return
        const updated = await ticketService.updateTicket(ticket.id, updates)
        onTicketUpdate(ticket.id, updated)
      }
      // Aplica as alterações ANTES de enviar: se o backend rejeitar (pendência
      // incompleta, 403 de responsável, reabertura expirada) a resposta não sai
      // pela metade. Exceção: voltar para "Aberto" — a mensagem do analista em
      // chamado aberto o move para "Em atendimento" e desfaria a escolha.
      if (updates.status !== 'open') await applyUpdates()

      let attachmentUrl: string | undefined = undefined
      if (replyFiles.length > 0) {
        const file = replyFiles[0]
        attachmentUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }

      const newMsg = await ticketService.addMessage(ticket.id, replyText, 'agent', attachmentUrl)
      setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])

      // Envia arquivos adicionais como mensagens consecutivas de anexo
      if (replyFiles.length > 1) {
        for (let i = 1; i < replyFiles.length; i++) {
          const file = replyFiles[i]
          const extraAttachmentUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const extraMsg = await ticketService.addMessage(ticket.id, `Anexo adicional: ${file.name}`, 'agent', extraAttachmentUrl)
          setMessages(prev => prev.some(m => m.id === extraMsg.id) ? prev : [...prev, extraMsg])
        }
      }

      if (updates.status === 'open') await applyUpdates()

      setReplyText('')
      setReplyFiles([])
      setMoreOpen(false)
      setReplyModal(false)
      loadEvents()
      toast.success('Resposta enviada com sucesso!')
    } catch (err) {
      console.error('Erro ao enviar resposta:', err)
      toast.error(apiErrorMessage(err, 'Erro ao enviar resposta.'))
    } finally {
      setSending(false)
    }
  }

  // Um passo: o texto é a solução que o cliente lê; os anexos vão antes, na conversa.
  async function handleSendAndResolve() {
    const text = replyText.trim()
    if (text.length < 10 || sending) return
    setSending(true)
    try {
      for (const file of replyFiles) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const msg = await ticketService.addMessage(ticket.id, `Anexo da solução: ${file.name}`, 'agent', url)
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      }
      const updated = await ticketService.updateTicket(ticket.id, {
        status: 'resolved', resolution_details: text, ...(!ticket.assignedToId && { assigned_to_id: currentUser.id }),
      } as any)
      onTicketUpdate(ticket.id, updated)
      setReplyText(''); setReplyFiles([]); setReplyModal(false)
      loadEvents()
      toast.success('Solução enviada e chamado resolvido.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível resolver. O chamado continua aberto.'))
    } finally {
      setSending(false)
    }
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
      toast.error(apiErrorMessage(err, 'Erro ao editar a mensagem.'))
    }
  }

  async function handleDeleteTicket() {
    if (!(await sysAlert.confirm('Excluir chamado', `Tem certeza que deseja excluir o chamado ${ticket.displayNumber ?? ''}? Ele deixará de aparecer em filas e dashboards.`, 'danger', 'Excluir', 'Cancelar'))) return
    try {
      await ticketService.deleteTicket(ticket.id)
      toast.success('Chamado excluído com sucesso!')
      onClose()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao excluir o chamado.'))
    }
  }

  async function handleDeleteMessage(msgId: string) {
    if (!(await sysAlert.confirm('Excluir mensagem', 'Tem certeza que deseja excluir esta mensagem?', 'danger', 'Excluir', 'Cancelar'))) return
    try {
      await ticketService.deleteMessage(ticket.id, msgId)
      setMessages(prev => prev.filter(m => m.id !== msgId))
      toast.success('Mensagem excluída com sucesso!')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao excluir a mensagem.'))
    }
  }

  async function handleSendInternalNote() {
    if (!internalNoteText.trim() && internalNoteFiles.length === 0) return
    setSending(true)
    try {
      let attachmentUrl: string | undefined = undefined
      if (internalNoteFiles.length > 0) {
        const file = internalNoteFiles[0]
        attachmentUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }

      const newMsg = await ticketService.addMessage(ticket.id, internalNoteText, 'internal', attachmentUrl)
      setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])

      // Envia notas internas adicionais para outros anexos
      if (internalNoteFiles.length > 1) {
        for (let i = 1; i < internalNoteFiles.length; i++) {
          const file = internalNoteFiles[i]
          const extraAttachmentUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const extraMsg = await ticketService.addMessage(ticket.id, `Anexo adicional: ${file.name}`, 'internal', extraAttachmentUrl)
          setMessages(prev => prev.some(m => m.id === extraMsg.id) ? prev : [...prev, extraMsg])
        }
      }

      setInternalNoteText('')
      setInternalNoteFiles([])
      setInternalNoteModal(false)
      toast.success('Conversa interna salva!')
    } catch (err) {
      console.error('Erro ao salvar conversa interna:', err)
      toast.error(apiErrorMessage(err, 'Erro ao salvar conversa interna.'))
    } finally {
      setSending(false)
    }
  }

  async function openEscalateModal() {
    setSelectedRuleId('')
    setSelectedAgentId('')
    setEscalationNote('')
    // Sempre relê: a regra pode ter mudado desde a última abertura.
    const rules = await adminService.getEscalationRules().catch(() => [])
    setEscalationRules(rules.filter((r: any) => r.active))
    setEscalateModal(true)
  }

  // Regras desta fila; a escolhida diz se pede analista e/ou justificativa.
  const applicableRules = escalationRules.filter((r: any) => ruleAppliesToQueue(r, ticket.queue))
  const selectedRule = applicableRules.find((r: any) => r.id === selectedRuleId)
  const needsAgentPick = !!selectedRule && (selectedRule.target_mode
    ? selectedRule.target_mode === 'agent_pick' && selectedRule.type !== 'category_change'
    : selectedRule.type === 'same_ticket' && !selectedRule.target_queue_id)
  const needsNote = !!selectedRule?.require_note
  const escalateDisabled = !selectedRuleId || escalating || (needsAgentPick && !selectedAgentId) || (needsNote && escalationNote.trim().length < 5)

  async function handleEscalate() {
    if (escalateDisabled) return
    setEscalating(true)
    try {
      const result = await ticketService.escalateTicket(ticket.id, selectedRuleId, needsAgentPick ? selectedAgentId : null, escalationNote.trim() || null)
      if (selectedRule?.type === 'transfer') {
        setEscalateModal(false)
        // Quem transferiu (sem ficar como colaborador) perde o vínculo: volta para a lista.
        if (!result?.keptOrigin && result?.targetAgentId !== currentUser.id) {
          toast.success(`Chamado transferido para ${result?.destName ?? 'a fila de destino'}.`)
          onClose()
          return
        }
        if (result?.ticket) onTicketUpdate(ticket.id, result.ticket)
        ticketService.getMessages(ticket.id).then(setMessages).catch(() => {})
        loadEvents()
        toast.success(`Chamado transferido para ${result?.destName ?? 'a fila de destino'}. Você segue como colaborador.`)
        return
      }
      ticketService.getMessages(ticket.id).then(setMessages).catch(() => {})
      setEscalateModal(false)
      loadEvents()
      if (result?.ticket) onTicketUpdate(ticket.id, result.ticket)
      else onTicketUpdate(ticket.id, { escalated: true })
      toast.success(result?.type === 'child_ticket' ? `Chamado filho ${result.childTicketId} aberto.` : 'Chamado escalonado com sucesso!')
    } catch (err: any) {
      toast.error('Erro ao escalonar: ' + (err.response?.data?.error || err.message))
    } finally {
      setEscalating(false)
    }
  }

  async function handleRevert(agentId: string | null) {
    const key = agentId || '__queue__'
    if (reverting) return
    setReverting(key)
    try {
      const result = await ticketService.revertEscalation(ticket.id, agentId)
      ticketService.getMessages(ticket.id).then(setMessages).catch(() => {})
      loadEvents()
      if (result?.ticket && typeof result.ticket.escalated === 'boolean') {
        onTicketUpdate(ticket.id, { escalated: result.ticket.escalated })
      }
      toast.success('Escalonamento revertido com sucesso!')
    } catch (err: any) {
      toast.error('Erro ao reverter escalonamento: ' + (err.response?.data?.error || err.message))
    } finally {
      setReverting('')
    }
  }



  const documents = [
    ...(ticket.attachmentUrl ? [{ key: 'initial', url: ticket.attachmentUrl, label: 'Anexo inicial', name: `ticket-${ticket.id}-attachment` }] : []),
    ...attachments.map(a => ({ key: a.id, url: a.url, label: a.name, name: a.name })),
    ...messages.flatMap(m => m.attachmentUrl ? [{ key: m.id, url: m.attachmentUrl, label: new Date(m.createdAt).toLocaleDateString('pt-BR'), name: `anexo-${m.id}` }] : []),
  ]

  // Vários arquivos num envio viram uma mensagem por arquivo ("Anexo adicional"): agrupa de volta.
  const groupedTimeline = groupAttachmentMessages(messages.filter(m => !m.isRealtime), { userId: ticket.userId, createdAt: ticket.createdAt })
  const extrasOf = (m: TicketMessage): MessageAttachment[] => (m as TicketMessage & { extraAttachments?: MessageAttachment[] }).extraAttachments ?? []
  const timelineItems = [
    // Mensagens do chat em tempo real ficam isoladas na aba "Chat" — não poluem a timeline
    ...groupedTimeline.messages.map(m => ({
      id: `msg-${m.id}`,
      date: new Date(m.createdAt),
      type: (m.type === 'internal' ? 'internal' as const : 'reply' as const),
      payload: m
    })),
    ...eventsList.map(e => ({
      id: `evt-${e.id}`,
      date: new Date(e.createdAt),
      type: 'event' as const,
      payload: e
    }))
  ].sort((a, b) => a.date.getTime() - b.date.getTime())
  // Só a nota mais recente da Triagem IA leva os botões de sugestão (as antigas ficam só como registro).
  const lastTriageNoteId = messages.filter(m => isAiNote(m) && /\*\*Triagem IA\*\*/.test(m.text)).pop()?.id
  const triageCurrent = { type: ticket.type, priority: ticket.priority, category: ticket.categoryId, subcategory: ticket.subcategoryId ?? null }

  // Abertura do chamado: descrição completa + anexos iniciais, sempre o primeiro registro da timeline.
  const openingAttachments = [
    ...(ticket.attachmentUrl ? [{ id: 'initial', name: 'Anexo inicial', url: ticket.attachmentUrl, type: '' }] : []),
    ...attachments,
    ...groupedTimeline.openingExtras.map(a => ({ ...a, type: '' })),
  ]
  const openingFields = ticket.special_data ? Object.entries(ticket.special_data).filter(([, v]) => v !== '' && v != null) : []
  const hasOpening = !!(ticket.description || openingFields.length || openingAttachments.length)
  const openingMeta = `Aberto por ${req?.name ?? ticket.user?.name ?? 'solicitante'} em ${formatDateTime(ticket.createdAt)}${ticket.channel === 'email' ? ' · por e-mail' : ''}`

  if (accessError) return <AccessDeniedView message={accessError} onBack={onClose} />

  const isFinished = ['resolved', 'closed'].includes(ticket.status)
  const assignee = users.find(u => u.id === ticket.assignedToId)
  const canEditStatus = canManageTicket && (!isFinished || !!ticket.canReopen)
  const subcategory = ticket.subcategoryId && (cat?.subcategories.find(s => s.id === ticket.subcategoryId)?.name || ticket.subcategoryId)
  const canWrite = !isAdminReadOnly && !isFinished

  const openInternalNote = () => { setTab('timeline'); setReplyModal(false); setInternalNoteModal(true) }
  const openReply = () => {
    setTab('timeline')
    setInternalNoteModal(false)
    setReplyStatus(ticket.status)
    setReplyPriority(ticket.priority)
    setReplyQueue(ticket.queue)
    setReplyCat({ id: ticket.categoryId, subId: ticket.subcategoryId })
    setReplyText('')
    setReplyFiles([])
    setActionNote('')
    setTempPendingReason(''); setPendingEvidenceFile(null); setTempPendingScheduleAt('')
    setReplyModal(true)
  }

  // Item do menu Ações: fecha o menu e executa.
  const action = (label: string, run: () => void, extra: { danger?: boolean; disabled?: boolean } = {}) => (
    <button type="button" className={extra.danger ? 'danger' : undefined} disabled={extra.disabled} onClick={() => { setActionsOpen(false); run() }}>{label}</button>
  )
  const actions = (!isAdminReadOnly || canDelete) && (
    <div className="td-actions">
      <Btn size="sm" variant="secondary" aria-expanded={actionsOpen} onClick={() => setActionsOpen(!actionsOpen)}>Ações</Btn>
      {actionsOpen && (
        <div>
          {canWrite && <>
            {canJoin && action('Assumir como colaborador', handleJoin, { disabled: joining })}
            {canReassign && ticket.assignedToId !== currentUser.id && action('Assumir chamado', async () => {
              onTicketUpdate(ticket.id, { assignedToId: currentUser.id })
              toast.success('Chamado assumido com sucesso!')
              await addInternalNote(`Chamado assumido por ${currentUser.name}.`, { assigned_to_id: currentUser.id })
            })}
            {action('Responder ao cliente', openReply)}
            {action('Conversa interna', openInternalNote)}
            {action('Escalonar chamado', openEscalateModal)}
            {canOfferTaskLink(ticket, canUseProjects) && <>
              {action('Criar task', () => setTaskLinkModal('create'))}
              {action('Vincular a uma task', () => setTaskLinkModal('link'))}
            </>}
            {canManageTicket && action('Trocar requisitante', () => { setTempRequester(ticket.userId); setActionNote(''); setRequesterModal(true) })}
            {action('Resolver chamado', () => setResolutionModal(true))}
          </>}
          {!isAdminReadOnly && isFinished && ticket.canReopen && action('Reabrir chamado', () => { setTempStatus('open'); setActionNote(''); setStatusModal(true) })}
          {canDelete && action('Excluir chamado', handleDeleteTicket, { danger: true })}
        </div>
      )}
    </div>
  )

  // Linha rótulo/valor da coluna de dados; com `edit` o clique abre a janela de alteração.
  const pair = (label: string, value: React.ReactNode, edit?: (() => void) | false, title?: string) => (
    <div className="td-pair" data-edit={edit ? true : undefined} onClick={edit || undefined} title={title}>
      <span>{label}</span>
      <div>{value}</div>
    </div>
  )

  const facts = (
    <>
      {!isCompact && actions}
      <div className="td-pairs">
        {pair('Situação', <>
          {STATUS_LABEL[ticket.status] ?? ticket.status}
          {ticket.status === 'pending' && ticket.pendingReason && (
            <small>
              {PENDING_REASON_LABELS[ticket.pendingReason]}
              {ticket.pendingReason === 'pending_schedule' && ticket.pendingScheduleAt && ` · ${new Date(ticket.pendingScheduleAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
            </small>
          )}
        </>, canEditStatus && (() => { setTempStatus(ticket.status); setActionNote(''); setStatusModal(true) }))}
        {pair('Prioridade', <PriorityBadge priority={ticket.priority} />, canManageTicket && (() => { setTempPriority(ticket.priority); setActionNote(''); setPriorityModal(true) }))}
        {!isFinished && pair('Prazo final', new Date(ticket.slaDeadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}
        {!isFinished && pair('Previsão ao cliente', ticket.clientForecastAt
          ? <>{new Date(ticket.clientForecastAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{new Date(ticket.clientForecastAt) < new Date() && <small>Passou: informe outra</small>}</>
          : new Date(ticket.slaDeadline) < new Date() && ticket.status !== 'pending' ? <span style={{ color: 'var(--danger)' }}>Sem data: informe uma</span> : 'Igual ao prazo', canManageTicket && (() => setForecastOpen(true)))}
        {isFinished && !isAiResolved(ticket) && <>
          {ticket.resolved_at && (() => {
            const openMs = new Date(ticket.resolved_at).getTime() - new Date(ticket.createdAt).getTime()
            const h = Math.floor(openMs / 3600000), m = Math.floor((openMs % 3600000) / 60000)
            return pair('Tempo em atendimento', h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h ${m}min` : h > 0 ? `${h}h ${m}min` : `${m}min`)
          })()}
          {pair('SLA no encerramento', <SLABadge deadline={ticket.slaDeadline} status={ticket.status} resolvedAt={ticket.resolved_at} compact />)}
        </>}
        {pair('Responsável', assignee?.name ?? <span style={{ color: 'var(--text-3)' }}>Ninguém atribuído</span>,
          canReassign && (() => { setTempAgent(ticket.assignedToId ?? ''); setActionNote(''); setAgentModal(true) }),
          isCollaboratorOnly ? 'Como colaborador você não troca o responsável principal — peça ao responsável ou a um gestor.' : undefined)}
        {pair('Fila', queues.find(q => q.id === ticket.queue)?.name || ticket.queue, canManageTicket && (() => { setTempQueue(ticket.queue); setActionNote(''); setQueueModal(true) }))}
        {pair('Categoria', <>{cat?.name ?? '—'}{subcategory && <small>{subcategory}</small>}</>, canManageTicket && (() => { setTempCat({ id: ticket.categoryId, subId: ticket.subcategoryId }); setActionNote(''); setCatModal(true) }))}
        {pair('Tipo', <TypeBadge type={ticket.type} />, canManageTicket && (() => { setTempType(ticket.type); setActionNote(''); setTypeModal(true) }))}
        {req && pair('Solicitante', <>{req.name}<small>{req.email}</small></>)}
        {org && pair('Empresa', <>
          {org.name}
          <small title="SLA do plano para este tipo de chamado: 1ª resposta / solução">
            Plano {org.tier}{slaResp != null && slaSol != null && ` · ${slaResp}h resp / ${slaSol}h sol`}
          </small>
        </>)}
      </div>

      <div className="td-sec">
        <h2>{ticket.special_data ? 'Dados do formulário' : 'Solicitação original'}</h2>
        <small>{openingMeta}</small>
        {((ticket.special_data && Object.keys(ticket.special_data).length > 0) || (!ticket.special_data && ticket.description)) && (
          <div>
            <button type="button" className="td-link" aria-label={ticket.special_data ? 'Expandir dados do formulário' : 'Expandir descrição'} onClick={() => setDescriptionModal(true)}>Ver texto completo</button>
          </div>
        )}
      </div>

      {isFinished && ticket.resolution_details && (
        <div className="td-sec"><h2>Solução aplicada</h2><p>{ticket.resolution_details}</p></div>
      )}

      <div className="td-ai" key={ticket.id}>
        <TicketProjectLink ticket={ticket} canUseProjects={canUseProjects} onChanged={(fresh) => onTicketUpdate(ticket.id, fresh)} />
        <GuidancePanel ticketId={ticket.id} canVeto={can.aiActions} />
        {can.seesTriage && <TriagePanel ticketId={ticket.id} updatedAt={ticket.updatedAt} canApply={can.aiActions} current={triageCurrent} onApply={(u, note) => addInternalNote(note, u)} />}
      </div>

      {/* Chamado pai / filhos (escalonamento por chamado filho) */}
      {family && (family.parent || family.children.length > 0) && (
        <div className="td-sec" data-testid="ticket-family">
          <h2>Chamados vinculados</h2>
          {[...(family.parent ? [{ ...family.parent, rel: 'Chamado pai' }] : []), ...family.children.map(c => ({ ...c, rel: 'Chamado filho' }))].map(item => (
            <a key={item.id} className="td-item" href={`?ticket=${encodeURIComponent(item.id)}`}
              onClick={e => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
                // Troca o ?ticket= sem recarregar: o roteador ouve o popstate e abre o chamado.
                e.preventDefault()
                const url = new URL(window.location.href)
                url.searchParams.set('ticket', item.id)
                window.history.pushState({}, '', url)
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}>
              <div>
                {item.id} · {item.title}
                <small>{item.rel} · {queues.find(q => q.id === item.queue)?.name ?? item.queue ?? 'sem fila'}{item.assignedTo ? ` · ${item.assignedTo.name}` : ''}</small>
              </div>
              <StatusBadge status={item.status as TicketStatus} compact />
            </a>
          ))}
        </div>
      )}

      {(activeCollaborators.length > 0 || ticket.collabQueue) && (
        <div className="td-sec">
          <h2>Agentes no chamado</h2>
          {ticket.assignedToId && <div className="td-item"><div>{assignee?.name || 'Responsável'}<small>Responsável principal</small></div></div>}
          {activeCollaborators.map(p => (
            <div key={p.id} className="td-item">
              <div>{p.agent?.name || users.find(u => u.id === p.agentId)?.name || 'Colaborador'}<small>Colaborador (escalonado)</small></div>
              {canRevert && <button type="button" className="icon-act danger" onClick={() => handleRevert(p.agentId)} disabled={reverting === p.agentId} title="Remover colaborador do chamado" aria-label="Remover colaborador do chamado"><Trash2 size={15} /></button>}
            </div>
          ))}
          {ticket.collabQueue && (
            <div className="td-item">
              <div>{queues.find(q => q.id === ticket.collabQueue)?.name || ticket.collabQueue}<small>Fila em atuação conjunta</small></div>
              {canRevert && <button type="button" className="icon-act danger" onClick={() => handleRevert(null)} disabled={reverting === '__queue__'} title="Remover fila de colaboração" aria-label="Remover fila de colaboração"><Trash2 size={15} /></button>}
            </div>
          )}
        </div>
      )}
    </>
  )

  const viewImage = setLightbox
  const messageActions = (msg: TicketMessage) => (msg.userId === currentUser.id || canModerate) && ticket.status !== 'closed' && <>
    <button type="button" className="icon-act" onClick={() => { setEditingMessage(msg); setEditText(msg.text || '') }} title="Editar" aria-label="Editar"><Edit2 size={13} /></button>
    <button type="button" className="icon-act danger" onClick={() => handleDeleteMessage(msg.id)} title="Excluir" aria-label="Excluir"><Trash2 size={13} /></button>
  </>
  const messageBody = (msg: TicketMessage, text: React.ReactNode, prefix = 'anexo') => <>
    {msg.text && <div>{text}</div>}
    {msg.attachmentUrl && <EntryAttachment url={msg.attachmentUrl} downloadName={`${prefix}-${msg.id}`} onView={viewImage} />}
    <AttachmentChipList items={extrasOf(msg)} onOpenImage={a => setLightbox({ url: a.url, name: a.name })} onDownload={a => downloadAttachment(a.url, a.name)} />
  </>
  const nameOf = (msg: TicketMessage) => (msg.user ?? getUser(msg.userId))?.name ?? '?'
  const actorOf = (event: TicketEvent) => event.user?.name || (event.userId === '00000000-0000-0000-0000-000000000000' ? 'Sistema' : 'Desconhecido')
  const noteOf = (event: TicketEvent) => event.note || (event.fromStatus ? `Status: ${STATUS_LABEL[event.toStatus] ?? event.toStatus}` : 'Chamado aberto')
  const logType = (event: TicketEvent) => {
    const note = noteOf(event).toLowerCase()
    const has = (...words: string[]) => words.some(w => note.includes(w))
    if (has('reabertura', 'reaberto')) return 'Reabertura'
    if (has('escalonamento', 'escalonado')) return 'Escalonamento'
    if (has('redirecionamento', 'inatividade', 'redistribu')) return 'Redistribuição'
    if (has('prioridade')) return 'Prioridade'
    if (has('responsável', 'atribuição')) return 'Atribuição'
    if (has('status') || event.fromStatus !== event.toStatus) return 'Status'
    return 'Evento'
  }

  const timeline = !messagesLoaded || eventsLoading ? (
    <Loading size="compact" label="Carregando timeline…" />
  ) : timelineItems.length === 0 && !hasOpening ? (
    <EmptyState title="Sem registros na timeline" desc="Nenhuma resposta ou evento registrado ainda para este chamado." />
  ) : (
    <>
      {hasOpening && (
        <Entry who={req?.name ?? 'Solicitante'} date={ticket.createdAt} textTestId="opening-request"
          tags={<><span>Abertura do chamado</span>{ticket.channel === 'email' && <span>E-mail</span>}</>}>
          {openingFields.length > 0
            ? openingFields.map(([k, v]) => <div key={k} className="td-field"><small>{k.replace(/_/g, ' ')}</small>{linkify(String(v))}</div>)
            : ticket.description && <div>{linkify(ticket.description)}</div>}
          {openingAttachments.map(a => <EntryAttachment key={a.id} url={a.url} name={a.name} downloadName={a.name} image={a.type?.startsWith('image/')} onView={viewImage} />)}
        </Entry>
      )}
      {timelineItems.map(item => {
        if (item.type === 'event') {
          const event = item.payload as TicketEvent
          // Resolução: o texto é a solução aplicada.
          const resolved = event.toStatus === 'resolved' && event.fromStatus !== 'resolved'
          return (
            <Entry key={item.id} kind="event" who={actorOf(event)} date={event.createdAt} tags={resolved && <span>Chamado resolvido</span>}>
              {noteOf(event)}
            </Entry>
          )
        }
        const msg = item.payload as TicketMessage
        if (item.type === 'internal') {
          if (isAiNote(msg)) return (
            <div key={item.id} className="td-wide">
              <AiNote msg={msg}>
                {msg.id === lastTriageNoteId && can.seesTriage && can.aiActions && (
                  <TriageSuggestions ticketId={ticket.id} updatedAt={ticket.updatedAt} current={triageCurrent} onApply={(u, note) => addInternalNote(note, u)} />
                )}
              </AiNote>
            </div>
          )
          return (
            <Entry key={item.id} kind="internal" who={nameOf(msg)} date={msg.createdAt} tags={<span>Interna</span>} actions={messageActions(msg)}>
              {messageBody(msg, richText(msg.text), 'nota')}
            </Entry>
          )
        }
        const fromSkadi = isSkadiMessage(msg)
        return (
          <Entry key={item.id} who={fromSkadi ? SKADI_NAME : nameOf(msg)} avatar={fromSkadi && <SkadiAvatar size={20} decorative />} date={msg.createdAt}
            tags={msg.type === 'email' && <span>E-mail</span>} actions={messageActions(msg)}>
            {messageBody(msg, linkify(fromSkadi ? withoutSkadiSignature(msg.text) : msg.text))}
          </Entry>
        )
      })}
    </>
  )

  const documentsTab = documents.length === 0 ? (
    <EmptyState title="Sem documentos" desc="Nenhum arquivo foi anexado a este chamado." />
  ) : (
    <table className="table">
      <thead><tr><th>Arquivo</th><th>Tipo</th><th /></tr></thead>
      <tbody>
        {documents.map(doc => {
          const info = getFileTypeInfo(doc.url)
          const open = () => info.isImage ? setLightbox({ url: doc.url, name: doc.name }) : openAttachment(doc.url)
          return (
            <tr key={doc.key}>
              <td style={{ overflowWrap: 'anywhere' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {info.isImage && <img src={doc.url} alt="" onClick={open} style={{ width: 56, height: 40, objectFit: 'cover', cursor: 'zoom-in' }} />}
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

  const logsTab = eventsLoading ? (
    <Loading size="compact" label="Carregando log de eventos…" />
  ) : eventsList.length === 0 ? (
    <EmptyState title="Sem registros de LOG" desc="Nenhum log operacional foi registrado para este chamado." />
  ) : (
    [...eventsList]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((event, i) => (
        <Entry key={event.id || i} kind="event" who={logType(event)} date={event.createdAt} tags={<span>por {actorOf(event)}</span>}>{noteOf(event)}</Entry>
      ))
  )

  const setChat = async (enabled: boolean) => {
    try {
      const updated = await ticketService.updateTicket(ticket.id, { chat_enabled: enabled })
      onTicketUpdate(ticket.id, updated)
      toast.success(enabled ? 'Chat em tempo real habilitado!' : 'Chat em tempo real desabilitado!')
    } catch (err) {
      console.error(err)
      toast.error(apiErrorMessage(err, 'Erro ao atualizar status do chat.'))
    }
  }
  const realtimeMessages = groupAttachmentMessages(messages.filter(m => m.type !== 'internal' && m.isRealtime)).messages
  const chatTab = (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', borderBottom: '1px solid var(--border)', fontSize: 14, color: 'var(--text-2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!ticket.chatEnabled} onChange={e => setChat(e.target.checked)} />
        Habilitar Chat: conversa instantânea com o colaborador
      </label>
      {/* Sem chat habilitado e sem histórico: convite. Com histórico, ele aparece mesmo com o chat desligado. */}
      {!ticket.chatEnabled && realtimeMessages.length === 0 ? (
        <EmptyState title="Chat em tempo real inativo" desc="O chat em tempo real permite interagir de forma instantânea com o colaborador. Habilite acima para iniciar." />
      ) : <>
        {!ticket.chatEnabled && <p className="notice">Chat em tempo real desabilitado — histórico abaixo (somente leitura).</p>}
        {realtimeMessages.map(msg => (
          <Entry key={msg.id} who={nameOf(msg)} date={msg.createdAt} tags={msg.type === 'email' && <span>E-mail</span>}>
            {msg.attachmentUrl && getFileTypeInfo(msg.attachmentUrl).isPdf ? <>
              {msg.text && <div>{linkify(msg.text)}</div>}
              <FileAttachmentChip name={getFileTypeInfo(msg.attachmentUrl).friendlyName} action="Abrir" onClick={() => openAttachment(msg.attachmentUrl!)} />
              <AttachmentChipList items={extrasOf(msg)} onOpenImage={a => setLightbox({ url: a.url, name: a.name })} onDownload={a => downloadAttachment(a.url, a.name)} />
            </> : messageBody(msg, linkify(msg.text))}
          </Entry>
        ))}
        <div ref={chatEndRef} />
      </>}
    </>
  )

  // Editor do chat em tempo real — só com o chat ativo. Admin é somente leitura.
  const chatEditor = ticket.chatEnabled && ticket.status !== 'closed' && !isAdminReadOnly && (
    <div className="td-reply">
      {selectedImage && (
        <div className="file-drop-item" style={{ marginBottom: 8 }}>
          {selectedImage.startsWith('data:image/') ? <img src={selectedImage} alt="" style={{ width: 56, height: 40, objectFit: 'cover' }} /> : <FileText size={20} />}
          <button type="button" className="icon-act danger" aria-label="Remover anexo" onClick={() => setSelectedImage(null)}><X size={14} /></button>
        </div>
      )}
      <input type="file" ref={fileInputRef} onChange={handleImageSelect} style={{ display: 'none' }} />
      <Txta value={compose} onChange={e => setCompose(e.target.value)} rows={2}
        placeholder="Mensagem rápida para o cliente..."
        maxLength={2000}
        showCount
        style={{ resize: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) send() }}
        {...fileDropPasteHandlers(fs => { const [f] = validFiles(fs); if (f) readChatFile(f) })} />
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <button type="button" className="icon-act" onClick={() => fileInputRef.current?.click()} title="Anexar arquivo" aria-label="Anexar arquivo"><Paperclip size={16} /></button>
        <MacroPicker up macros={macros} onPick={applyMacro} />
        <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-3)' }}>Ctrl+Enter para enviar · {PASTE_HINT}</span>
        <Btn size="sm" onClick={send} disabled={sending || !compose.trim()}>{sending ? '...' : 'Enviar'}</Btn>
      </div>
    </div>
  )

  // Trocar entre resposta e nota não apaga o que já foi escrito.
  const composing = replyModal ? 'reply' : internalNoteModal ? 'internal' : null
  const switchTo = (kind: 'reply' | 'internal') => { setReplyModal(kind === 'reply'); setInternalNoteModal(kind === 'internal') }
  const isReply = composing === 'reply'
  const composeFiles = isReply ? replyFiles : internalNoteFiles
  const addComposeFiles = isReply ? addReplyFiles : addInternalNoteFiles
  const setComposeFiles = isReply ? setReplyFiles : setInternalNoteFiles
  const composeText = isReply ? replyText : internalNoteText
  const nothing = !composeText.trim() && composeFiles.length === 0
  const extras = replyStatus !== ticket.status || replyPriority !== ticket.priority || replyQueue !== ticket.queue || replyCat.id !== ticket.categoryId || replyCat.subId !== ticket.subcategoryId
  const canSendAndResolve = isReply && canWrite && replyStatus === ticket.status && (isOwner || isCollaboratorOnly || !ticket.assignedToId)

  const replyEditor = (canWrite || composing) && (
    composing ? (
      <section className="td-reply td-compose" data-open data-kind={composing} aria-label={isReply ? 'Responder ao cliente' : 'Conversa interna (Nota)'}>
        <div className="td-compose-head">
          <div className="subtabs" role="group" aria-label="Quem lê">
            <button type="button" aria-pressed={isReply} onClick={() => switchTo('reply')}>Cliente</button>
            <button type="button" aria-pressed={!isReply} onClick={() => switchTo('internal')}>Interna</button>
          </div>
          {!isReply && <small>Só a equipe vê</small>}
          <span style={{ flex: 1 }} />
          {isReply && <MacroPicker up macros={macros} onPick={applyMacroToReply} />}
        </div>
        {isReply
          ? <Txta key="reply" autoFocus aria-label="Resposta ao cliente" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Escreva a resposta ao cliente…" rows={3} maxLength={5000} showCount={replyText.length > 4500} {...fileDropPasteHandlers(addReplyFiles)} />
          : <Txta key="note" autoFocus aria-label="Nota interna" value={internalNoteText} onChange={e => setInternalNoteText(e.target.value)} placeholder="Escreva a nota ou instrução para a equipe…" rows={3} maxLength={5000} showCount={internalNoteText.length > 4500} {...fileDropPasteHandlers(addInternalNoteFiles)} />}
        {composeFiles.length > 0 && (
          <div className="td-files">
            {composeFiles.map((f, i) => (
              <span key={i} title={f.name}>{f.name}<button type="button" className="icon-act danger" aria-label={`Remover ${f.name}`} onClick={() => setComposeFiles(prev => prev.filter((_, idx) => idx !== i))}><X size={13} /></button></span>
            ))}
          </div>
        )}
        {isReply && moreOpen && (
          <div className="td-more">
            <div className="td-reply-grid">
              <Field label="Atualizar status">
                {isFinished ? (
                  // A resposta reabre o próprio chamado em "Em atendimento" (addMessage no backend).
                  <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{STATUS_LABEL[ticket.status]} → reabre em Em atendimento</span>
                ) : (
                  <select value={replyStatus} onChange={e => setReplyStatus(e.target.value as any)}>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em atendimento</option>
                    <option value="pending">Pendente</option>
                  </select>
                )}
              </Field>
              <Field label="Atualizar prioridade">
                <select value={replyPriority} onChange={e => setReplyPriority(e.target.value as any)}>
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </Field>
              <Field label="Encaminhar para fila">
                <select value={replyQueue} onChange={e => setReplyQueue(e.target.value as any)}>
                  {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </Field>
              <Field label="Mudar categoria">
                <select value={`${replyCat.id}:${replyCat.subId}`} onChange={e => {
                  const [cid, sid] = e.target.value.split(':')
                  setReplyCat({ id: cid, subId: sid || '' })
                }}>
                  {selectableCategories.map(c => (
                    <optgroup key={c.id} label={c.name}>
                      <option value={`${c.id}:`}>{c.name} (Geral)</option>
                      {c.subcategories.map(s => (
                        <option key={s.id} value={`${c.id}:${s.id}`}>{s.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
            </div>
            {renderQueueDropWarning(replyQueue)}
            {replyStatus === 'pending' && renderPendingFields()}
          </div>
        )}
        <div className="td-reply-foot">
          <label className="icon-act" title={`Anexar (até 10 MB) · ${PASTE_HINT}`}>
            <Paperclip size={17} aria-hidden /><span className="sr-only">Anexar arquivos</span>
            <input type="file" multiple className="sr-only" onChange={e => { addComposeFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </label>
          {isReply && <Btn size="sm" variant="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>{extras ? 'Mudanças junto com a resposta' : 'Mudar algo junto'}</Btn>}
          <span style={{ flex: 1 }} />
          <Btn size="sm" variant="ghost" onClick={() => { setReplyModal(false); setInternalNoteModal(false) }}>Cancelar</Btn>
          {isReply ? <>
            <Btn size="sm" variant={canSendAndResolve ? 'secondary' : 'primary'} disabled={sending || nothing || !replyPendingValid} onClick={handleSendReply}>{sending ? 'Enviando…' : 'Enviar resposta'}</Btn>
            {canSendAndResolve && <Btn size="sm" disabled={sending || replyText.trim().length < 10} title={replyText.trim().length < 10 ? 'Conte em pelo menos 10 letras o que resolveu' : undefined} onClick={handleSendAndResolve}>Enviar e resolver</Btn>}
          </> : <Btn size="sm" disabled={sending || nothing} onClick={handleSendInternalNote}>{sending ? 'Salvando…' : 'Salvar nota'}</Btn>}
        </div>
      </section>
    ) : (
      <div className="td-reply td-reply-bar">
        <button type="button" className="td-reply-field" aria-label="Responder ao cliente" onClick={openReply}>Responder ao cliente…</button>
        <Btn variant="secondary" aria-label="Conversa interna" onClick={openInternalNote}>Nota interna</Btn>
      </div>
    )
  )

  const tabs: [id: string, label: string][] = [['timeline', 'Registro'], ['documents', 'Documentos'], ['logs', 'Logs'], ['chat', 'Chat ao vivo']]

  return (
    <div className="td" data-compact={isCompact || undefined}>
      <header className="td-head">
        <div className="td-head-top">
          <button type="button" className="td-back" onClick={onClose}><ArrowLeft size={15} />{backLabel}</button>
          <span>{ticket.displayNumber}</span>
        </div>
        <h1>{ticket.title}</h1>
        <div className="td-line">
          <StatusBadge status={ticket.is_reopened ? 'reopened' : ticket.status} />
          {isAiResolved(ticket) ? <AiResolvedBadge /> : !isFinished && <SLABadge deadline={ticket.slaDeadline} status={ticket.status} resolvedAt={ticket.resolved_at} forecastOverdue={!!ticket.project_forecast_alerted_at && ticket.pendingReason === 'pending_project'} />}
          <PriorityBadge priority={ticket.priority} />
          <span>{assignee?.name ?? 'Sem responsável'}</span>
          {org && <span>{org.name}</span>}
          {ticket.escalated && <span>Escalonado</span>}
          <IntakeFlag ticketId={ticket.id} status={ticket.intake_status} ticketStatus={ticket.status} canDismiss={can.aiActions} onDismissed={() => onTicketUpdate(ticket.id, { intake_status: 'dismissed' })} />
        </div>
        {isCompact && actions && <div style={{ marginTop: 14 }}>{actions}</div>}
      </header>

      <div className="td-body">
        {isCompact
          ? <details className="td-fold"><summary>Dados do chamado</summary>{facts}</details>
          : <aside className="td-facts">{facts}</aside>}
        <div className="td-main">
          <div className="td-tabs">
            <div className="subtabs" style={{ flexWrap: 'nowrap' }}>
              {tabs.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); if (id === 'timeline') onChatRead?.() }}>
                  {label}{id === 'chat' && unreadCount > 0 && <span className="chat-tab-unread">{unreadCount}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="td-scroll">
            {tab === 'timeline' ? timeline : tab === 'documents' ? documentsTab : tab === 'logs' ? logsTab : chatTab}
          </div>
          {tab === 'timeline' ? replyEditor : tab === 'chat' && chatEditor}
        </div>
      </div>

      <Modal isOpen={descriptionModal} onClose={() => setDescriptionModal(false)} title={ticket.special_data ? 'Dados do formulário' : 'Solicitação original'} width={640}>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {ticket.special_data
            ? Object.entries(ticket.special_data).map(([key, value]) => <div key={key} className="td-field"><small>{key.replace(/_/g, ' ')}</small>{value as string}</div>)
            : <><div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>{openingMeta}</div>{ticket.description}</>}
        </div>
      </Modal>

      <ForecastModal ticket={forecastOpen ? { id: ticket.id, number: ticket.displayNumber, title: ticket.title } : null} onClose={() => setForecastOpen(false)}
        onSaved={updated => { onTicketUpdate(ticket.id, updated); loadEvents() }} />

      {/* Modal Resolução */}
      <Modal isOpen={resolutionModal} onClose={() => setResolutionModal(false)} title="Resolução do caso"
        footer={<><Btn variant="ghost" onClick={() => setResolutionModal(false)}>Cancelar</Btn><Btn disabled={resolutionDetails.trim().length < 10} onClick={handleResolve}>Finalizar resolução</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Descreva detalhadamente o que foi realizado para resolver este chamado:</div>
          <Field label="Detalhamento da resolução (obrigatório)">
            <Txta value={resolutionDetails} onChange={e => setResolutionDetails(e.target.value)} placeholder="Ex: Realizada a troca da fonte de alimentação e testes de stress..." rows={6} style={{ fontSize: 13 }} maxLength={3000} showCount {...fileDropPasteHandlers(addResolutionFiles)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: resolutionDetails.length > 0 && resolutionDetails.trim().length < 10 ? 'var(--danger)' : 'var(--text-3)' }}>
              <span>{resolutionDetails.trim().length === 0 ? 'Campo obrigatório' : resolutionDetails.trim().length < 10 ? 'Mínimo de 10 caracteres obrigatório' : 'Descrição válida'}</span>
              <span>{resolutionDetails.trim().length} / mín. 10 caracteres</span>
            </div>
          </Field>
          <Field label="Anexar comprovantes / prints">
            <FileDrop id="res-files" hint={`Imagens ou documentos de comprovação · ${PASTE_HINT}`} files={files} onFiles={addResolutionFiles}
              onRemove={i => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
          </Field>
        </div>
      </Modal>

      {/* Modal Status */}
      <Modal isOpen={statusModal} onClose={() => setStatusModal(false)} title={ticket.status === 'closed' || ticket.status === 'resolved' ? 'Reabrir chamado' : 'Mudar status'}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setStatusModal(false)}>Cancelar</Btn>
            <Btn
              disabled={
                (!actionNote.trim() && (ticket.status === 'closed' || ticket.status === 'resolved')) ||
                (tempStatus === ticket.status && tempStatus !== 'pending') || savingReopenSla ||
                (tempStatus === 'pending' && !pendingFieldsValid)
              }
              onClick={async () => {
                setSavingReopenSla(true)
                try {
                  const labels = STATUS_LABEL
                  let ticketUpdates: Record<string, any> = { status: tempStatus }
                  if (tempStatus === 'pending') ticketUpdates = { ...ticketUpdates, ...(await buildPendingUpdates()) }
                  const statusLabel = (s: string, reason?: string | null) => s === 'pending' && reason ? `Pendente (${PENDING_REASON_LABELS[reason as TicketPendingReason]})` : (labels[s] || s)
                  await addInternalNote(`Status alterado de "${statusLabel(ticket.status, ticket.pendingReason)}" para "${statusLabel(tempStatus, tempPendingReason)}". Motivo: ${actionNote}`, ticketUpdates)
                  setStatusModal(false)
                  setTempPendingReason('')
                  setPendingEvidenceFile(null)
                  toast.success('Status do chamado atualizado!')
                } catch (err: any) {
                  toast.error('Erro ao alterar status: ' + (err.response?.data?.error || err.message))
                } finally {
                  setSavingReopenSla(false)
                }
              }}
            >
              {savingReopenSla ? 'Salvando...' : (ticket.status === 'closed' || ticket.status === 'resolved' ? 'Salvar e reabrir' : 'Salvar alteração')}
            </Btn>
          </>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {ticket.status === 'closed' || ticket.status === 'resolved'
              ? 'Selecione o novo status para reabrir este chamado:'
              : 'Selecione o novo status para este chamado:'}
          </div>
          <div className="choices">
            {(
              (ticket.status === 'closed' || ticket.status === 'resolved')
                ? ['open', 'in_progress'] as TicketStatus[]
                : ['open', 'in_progress', 'pending'] as TicketStatus[]
            ).map(v => (
              <div key={v} className="choice" data-on={tempStatus === v || undefined} onClick={() => setTempStatus(v)}><div>{STATUS_LABEL[v]}</div></div>
            ))}
          </div>
          {tempStatus === 'pending' ? renderPendingFields('Motivo da alteração (obrigatório)') : (
            <Field label="Motivo da alteração (obrigatório)">
              <Txta value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder={ticket.status === 'closed' || ticket.status === 'resolved' ? 'Descreva o motivo da reabertura...' : 'Descreva o motivo desta mudança...'} rows={3} style={{ fontSize: 13 }} maxLength={1000} showCount />
            </Field>
          )}
        </div>
      </Modal>

      {/* Modal Prioridade */}
      <ChoiceModal isOpen={priorityModal} onClose={() => setPriorityModal(false)} title="Alterar prioridade"
        intro="Selecione a nova prioridade e descreva o motivo:"
        options={[
          { value: 'low', label: 'Baixa', description: 'Impacto baixo, sem urgência.', trailing: <PriorityDot priority="low" /> },
          { value: 'medium', label: 'Média', description: 'Impacto moderado no trabalho do usuário.', trailing: <PriorityDot priority="medium" /> },
          { value: 'high', label: 'Alta', description: 'Problema crítico com alto impacto operacional.', trailing: <PriorityDot priority="high" /> },
        ]}
        value={tempPriority} onChange={v => setTempPriority(v as TicketPriority)} unchanged={tempPriority === ticket.priority}
        note={actionNote} onNote={setActionNote} notePlaceholder="Descreva o motivo desta mudança de prioridade..."
        onSave={async () => {
          try {
            const labels: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }
            await addInternalNote(`Prioridade alterada de "${labels[ticket.priority]}" para "${labels[tempPriority]}".${motivoSuffix}`, { priority: tempPriority })
            setPriorityModal(false)
          } catch { /* toast já exibido por addInternalNote */ }
        }} />

      {/* Modal Tipo */}
      <ChoiceModal isOpen={typeModal} onClose={() => setTypeModal(false)} title="Alterar tipo de chamado"
        intro="Selecione o novo tipo e descreva o motivo:"
        options={[
          { value: 'incident', label: 'Incidente', description: 'Algo quebrou, precisa restaurar o serviço.' },
          { value: 'request', label: 'Requisição', description: 'Pedido padrão (acesso, instalação, informação).' },
          { value: 'problem', label: 'Problema', description: 'Causa raiz por trás de incidentes recorrentes.' },
          { value: 'change', label: 'Mudança', description: 'Alteração planejada em sistema/infraestrutura.' },
        ].filter(o => enabledTypes.has(o.value) || o.value === ticket.type)}
        value={tempType} onChange={v => setTempType(v as TicketType)} unchanged={tempType === ticket.type}
        note={actionNote} onNote={setActionNote} notePlaceholder="Descreva o motivo desta mudança de tipo..."
        onSave={async () => {
          try {
            const labels: Record<string, string> = { incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança' }
            await addInternalNote(`Tipo alterado de "${labels[ticket.type]}" para "${labels[tempType]}".${motivoSuffix}`, { type: tempType })
            setTypeModal(false)
          } catch { /* toast já exibido por addInternalNote */ }
        }} />

      {/* Modal Fila */}
      <ChoiceModal isOpen={queueModal} onClose={() => setQueueModal(false)} title="Mudar fila"
        intro="Selecione a nova fila para este chamado:"
        options={queues.map(q => ({ value: q.id, label: q.name, description: q.description || undefined }))}
        value={tempQueue} onChange={v => setTempQueue(v as typeof tempQueue)} unchanged={tempQueue === ticket.queue}
        extra={renderQueueDropWarning(tempQueue)}
        note={actionNote} onNote={setActionNote} notePlaceholder="Descreva o motivo desta mudança..."
        onSave={async () => {
          try {
            const fromName = queues.find(q => q.id === ticket.queue)?.name || ticket.queue
            const toName   = queues.find(q => q.id === tempQueue)?.name || tempQueue
            await addInternalNote(`Fila alterada de "${fromName}" para "${toName}".${motivoSuffix}`, { queue: tempQueue })
            setQueueModal(false)
          } catch { /* toast já exibido por addInternalNote */ }
        }} />

      {/* Modal Atribuição */}
      <Modal isOpen={agentModal} onClose={() => { setAgentModal(false); setAgentSearch('') }} title="Trocar responsável"
        footer={<><Btn variant="ghost" onClick={() => { setAgentModal(false); setAgentSearch('') }}>Cancelar</Btn><Btn disabled={tempAgent === (ticket.assignedToId ?? '')} onClick={async () => {
          try {
            const agentName = tempAgent ? (users.find(u => u.id === tempAgent)?.name ?? 'Desconhecido') : 'Não atribuído'
            const prevName  = ticket.assignedToId ? (users.find(u => u.id === ticket.assignedToId)?.name ?? 'Desconhecido') : 'Não atribuído'
            await addInternalNote(`Atribuição alterada de "${prevName}" para "${agentName}".${motivoSuffix}`, { assigned_to_id: tempAgent || null })
            setAgentModal(false)
            setAgentSearch('')
          } catch { /* toast já exibido por addInternalNote */ }
        }}>Salvar alteração</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Quem fica com este chamado. Os mais livres vêm primeiro.</div>
          <FilterSearchInput value={agentSearch} onChange={setAgentSearch} placeholder="Buscar analista por nome..." width="auto" />
          <div className="choices" style={{ maxHeight: 300 }}>
            {(!agentSearch.trim() || 'não atribuído'.includes(agentSearch.toLowerCase()) || 'nao atribuido'.includes(agentSearch.toLowerCase())) && (
              <div className="choice" data-on={tempAgent === '' || undefined} onClick={() => setTempAgent('')}><div>Não atribuído</div></div>
            )}
            {agents
              .filter(a => {
                if (!agentSearch.trim()) return true
                const normA = a.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                const normQ = agentSearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                return normA.includes(normQ)
              })
              .sort((a, b) => (loads[a.id] ?? 0) - (loads[b.id] ?? 0))
              .map(a => (
              <div key={a.id} className="choice" data-on={tempAgent === a.id || undefined} onClick={() => setTempAgent(a.id)}>
                <div>{a.name}{a.id === currentUser.id && ' (você)'}<small>{ROLE_LABEL[a.role] ?? a.role}{ticket.queue && a.role === 'agent' && !(a.queues ?? []).includes(ticket.queue) ? ', não atende esta fila' : ''}</small></div>
                <small>{loads[a.id] ? `${loads[a.id]} ${loads[a.id] === 1 ? 'ativo' : 'ativos'}` : 'livre'}</small>
              </div>
            ))}
          </div>
          <Field label="Motivo da alteração (opcional)">
            <Txta value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Descreva o motivo desta atribuição..." rows={3} style={{ fontSize: 13 }} maxLength={1000} showCount />
          </Field>
        </div>
      </Modal>

      {taskLinkModal === 'create' && (
        <CreateTaskFromTicketModal ticket={ticket} onClose={() => setTaskLinkModal(null)}
          onCreated={async () => { setTaskLinkModal(null); onTicketUpdate(ticket.id, await ticketService.getTicket(ticket.id)) }} />
      )}
      {taskLinkModal === 'link' && (
        <LinkTicketToTaskModal ticketId={ticket.id} onClose={() => setTaskLinkModal(null)}
          onLinked={async () => { setTaskLinkModal(null); onTicketUpdate(ticket.id, await ticketService.getTicket(ticket.id)) }} />
      )}

      {/* Modal Trocar requisitante */}
      <Modal isOpen={requesterModal} onClose={() => { setRequesterModal(false); setRequesterSearch('') }} title="Trocar requisitante"
        footer={<><Btn variant="ghost" onClick={() => { setRequesterModal(false); setRequesterSearch('') }}>Cancelar</Btn><Btn disabled={!tempRequester || tempRequester === ticket.userId} onClick={async () => {
          try {
            const oldName = requester?.name ?? 'Desconhecido'
            const newName = requesterCandidates.find(u => u.id === tempRequester)?.name ?? 'Desconhecido'
            await addInternalNote(`Requisitante alterado de "${oldName}" para "${newName}".${motivoSuffix}`, { requesterId: tempRequester })
            setRequesterModal(false)
            setRequesterSearch('')
          } catch { /* toast já exibido por addInternalNote */ }
        }}>Salvar alteração</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Selecione o novo requisitante deste chamado. A empresa do chamado será atualizada para a empresa do novo requisitante.</div>
          <FilterSearchInput value={requesterSearch} onChange={setRequesterSearch} placeholder="Buscar requisitante por nome ou e-mail..." width="auto" />
          <div className="choices" style={{ maxHeight: 300 }}>
            {requesterCandidates
              .filter(u => {
                if (!requesterSearch.trim()) return true
                const normName = u.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                const normEmail = (u.email || '').toLowerCase()
                const normQ = requesterSearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                return normName.includes(normQ) || normEmail.includes(normQ)
              })
              .map(u => (
              <div key={u.id} className="choice" data-on={tempRequester === u.id || undefined} onClick={() => setTempRequester(u.id)}>
                <div>{u.name}<small>{u.email}</small></div>
                {u.id === ticket.userId && <small>Atual</small>}
              </div>
            ))}
          </div>
          <Field label="Motivo da alteração (opcional)">
            <Txta value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Descreva o motivo desta troca de requisitante..." rows={3} style={{ fontSize: 13 }} />
          </Field>
        </div>
      </Modal>

      {/* Modal Categoria */}
      <Modal isOpen={catModal} onClose={() => setCatModal(false)} title="Mudar categoria" width={560}
        footer={<><Btn variant="ghost" onClick={() => setCatModal(false)}>Cancelar</Btn><Btn disabled={(tempCat.id === ticket.categoryId && tempCat.subId === ticket.subcategoryId)} onClick={async () => {
          try {
            const catName = categories.find(c => c.id === tempCat.id)?.name || tempCat.id
            const subName = tempCat.subId ? categories.find(c => c.id === tempCat.id)?.subcategories.find(s => s.id === tempCat.subId)?.name : null
            const label   = subName ? `${catName} > ${subName}` : catName
            await addInternalNote(`Categoria alterada para "${label}".${motivoSuffix}`, { categoryId: tempCat.id, subcategoryId: tempCat.subId })
            setCatModal(false)
          } catch { /* toast já exibido por addInternalNote */ }
        }}>Salvar alteração</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <Field label="Categoria principal">
              <div className="choices">
                {selectableCategories.map(c => (
                  <button key={c.id} type="button" className="choice" data-on={tempCat.id === c.id || undefined} onClick={() => setTempCat({ id: c.id, subId: '' })}>{c.name}</button>
                ))}
              </div>
            </Field>
            <Field label="Subcategoria">
              <div className="choices">
                {categories.find(c => c.id === tempCat.id)?.subcategories.map(s => (
                  <button key={s.id} type="button" className="choice" data-on={tempCat.subId === s.id || undefined} onClick={() => setTempCat({ ...tempCat, subId: s.id })}>{s.name}</button>
                ))}
              </div>
              {!tempCat.id
                ? <small style={{ color: 'var(--text-3)' }}>Selecione uma categoria principal</small>
                : categories.find(c => c.id === tempCat.id)?.subcategories.length === 0 && <small style={{ color: 'var(--text-3)' }}>Nenhuma subcategoria disponível</small>}
            </Field>
          </div>
          <Field label="Motivo da alteração (opcional)">
            <Txta value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Descreva o motivo desta mudança..." rows={3} style={{ fontSize: 13 }} maxLength={1000} showCount />
          </Field>
        </div>
      </Modal>

      {/* Modal Escalonamento */}
      <Modal isOpen={escalateModal} onClose={() => setEscalateModal(false)} title="Escalonar chamado" width={540}
        footer={<><Btn variant="ghost" onClick={() => setEscalateModal(false)}>Cancelar</Btn><Btn disabled={escalateDisabled} onClick={handleEscalate}>{escalating ? '...' : 'Confirmar escalonamento'}</Btn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {applicableRules.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 14 }}>
              {escalationRules.length === 0
                ? 'Nenhuma regra de escalonamento ativa configurada. Solicite ao administrador que configure as regras.'
                : 'Nenhuma regra de escalonamento vale para a fila deste chamado.'}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Selecione como deseja escalonar este chamado:</div>
              <div role="radiogroup" aria-label="Regra de escalonamento" className="choices">
                {applicableRules.map((rule: any) => {
                  const on = selectedRuleId === rule.id
                  const meta = TYPE_META[rule.type as keyof typeof TYPE_META]
                  return (
                    <div key={rule.id} role="radio" aria-checked={on} tabIndex={0} data-testid={`escalate-rule-${rule.id}`}
                      onClick={() => { setSelectedRuleId(rule.id); setSelectedAgentId('') }}
                      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelectedRuleId(rule.id); setSelectedAgentId('') } }}
                      className="choice" data-on={on || undefined}>
                      <div>
                        {rule.name}{meta && ` (${meta.label})`}
                        <small>
                          {describeRule({ target_mode: rule.target_mode ?? (rule.type === 'same_ticket' && !rule.target_queue_id ? 'agent_pick' : 'queue'), ...rule }, queues, users, categories)}
                          {rule.require_note ? ' · exige justificativa' : ''}
                        </small>
                      </div>
                    </div>
                  )
                })}
              </div>

              {needsAgentPick && (
                <Field label={selectedRule?.type === 'same_ticket' ? 'Analista que vai atuar junto (colaborador)' : selectedRule?.type === 'child_ticket' ? 'Analista responsável pelo chamado filho' : 'Analista que vai receber o chamado'} required>
                  <SearchableSelect
                    value={selectedAgentId}
                    onChange={v => setSelectedAgentId(v)}
                    aria-label="Analista de destino"
                    placeholder="Selecione um analista..."
                    searchPlaceholder="Buscar analista..."
                    options={[
                      { value: '', label: 'Selecione um analista...' },
                      ...users
                        .filter(u => ['agent', 'supervisor', 'manager'].includes(u.role) && u.active !== false && u.id !== currentUser.id
                          && !(selectedRule?.type !== 'child_ticket' && u.id === ticket.assignedToId))
                        .map(u => ({ value: u.id, label: u.name })),
                    ]}
                  />
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>O analista passa a acessar o chamado pelo escalonamento, mesmo sem a empresa na carteira.</div>
                </Field>
              )}

              {selectedRule && (
                <Field label={needsNote ? 'Justificativa' : 'Justificativa (opcional)'} required={needsNote}>
                  <Txta value={escalationNote} onChange={e => setEscalationNote(e.target.value)} rows={3} maxLength={2000} showCount aria-label="Justificativa do escalonamento"
                    placeholder={selectedRule.type === 'child_ticket' ? 'O que a outra equipe precisa fazer no chamado filho?' : 'Por que este chamado está sendo escalonado?'} />
                </Field>
              )}
            </>
          )}
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
            style={{ fontSize: 13 }} 
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
