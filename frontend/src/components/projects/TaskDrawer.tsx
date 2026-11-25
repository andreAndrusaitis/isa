import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { MarkdownEditor } from './MarkdownEditor'
import { ArrowUpRight, Pencil, Trash2, X } from 'lucide-react'
import { animate } from 'animejs'
import { prefersReducedMotion } from '@/lib/motion'
import { useBackdropClose } from '@/components/ui/Modal'
import { listTaskActivity, type TaskActivityEvent } from '@/services/drillService'
import { ActivityLine, DayDivider, buildFeed, timeOf } from '@/components/projects/TaskTimeline'
import { SegmentedToggle } from '@/components/projects/insights/SegmentedToggle'
import { ChecklistItem, ProjectStatus, Tag, Task, TaskComment, TaskDetail, TaskPriority, TaskType, Sprint } from '@/types/projects'
import {
  getTask, updateTask, createTask,
  listChecklist, createChecklistItem, toggleChecklistItem, deleteChecklistItem,
  listComments, createComment, editComment, deleteComment,
  addTagToTask, removeTagFromTask,
  linkTaskDocument, unlinkTaskDocument,
  listTaskAssignees, setTaskAssignees,
} from '@/services/tasksService'
import {
  listMembers, listTags, createTag, listProjectDocuments, listAttachments, uploadAttachment, listProjectStatuses,
  listTaskTypes, listSprints, listWatchers, addWatcher, removeWatcher,
  ProjectDocumentSummary, ProjectAttachment,
} from '@/services/projectsService'
import { downloadAttachment, filterValidAttachments, fileDropPasteHandlers, ATTACHMENT_ACCEPT } from '@/utils/attachments'
import { Btn, Sel, ColorDot, ConfirmModal, Loading, Meter, PriorityDot, Toggle } from '@/components/ui'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { apiErrorMessage } from '@/services/api'
import { ProjectMemberWithUser } from '@/types/projects'
import { TaskTicketsSection } from './TaskTicketsSection'
import { TagChip, TagPicker } from './TagPicker'
import { useAuthStore } from '@/store/auth'
import { TaskTimeSection } from './time/TaskTimeSection'
import { useProjectRole } from './projectRole'
import { toast } from '@/store/toastStore'
import { PRIORITY_STEP } from '@/components/projects/priority'
import { taskLabel } from '@/components/projects/taskKey'
import { StatusPill } from './StatusPill'
import { CreateTaskModal } from './CreateTaskModal'
import { daysFromToday, relativeDay } from './relativeDay'
import './projects.css'

interface TaskDrawerProps {
  projectId: string
  taskId: string
  onClose: () => void
  /** Cada edição salva — a lista/Kanban atrás do drawer não pode depender só do socket. */
  onTaskChange?: (changes: Partial<TaskDetail> & { id: string }) => void
  /** Abre outra task no mesmo drawer (subtarefa <-> task-mãe). */
  onOpenTask?: (taskId: string) => void
  /** Aberto fora da página do projeto: atalho para ir até ela. */
  onOpenProject?: () => void
  projectName?: string
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade',
}

const STORY_POINTS_OPTIONS = [1, 2, 3, 5, 8, 13, 21]


const DOCUMENT_DRAG_MIME = 'application/x-isa-document-id'

/** Propriedade: rótulo à esquerda, valor editável à direita. */
function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tk-prop"><span>{label}</span><div>{children}</div></div>
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Folha da task, encostada à direita: título no alto, propriedades numa coluna
 * estreita à esquerda e, à direita, descrição, listas e a conversa em ordem de
 * tempo, com o campo de comentário fixo no pé. Abaixo de 900px vira uma coluna só.
 */
const renderMarkdown = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string)

export function TaskDrawer({ projectId, taskId, onClose, onTaskChange, onOpenTask, onOpenProject, projectName }: TaskDrawerProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Quem fecha ou troca de task com a descrição aberta não perde o que digitou.
  const flushDescription = useRef(() => {})
  const closeDrawer = useCallback(() => { flushDescription.current(); onClose() }, [onClose])
  const openOtherTask = (id: string) => { flushDescription.current(); onOpenTask?.(id) }
  const backdropClose = useBackdropClose(closeDrawer)

  const [task, setTask] = useState<TaskDetail | null>(null)
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([])
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  // Todos os responsáveis; o primeiro é o principal (= task.assigneeId).
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const me = useAuthStore((s) => s.user)
  const { canEdit, canConfigure } = useProjectRole()
  const [projectTags, setProjectTags] = useState<Tag[]>([])
  const [projectDocs, setProjectDocs] = useState<ProjectDocumentSummary[]>([])
  const [taskAttachments, setTaskAttachments] = useState<ProjectAttachment[]>([])
  const [loading, setLoading] = useState(true)

  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [subtaskModalOpen, setSubtaskModalOpen] = useState(false)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [events, setEvents] = useState<TaskActivityEvent[]>([])
  const [feedFilter, setFeedFilter] = useState<'all' | 'comments' | 'history'>('all')
  const feedRef = useRef<HTMLDivElement>(null)
  const [newComment, setNewComment] = useState('')
  const [pendingCommentFiles, setPendingCommentFiles] = useState<File[]>([])
  const [isDraggingOverComment, setIsDraggingOverComment] = useState(false)
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null)
  const [commentToDelete, setCommentToDelete] = useState<TaskComment | null>(null)

  const [descEditing, setDescEditing] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [descHeight, setDescHeight] = useState(200)
  const descViewRef = useRef<HTMLDivElement>(null)
  const [docPickerOpen, setDocPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Previne scroll da página de fundo enquanto o popup está aberto
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'auto' }
  }, [])

  // Fechamento com tecla Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) closeDrawer() // popover interno (ex.: tags) já tratou o Esc
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDrawer])

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (backdropRef.current) animate(backdropRef.current, { opacity: [0, 1], duration: 180, ease: 'outQuad' })
    if (panelRef.current) animate(panelRef.current, { opacity: [0, 1], translateX: [28, 0], duration: 180, ease: 'outQuad' })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getTask(projectId, taskId),
      listChecklist(projectId, taskId),
      listComments(projectId, taskId),
      listMembers(projectId),
      listTags(projectId),
      listProjectDocuments(projectId).catch(() => []),
      listAttachments(projectId, undefined, taskId).catch(() => []),
    ]).then(([t, c, cm, mem, tags, docs, attachments]) => {
      if (cancelled) return
      setTask(t)
      setDescDraft(t.description ?? '')
      setChecklist(c)
      setComments(cm)
      setMembers(mem)
      setProjectTags(tags)
      setProjectDocs(docs)
      const commentIds = new Set(cm.map((c) => c.id))
      setTaskAttachments(attachments.filter((a) =>
        (a.entityType === 'task' && a.entityId === taskId) ||
        (a.entityType === 'comment' && commentIds.has(a.entityId)),
      ))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, taskId])

  useEffect(() => {
    listTaskAssignees(projectId, taskId).then(setAssigneeIds).catch(() => setAssigneeIds([]))
  }, [projectId, taskId])

  // Histórico: recarrega depois de cada mudança feita aqui no drawer.
  useEffect(() => {
    if (!task) return
    let alive = true
    listTaskActivity(projectId, taskId).then((list) => { if (alive) setEvents(list) }).catch(() => {})
    return () => { alive = false }
  }, [projectId, taskId, task, checklist, assigneeIds, taskAttachments])

  const feed = useMemo(
    () => buildFeed(feedFilter === 'history' ? [] : comments, feedFilter === 'comments' ? [] : events),
    [comments, events, feedFilter],
  )
  const feedCount = feed.filter((i) => i.kind !== 'day').length

  // O mais recente fica embaixo, junto do campo de comentário.
  const showNewest = () => setTimeout(() => feedRef.current?.lastElementChild?.scrollIntoView?.({ block: 'end' }))

  // Visualizador: o drawer inteiro fica desabilitado, mas ele pode seguir a task
  // (o backend aceita watcher de qualquer membro, inclusive viewer).
  const [following, setFollowing] = useState<boolean | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  useEffect(() => {
    setFollowing(null)
    if (canEdit || !me) return
    let cancelled = false
    listWatchers(projectId, taskId)
      .then((ws) => { if (!cancelled) setFollowing(ws.some((w) => w.userId === me.id)) })
      .catch(() => { if (!cancelled) setFollowing(false) })
    return () => { cancelled = true }
  }, [projectId, taskId, canEdit, me?.id])

  async function toggleFollow() {
    if (!me || following === null || followBusy) return
    setFollowBusy(true)
    try {
      if (following) await removeWatcher(projectId, taskId, me.id)
      else await addWatcher(projectId, taskId)
      setFollowing(!following)
    } catch (err) {
      toast.error(apiErrorMessage(err, following ? 'Não foi possível deixar de seguir a task.' : 'Não foi possível seguir a task.'))
    } finally {
      setFollowBusy(false)
    }
  }

  // Principal primeiro: é ele que Kanban/Lista mostram e que o backend grava em assigneeId.
  const selectedAssigneeIds = task?.assigneeId ? [task.assigneeId, ...assigneeIds.filter((id) => id !== task.assigneeId)] : assigneeIds

  /** Um campo só: o primeiro marcado vira o principal; o tempo da task conta para todos. */
  async function changeAssignees(next: string[]) {
    const previous = { ids: assigneeIds, primary: task?.assigneeId ?? null }
    const primary = next[0] ?? null
    setAssigneeIds(next)
    setTask((prev) => (prev ? { ...prev, assigneeId: primary } : prev))
    try {
      const saved = await setTaskAssignees(projectId, taskId, next)
      setAssigneeIds(saved)
      // multiAssignees: é dele que Lista/Kanban tiram as fotos de todos os responsáveis.
      const multiAssignees = saved.flatMap((userId) => {
        const m = members.find((x) => x.userId === userId)
        return m ? [{ taskId, userId, user: m.user }] : []
      })
      onTaskChange?.({ id: taskId, assigneeId: primary, multiAssignees })
    } catch (err) {
      setAssigneeIds(previous.ids)
      setTask((prev) => (prev ? { ...prev, assigneeId: previous.primary } : prev))
      toast.error(apiErrorMessage(err, 'Não foi possível alterar os responsáveis.'))
    }
  }

  useEffect(() => {
    listProjectStatuses(projectId).then(setStatuses)
    listTaskTypes(projectId).then(setTaskTypes).catch(() => setTaskTypes([]))
    listSprints(projectId).then(setSprints).catch(() => setSprints([]))
  }, [projectId])

  async function patchTask(changes: Partial<{
    title: string
    description: string | null
    statusId: string
    taskTypeId: string | null
    sprintId: string | null
    storyPoints: number | null
    priority: TaskPriority
    assigneeId: string | null
    startDate: string | null
    dueDate: string | null
    isMilestone: boolean
  }>) {
    const previous = task
    setTask((prev) => (prev ? { ...prev, ...changes } : prev))
    try {
      const updated = await updateTask(projectId, taskId, changes)
      setTask((prev) => (prev ? { ...prev, ...updated } : prev))
      onTaskChange?.({ ...changes, ...updated, id: taskId })
    } catch (err) {
      setTask(previous)
      throw err
    }
  }

  async function handleTitleBlur(newTitle: string) {
    if (!task || newTitle === task.title || !newTitle.trim()) return
    await patchTask({ title: newTitle.trim() })
  }

  function startDescriptionEdit() {
    // O campo abre com a altura do texto em leitura, para a área não encolher.
    setDescHeight(Math.max(200, descViewRef.current?.offsetHeight ?? 0))
    setDescDraft(task?.description ?? '')
    setDescEditing(true)
  }

  function cancelDescriptionEdit() {
    setDescDraft(task?.description ?? '')
    setDescEditing(false)
  }

  function saveDescription() {
    setDescEditing(false)
    if (!task || descDraft === (task.description ?? '')) return
    patchTask({ description: descDraft || null })
  }

  async function handleAddSubtask() {
    const title = newSubtaskTitle.trim()
    const statusId = (statuses.find((s) => s.category === 'open') ?? statuses[0])?.id
    if (!task || !title || !statusId) return
    try {
      // Herda a lista da task-mãe: filtros por lista continuam achando a subtarefa.
      addSubtask(await createTask(projectId, { title, statusId, parentId: task.id, listId: task.listId }))
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível criar a subtarefa.'))
    }
  }

  function addSubtask(created: Task) {
    setNewSubtaskTitle('')
    setTask((prev) => (prev ? { ...prev, subtasks: [...(prev.subtasks ?? []), created] } : prev))
  }

  async function handleToggleItem(item: ChecklistItem) {
    const updated = await toggleChecklistItem(projectId, taskId, item.id, !item.done)
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
  }

  async function handleDeleteItem(itemId: string) {
    await deleteChecklistItem(projectId, taskId, itemId)
    setChecklist((prev) => prev.filter((i) => i.id !== itemId))
  }

  async function handleAddItem() {
    if (!newItemText.trim()) return
    const created = await createChecklistItem(projectId, taskId, newItemText.trim())
    setChecklist((prev) => [...prev, created])
    setNewItemText('')
  }

  async function handleAddComment() {
    if (!newComment.trim() && pendingCommentFiles.length === 0) return
    const created = await createComment(projectId, taskId, newComment.trim() || '(anexo)')
    setComments((prev) => [...prev, created])
    setNewComment('')
    showNewest()

    if (pendingCommentFiles.length > 0) {
      const filesToUpload = pendingCommentFiles
      setPendingCommentFiles([])
      for (const file of filesToUpload) {
        try {
          const dataUri = await fileToDataUri(file)
          const attachment = await uploadAttachment(projectId, {
            entityType: 'comment', entityId: created.id, fileName: file.name, dataUri,
          })
          setTaskAttachments((prev) => [attachment, ...prev])
        } catch {
          toast.error(`Falha ao anexar "${file.name}" ao comentário.`)
        }
      }
    }
  }

  async function handleSaveCommentEdit() {
    if (!editingComment || !editingComment.body.trim()) return
    try {
      const updated = await editComment(projectId, taskId, editingComment.id, editingComment.body.trim())
      setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setEditingComment(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível editar o comentário.'))
    }
  }

  async function handleDeleteComment(comment: TaskComment) {
    try {
      await deleteComment(projectId, taskId, comment.id)
      setComments((prev) => prev.filter((c) => c.id !== comment.id))
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível excluir o comentário.'))
    }
  }

  function handleCommentFilesSelected(files: FileList | File[] | null) {
    if (!files) return
    const valid = filterValidAttachments(Array.from(files), (msg) => toast.error(msg))
    if (valid.length > 0) setPendingCommentFiles((prev) => [...prev, ...valid])
  }

  function removePendingCommentFile(index: number) {
    setPendingCommentFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleAddTag(tagId: string) {
    if (!tagId || !task) return
    await addTagToTask(projectId, taskId, tagId)
    const tag = projectTags.find((t) => t.id === tagId)
    if (tag) setTask((prev) => (prev ? { ...prev, tags: [...prev.tags, { taskId, tagId, tag }] } : prev))
  }

  async function handleCreateTag(name: string, color: string) {
    const trimmed = name.trim()
    if (!trimmed || !task) return
    const tag = await createTag(projectId, { name: trimmed, color })
    setProjectTags((prev) => [...prev, tag])
    await addTagToTask(projectId, taskId, tag.id)
    setTask((prev) => (prev ? { ...prev, tags: [...prev.tags, { taskId, tagId: tag.id, tag }] } : prev))
  }

  async function handleRemoveTag(tagId: string) {
    await removeTagFromTask(projectId, taskId, tagId)
    setTask((prev) => (prev ? { ...prev, tags: prev.tags.filter((t) => t.tagId !== tagId) } : prev))
  }

  async function handleLinkDoc(documentId: string) {
    if (!documentId || !task) return
    await linkTaskDocument(projectId, taskId, documentId)
    const doc = projectDocs.find((d) => d.id === documentId)
    if (doc) setTask((prev) => (prev ? { ...prev, documents: [...prev.documents, { taskId, documentId, document: doc }] } : prev))
    setDocPickerOpen(false)
  }

  async function handleDropDocument(documentId: string) {
    const doc = projectDocs.find((d) => d.id === documentId)
    if (!doc || !task) return
    if (!task.documents.some((td) => td.documentId === documentId)) {
      await linkTaskDocument(projectId, taskId, documentId)
      setTask((prev) => (prev ? { ...prev, documents: [...prev.documents, { taskId, documentId, document: doc }] } : prev))
    }
    setNewComment((prev) => (prev ? `${prev} ${doc.title}` : doc.title))
  }

  async function handleUnlinkDoc(documentId: string) {
    await unlinkTaskDocument(projectId, taskId, documentId)
    setTask((prev) => (prev ? { ...prev, documents: prev.documents.filter((d) => d.documentId !== documentId) } : prev))
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const valid = filterValidAttachments(Array.from(files), (msg) => toast.error(msg))
    if (valid.length === 0) return
    setUploading(true)
    try {
      for (const file of valid) {
        const dataUri = await fileToDataUri(file)
        const attachment = await uploadAttachment(projectId, { entityType: 'task', entityId: taskId, fileName: file.name, dataUri })
        setTaskAttachments((prev) => [attachment, ...prev])
      }
    } finally {
      setUploading(false)
    }
  }

  function handleCopyLink() {
    // Sempre o endereço da task no projeto: o drawer pode estar aberto sobre outra tela.
    navigator.clipboard?.writeText(`${window.location.origin}/projetos/${projectId}/tasks?task=${taskId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const availableDocs = useMemo(
    () => projectDocs.filter((d) => !task?.documents.some((td) => td.documentId === d.id)),
    [projectDocs, task],
  )
  // breaks: um Enter já quebra a linha (quem escreve não pensa em Markdown). Sanitiza: a descrição é texto de qualquer membro.
  flushDescription.current = () => { if (descEditing) saveDescription() }
  const descriptionHtml = useMemo(() => (task?.description ? renderMarkdown(task.description) : ''), [task?.description])
  const attachmentsByComment = useMemo(() => {
    const map = new Map<string, ProjectAttachment[]>()
    for (const att of taskAttachments) {
      if (att.entityType !== 'comment') continue
      const list = map.get(att.entityId) ?? []
      list.push(att)
      map.set(att.entityId, list)
    }
    return map
  }, [taskAttachments])

  const currentStatus = useMemo(() => statuses.find((s) => s.id === task?.statusId), [statuses, task?.statusId])

  const subtasks = task?.subtasks ?? []
  const subtasksDone = subtasks.filter((sub) => ['done', 'cancelled'].includes(statuses.find((st) => st.id === sub.statusId)?.category ?? '')).length
  const checklistTotal = checklist.length
  const checklistDone = checklist.filter((i) => i.done).length
  const checklistPercent = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  const isOverdue = useMemo(() => {
    if (!task?.dueDate) return false
    if (currentStatus?.category === 'done') return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return new Date(task.dueDate) < today
  }, [task?.dueDate, currentStatus?.category])

  // Ao lado da data: atraso em dias, ou o relativo ("Amanhã", "em 3 dias") só quando está perto.
  const dueHint = useMemo(() => {
    if (!task?.dueDate) return null
    const diff = daysFromToday(task.dueDate)
    if (isOverdue) return `Atrasada há ${-diff} ${diff === -1 ? 'dia' : 'dias'}`
    return diff >= 0 && diff < 7 ? relativeDay(task.dueDate) : null
  }, [task?.dueDate, isOverdue])

  return (
    <div ref={backdropRef} className="tk-scrim" {...backdropClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={task ? `Task ${taskLabel(task)}: ${task.title}` : 'Detalhes da task'}
        onClick={(e) => e.stopPropagation()}
        className="tk-sheet"
      >
        <div className="tk-top">
          <span>{task ? taskLabel(task) : '...'}</span>
          {onOpenProject && (
            <button
              type="button"
              className="pj-link"
              onClick={() => { flushDescription.current(); onOpenProject() }}
              title="Abrir na página do projeto"
              aria-label={projectName ? `Abrir no projeto ${projectName}` : 'Abrir na página do projeto'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: 280 }}
            >
              <span className="pj-cut">{projectName || 'Abrir no projeto'}</span>
              <ArrowUpRight size={14} style={{ flexShrink: 0 }} aria-hidden />
            </button>
          )}
          <button type="button" className="pj-link" onClick={handleCopyLink} title="Copiar link da tarefa" aria-label={copied ? 'Link copiado' : 'Copiar link da tarefa'} style={{ marginLeft: 'auto' }}>
            {copied ? 'Copiado!' : 'Copiar link'}
          </button>
          <button type="button" className="icon-act" onClick={closeDrawer} title="Fechar (Esc)">
            <X size={18} />
          </button>
        </div>

        {loading && (
          <Loading label="Carregando detalhes da tarefa…" />
        )}

        {!loading && task && (
          // Visualizador: o fieldset desabilita todos os campos e botões (downloads são links).
          <fieldset disabled={!canEdit} className="tk-form">
            <div className="tk-head">
              {task.parent && (
                <button type="button" className="pj-link" onClick={() => openOtherTask(task.parent!.id)} disabled={!onOpenTask} style={{ overflowWrap: 'anywhere' }}>
                  Subtarefa de {taskLabel(task.parent)} {task.parent.title}
                </button>
              )}
              {/* textarea: título longo quebra em linhas em vez de sumir à direita.
                  key: o drawer troca de task (subtarefa <-> mãe) sem remontar; defaultValue não acompanharia. */}
              <textarea
                key={task.id}
                className="tk-title"
                defaultValue={task.title}
                rows={1}
                aria-label="Título da task"
                onBlur={(e) => handleTitleBlur(e.target.value.replace(/\s*\n\s*/g, ' '))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                placeholder="Nome da tarefa"
              />
            </div>

            <div className="tk-body">
              <div className="tk-side">
                <section className="tk-sec" aria-label="Propriedades">
                  <PropRow label="Status">
                    {currentStatus
                      ? <StatusPill status={currentStatus} statuses={statuses} onChange={(statusId) => patchTask({ statusId })} />
                      : <Sel className="tk-field" value={task.statusId} onChange={(e: any) => patchTask({ statusId: e.target.value })} aria-label="Status">
                          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </Sel>}
                  </PropRow>

                  <PropRow label="Responsáveis">
                    <SearchableSelect
                      multiple compact exclusive={[]}
                      value={selectedAssigneeIds.join(',')}
                      onChange={(csv) => changeAssignees(csv ? csv.split(',') : [])}
                      options={members.map((m) => ({ value: m.userId, label: m.user.name, sublabel: m.userId === task.assigneeId ? 'Principal' : undefined }))}
                      placeholder="Sem responsável"
                      searchPlaceholder="Buscar membro..."
                      aria-label="Responsáveis"
                      style={{ padding: 0, borderBottom: 0, background: 'none', fontSize: 13.5 }}
                    />
                  </PropRow>

                  <PropRow label="Prazo">
                    <input
                      type="date"
                      className="tk-field"
                      aria-label="Prazo"
                      value={toDateInputValue(task.dueDate)}
                      onChange={(e) => patchTask({ dueDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })}
                      style={isOverdue ? { color: 'var(--danger)' } : undefined}
                    />
                    {dueHint && <small style={isOverdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{dueHint}</small>}
                  </PropRow>

                  <PropRow label="Início">
                    <input
                      type="date"
                      className="tk-field"
                      aria-label="Início"
                      value={toDateInputValue(task.startDate)}
                      onChange={(e) => patchTask({ startDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })}
                    />
                  </PropRow>

                  <PropRow label="Prioridade">
                    <span style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {task.priority !== 'none' && <PriorityDot priority={PRIORITY_STEP[task.priority]} />}
                      <Sel className="tk-field" value={task.priority} onChange={(e: any) => patchTask({ priority: e.target.value as TaskPriority })} aria-label="Prioridade">
                        {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Sel>
                    </span>
                  </PropRow>

                  <PropRow label="Tipo">
                    {/* Trocar o tipo troca o ID (BUG-3 → FEAT-8): o número vem do tipo novo. */}
                    <Sel className="tk-field" value={task.taskTypeId ?? ''} onChange={(e: any) => { if (e.target.value) patchTask({ taskTypeId: e.target.value }) }} aria-label="Tipo" aria-describedby="drawer-type-hint" title="Mudar o tipo gera um ID novo.">
                      {!task.taskTypeId && <option value="" disabled>Selecione o tipo…</option>}
                      {taskTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
                    </Sel>
                    <span id="drawer-type-hint" className="tk-sr">Mudar o tipo gera um ID novo.</span>
                  </PropRow>

                  <PropRow label="Sprint">
                    <Sel className="tk-field" value={task.sprintId ?? ''} onChange={(e: any) => patchTask({ sprintId: e.target.value || null })} aria-label="Sprint">
                      <option value="">Sem sprint</option>
                      {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Sel>
                  </PropRow>

                  <PropRow label="Story points">
                    <Sel
                      className="tk-field"
                      value={task.storyPoints != null ? String(task.storyPoints) : ''}
                      onChange={(e: any) => patchTask({ storyPoints: e.target.value ? Number(e.target.value) : null })}
                      aria-label="Story Points"
                    >
                      <option value="">Sem estimativa</option>
                      {STORY_POINTS_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Sel>
                  </PropRow>

                  <PropRow label="Ponto de controle">
                    <Toggle size={16} value={task.isMilestone} onChange={(v) => patchTask({ isMilestone: v })} label="Ponto de controle do projeto" />
                  </PropRow>
                </section>

                <section className="tk-sec">
                  <h3 className="tk-h">Tags</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 14px' }}>
                    {task.tags.map(({ tag }) => (
                      <TagChip key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />
                    ))}
                    <TagPicker
                      projectTags={projectTags}
                      selectedIds={task.tags.map((t) => t.tagId)}
                      onToggle={(tagId, selected) => (selected ? handleAddTag(tagId) : handleRemoveTag(tagId))}
                      onCreate={handleCreateTag}
                    />
                  </div>
                </section>

                <section className="tk-sec">
                  <h3 className="tk-h">Arquivos {taskAttachments.length > 0 && `(${taskAttachments.length})`}</h3>
                  {taskAttachments.map((file) => (
                    <div key={file.id} className="tk-line">
                      <span className="tk-text">
                        {file.fileName}
                        {file.entityType === 'comment' && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}> via comentário</span>}
                      </span>
                      <a className="pj-link" href={file.url} onClick={(e) => { e.preventDefault(); downloadAttachment(file.url, file.fileName) }}>Baixar</a>
                    </div>
                  ))}
                  <label className="pj-link" style={{ display: 'inline-block', marginTop: 6 }} title="PDF, PPT, Excel…">
                    <input type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={(e) => handleUploadFiles(e.target.files)} style={{ display: 'none' }} />
                    {uploading ? 'Enviando…' : 'Anexar arquivo'}
                  </label>
                </section>

                <section className="tk-sec">
                  <h3 className="tk-h">Documentos {task.documents.length > 0 && `(${task.documents.length})`}</h3>
                  {task.documents.map(({ document, documentId }) => (
                    <div key={documentId} className="tk-line">
                      <span className="tk-text">{document.title}</span>
                      <button type="button" className="icon-act" onClick={() => handleUnlinkDoc(documentId)} aria-label="Desvincular documento"><X size={14} /></button>
                    </div>
                  ))}
                  <div style={{ marginTop: 6 }}>
                    {docPickerOpen ? (
                      <Sel autoFocus value="" onChange={(e: any) => handleLinkDoc(e.target.value)} onBlur={() => setDocPickerOpen(false)}>
                        <option value="">Escolher documento do projeto…</option>
                        {availableDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                      </Sel>
                    ) : (
                      <button type="button" className="pj-link" onClick={() => setDocPickerOpen(true)}>Atrelar documento</button>
                    )}
                  </div>
                  {availableDocs.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData(DOCUMENT_DRAG_MIME, d.id)}
                      title="Arraste para um comentário para referenciar"
                      style={{ padding: '4px 0', fontSize: 13, color: 'var(--text-3)', cursor: 'grab', overflowWrap: 'anywhere' }}
                    >
                      {d.title}
                    </div>
                  ))}
                </section>

                <div className="tk-sec">
                  <TaskTimeSection projectId={projectId} taskId={taskId} refreshKey={`${task.statusId}-${task.assigneeId}`} />
                </div>
              </div>

              <div className="tk-main">
                <div className="tk-scroll">
                  <section className="tk-sec">
                    <h3 className="tk-h">
                      Descrição
                      {!descEditing && <button type="button" className="pj-link" onClick={startDescriptionEdit}>Editar</button>}
                    </h3>
                    {descEditing ? (
                      <MarkdownEditor
                        label="Descrição da task"
                        value={descDraft}
                        onChange={setDescDraft}
                        onSave={saveDescription}
                        onCancel={cancelDescriptionEdit}
                        renderPreview={renderMarkdown}
                        minHeight={descHeight}
                        placeholder="Descreva a task. Selecione o texto e use a barra para formatar."
                      />
                    ) : task.description ? (
                      <div
                        ref={descViewRef}
                        className="markdown-body"
                        style={{ fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.6, maxWidth: 720 }}
                        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                      />
                    ) : (
                      <div style={{ fontSize: 14, color: 'var(--text-3)' }}>Sem descrição. Use Editar para adicionar.</div>
                    )}
                  </section>

                  {/* Subtarefas: tasks completas com parent_id; clicar abre no mesmo drawer. */}
                  <section className="tk-sec">
                    <h3 className="tk-h">Subtarefas {subtasks.length > 0 && <small>{subtasksDone}/{subtasks.length}</small>}</h3>
                    {subtasks.map((sub) => {
                      const status = statuses.find((s) => s.id === sub.statusId)
                      const assignee = members.find((m) => m.userId === sub.assigneeId)
                      const done = status?.category === 'done' || status?.category === 'cancelled'
                      return (
                        <button key={sub.id} type="button" onClick={() => openOtherTask(sub.id)} disabled={!onOpenTask}
                          aria-label={`Abrir subtarefa ${taskLabel(sub)}: ${sub.title}`} className="tk-line" data-done={done}>
                          {status && <ColorDot color={status.color} title={status.name} size={9} />}
                          <span className="tk-text pj-cut">{sub.title}</span>
                          {assignee && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{assignee.user.name}</span>}
                          <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{taskLabel(sub)}</span>
                        </button>
                      )
                    })}
                    <div className="tk-add">
                      <input
                        placeholder="Nova subtarefa…"
                        aria-label="Nova subtarefa"
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask() }}
                      />
                      <Btn variant="secondary" size="sm" onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()} title="Criação rápida: só o título">Adicionar</Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setSubtaskModalOpen(true)} title="Preencher descrição, responsável, datas, tipo…">Completa</Btn>
                    </div>
                  </section>

                  <section className="tk-sec">
                    <h3 className="tk-h">Checklist {checklistTotal > 0 && <small>{checklistDone}/{checklistTotal} ({checklistPercent}%)</small>}</h3>
                    {checklistTotal > 0 && <Meter value={checklistDone} max={checklistTotal} />}
                    {checklist.map((item) => (
                      <div key={item.id} className="tk-line" data-done={item.done}>
                        <input type="checkbox" checked={item.done} onChange={() => handleToggleItem(item)} style={{ cursor: 'pointer', width: 15, height: 15, margin: 0 }} />
                        <span className="tk-text">{item.text}</span>
                        <button type="button" className="icon-act" onClick={() => handleDeleteItem(item.id)} aria-label={`Remover item ${item.text}`}><X size={14} /></button>
                      </div>
                    ))}
                    <div className="tk-add">
                      <input
                        placeholder="Novo item…"
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem() }}
                      />
                      <Btn variant="secondary" size="sm" onClick={handleAddItem}>Adicionar</Btn>
                    </div>
                  </section>

                  <div className="tk-sec">
                    <TaskTicketsSection
                      projectId={projectId}
                      taskId={taskId}
                      hasDueDate={!!task.dueDate}
                      refreshKey={task.statusId}
                      canEdit={canEdit && me?.role !== 'admin' && members.find((m) => m.userId === me?.id)?.role !== 'viewer'}
                    />
                  </div>

                  {/* Comentários e histórico, do mais antigo ao mais novo */}
                  <section className="tk-sec">
                    <h3 className="tk-h">Comentários e atividade {feedCount > 0 && <small>{feedCount}</small>}</h3>
                    <div style={{ display: 'flex' }}>
                      <SegmentedToggle ariaLabel="Mostrar no histórico" value={feedFilter} onChange={setFeedFilter} options={[
                        { value: 'all', label: 'Tudo' },
                        { value: 'comments', label: 'Comentários' },
                        { value: 'history', label: 'Histórico' },
                      ]} />
                    </div>
                    <div ref={feedRef} data-testid="task-feed">
                      {feed.map((item) => {
                        if (item.kind === 'day') return <DayDivider key={item.key} label={item.label} />
                        if (item.kind === 'event') return <ActivityLine key={item.key} event={item.event} />
                        const comment = item.comment
                        const author = members.find((m) => m.userId === comment.authorId)?.user
                        const editing = editingComment?.id === comment.id
                        return (
                          <div key={comment.id} className="tk-log">
                            {comment.createdAt
                              ? <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString('pt-BR')}>{timeOf(comment.createdAt)}</time>
                              : <span />}
                            <div style={{ minWidth: 0 }}>
                              {!editing && (
                                <span className="tk-log-acts">
                                  {comment.authorId === me?.id && (
                                    <button type="button" className="icon-act" aria-label="Editar comentário" title="Editar" onClick={() => setEditingComment({ id: comment.id, body: comment.body })}><Pencil size={13} /></button>
                                  )}
                                  {(comment.authorId === me?.id || canConfigure) && (
                                    <button type="button" className="icon-act danger" aria-label="Excluir comentário" title="Excluir" onClick={() => setCommentToDelete(comment)}><Trash2 size={13} /></button>
                                  )}
                                </span>
                              )}
                              <strong>{author?.name ?? 'Ex-membro'}</strong>
                              {comment.editedAt && <span style={{ color: 'var(--text-3)' }}> · editado</span>}
                              {editing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                  <textarea
                                    aria-label="Editar comentário"
                                    value={editingComment.body}
                                    onChange={(e) => setEditingComment({ id: comment.id, body: e.target.value })}
                                    rows={3}
                                    autoFocus
                                  />
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <Btn variant="ghost" size="xs" onClick={() => setEditingComment(null)}>Cancelar</Btn>
                                    <Btn variant="secondary" size="xs" onClick={handleSaveCommentEdit} disabled={!editingComment.body.trim()}>Salvar</Btn>
                                  </div>
                                </div>
                              ) : (
                                <p>{comment.body}</p>
                              )}
                              {attachmentsByComment.get(comment.id)?.map((file) => (
                                <a
                                  key={file.id}
                                  className="pj-link"
                                  href={file.url}
                                  onClick={(e) => { e.preventDefault(); downloadAttachment(file.url, file.fileName) }}
                                  style={{ display: 'block', overflowWrap: 'anywhere' }}
                                >
                                  {file.fileName}
                                </a>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {feed.length === 0 && (
                      <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--text-3)' }}>
                        {feedFilter === 'history' ? 'Nada registrado ainda. As mudanças feitas nesta tarefa aparecem aqui.' : 'Nenhum comentário ainda.'}
                      </p>
                    )}
                  </section>
                </div>

                <div
                  data-testid="comment-drop-zone"
                  className="tk-write"
                  data-over={isDraggingOverComment}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingOverComment(true) }}
                  onDragLeave={() => setIsDraggingOverComment(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDraggingOverComment(false)
                    const documentId = e.dataTransfer.getData(DOCUMENT_DRAG_MIME)
                    if (documentId) {
                      handleDropDocument(documentId)
                      return
                    }
                    handleCommentFilesSelected(e.dataTransfer.files)
                  }}
                >
                  {pendingCommentFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                      {file.name}
                      <button type="button" className="icon-act" style={{ width: 24, height: 24 }} onClick={() => removePendingCommentFile(i)} aria-label="Remover anexo"><X size={13} /></button>
                    </div>
                  ))}
                  <textarea
                    placeholder="Escrever um comentário…"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    // Só o paste: o arrastar já é tratado pela zona de drop em volta (docs + arquivos).
                    onPaste={fileDropPasteHandlers(handleCommentFilesSelected).onPaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        handleAddComment()
                      }
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', fontSize: 13, color: 'var(--text-3)' }}>
                    <label className="pj-link">
                      <input
                        type="file"
                        multiple
                        accept={ATTACHMENT_ACCEPT}
                        onChange={(e) => handleCommentFilesSelected(e.target.files)}
                        style={{ display: 'none' }}
                      />
                      Anexar
                    </label>
                    <span style={{ flex: 1, minWidth: 160 }}>Cole (Ctrl+V) ou arraste arquivos. Ctrl+Enter envia.</span>
                    <Btn variant="primary" size="sm" onClick={handleAddComment}>Comentar</Btn>
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
        )}

        {!loading && task && !canEdit && (
          // Fora do fieldset desabilitado: o visualizador ainda consegue seguir a task.
          <div role="note" className="tk-note">
            <span style={{ flex: 1, minWidth: 200 }}>
              Somente leitura: como visualizador você não edita nem comenta, mas pode seguir a task para receber as atualizações.
            </span>
            <Btn variant={following ? 'secondary' : 'primary'} size="sm" onClick={toggleFollow} disabled={following === null || followBusy}>
              {following ? 'Deixar de seguir' : 'Seguir'}
            </Btn>
          </div>
        )}
      </div>
      {/* Fora do painel animado: transform no ancestral prenderia o position:fixed do modal. */}
      {task && (
        <CreateTaskModal
          isOpen={subtaskModalOpen}
          onClose={() => setSubtaskModalOpen(false)}
          onCreated={(created) => { addSubtask(created); setSubtaskModalOpen(false) }}
          projectId={projectId}
          statuses={statuses}
          defaultStatusId={(statuses.find((s) => s.category === 'open') ?? statuses[0])?.id}
          parent={{ id: task.id, label: taskLabel(task), title: task.title, listId: task.listId, sprintId: task.sprintId ?? null }}
          initialTitle={newSubtaskTitle.trim()}
        />
      )}
      <ConfirmModal
        isOpen={!!commentToDelete}
        onClose={() => setCommentToDelete(null)}
        onConfirm={() => { if (commentToDelete) void handleDeleteComment(commentToDelete) }}
        title="Excluir comentário"
        message="O comentário some da task para todos. Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="danger"
      />
    </div>
  )
}
