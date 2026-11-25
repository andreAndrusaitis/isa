import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, Field, Inp, Modal, Sel, SearchableSelect } from '@/components/ui'
import { listProjects, listProjectStatuses, linkTicketToTask, unlinkTicketFromTask, listTaskTypes, listMembers, createTaskFromTicket } from '@/services/projectsService'
import { listTasks } from '@/services/tasksService'
import { ticketService } from '@/services/ticketService'
import { apiErrorMessage } from '@/services/api'
import type { Ticket } from '@/types'
import type { Project, ProjectMemberWithUser, Task, TaskType } from '@/types/projects'
import { taskLabel } from '@/components/projects/taskKey'

// Prazos são datas: em UTC o dia não volta (00:00 UTC seria o dia anterior no Brasil).
export const fmtForecast = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—')

/** Previsão (data) já passou? Compara só o dia, no calendário local. */
export function isForecastOverdue(due?: string | null, now = new Date()) {
  if (!due) return false
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return due.slice(0, 10) < today
}

/** Previsão vencida, em texto. */
export function ForecastOverdueBadge({ compact = false }: { compact?: boolean }) {
  return <span style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{compact ? 'Vencida' : 'Previsão vencida'}</span>
}

const todayInput = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd no fuso local

/**
 * Pode oferecer "Criar task" / "Vincular a uma task" no chamado? Só para quem tem
 * o módulo Projetos, com o chamado ativo e ainda sem task vinculada (as duas ações
 * ficam no menu Ações do chamado).
 */
export function canOfferTaskLink(ticket: Ticket & { pendingReason?: string | null }, canUseProjects: boolean) {
  return canUseProjects
    && !['resolved', 'closed'].includes(ticket.status)
    && !(ticket.status === 'pending' && ticket.pendingReason === 'pending_project')
}

/**
 * Lado do chamado da ponte chamado ↔ task: só aparece com o chamado vinculado.
 * Mostra a task que absorveu o chamado (Pendente — Em projeto, segue o prazo
 * dela) e, para quem tem o módulo Projetos, abre a task ou desvincula.
 */
export function TicketProjectLink({ ticket, canUseProjects, onChanged }: {
  ticket: Ticket & { pendingReason?: string | null }
  canUseProjects: boolean
  onChanged: (fresh: Partial<Ticket>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const link = ticket.project_task
  const active = !!link?.id && ticket.status === 'pending' && ticket.pendingReason === 'pending_project'
  const overdue = active && isForecastOverdue(link?.due_date) && !['done', 'cancelled'].includes(link?.status?.category ?? '')

  async function unlink() {
    if (!link?.id || !link.project_id) return
    setBusy(true)
    setError(null)
    try {
      await unlinkTicketFromTask(link.project_id, link.id, ticket.id)
      onChanged(await ticketService.getTicket(ticket.id))
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível desvincular.'))
    } finally {
      setBusy(false)
    }
  }

  // Sem vínculo (ou o vínculo ainda não veio: a lista não traz project_task): nada a mostrar.
  if (!active || !link) return null

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
      <span style={{ color: 'var(--text-3)' }}>Projeto</span>
      <span style={{ fontSize: 14, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>
        {link.project?.name} › {taskLabel(link)} {link.title}
      </span>
      <span style={{ color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        Fora do SLA: segue o prazo da task · previsão {fmtForecast(link.due_date)} · {link.status?.name}
        {overdue && <ForecastOverdueBadge />}
      </span>
      {overdue && (
        <span style={{ color: 'var(--danger)' }}>
          A previsão passou e a task segue aberta: o cliente continua esperando. Atualize o prazo da task (o cliente é avisado) ou desvincule.
        </span>
      )}
      {canUseProjects && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <OpenTaskButton projectId={link.project_id!} taskId={link.id!} />
          <Btn variant="secondary" size="xs" onClick={unlink} disabled={busy}>{busy ? 'Desvinculando…' : 'Desvincular'}</Btn>
        </div>
      )}
      {error && <span role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

// useNavigate só aqui: o detalhe do chamado também é renderizado fora de um Router (testes).
function OpenTaskButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const navigate = useNavigate()
  return <Btn variant="secondary" size="xs" onClick={() => navigate(`/projetos/${projectId}/tasks?task=${taskId}`)}>Abrir task</Btn>
}

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => { listProjects().then(setProjects).catch(() => setProjects([])) }, [])
  return projects
}

export function LinkTicketToTaskModal({ ticketId, onClose, onLinked }: { ticketId: string; onClose: () => void; onLinked: () => void }) {
  const projects = useProjects()
  const [tasks, setTasks] = useState<Task[]>([])
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTaskId('')
    setTasks([])
    if (!projectId) return
    // Task concluída, cancelada ou arquivada não recebe chamados: nem aparece na lista.
    Promise.all([listTasks(projectId), listProjectStatuses(projectId)])
      .then(([list, statuses]) => {
        const closed = new Set(statuses.filter((st) => st.category === 'done' || st.category === 'cancelled').map((st) => st.id))
        setTasks(list.filter((t) => !t.archivedAt && !closed.has(t.statusId)))
      })
      .catch(() => setTasks([]))
  }, [projectId])

  const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await linkTicketToTask(projectId, taskId, ticketId)
      onLinked()
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível vincular.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Vincular chamado a uma task"
      footer={<Btn variant="primary" size="sm" onClick={confirm} disabled={busy || !task || !task.dueDate}>{busy ? 'Vinculando…' : 'Vincular'}</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
          O chamado sai do SLA e passa a seguir o prazo da task. Quando a task for concluída, o chamado é resolvido automaticamente.
        </div>
        <Field label="Projeto">
          <SearchableSelect aria-label="Projeto" value={projectId} onChange={setProjectId}
            placeholder="Selecione o projeto…" searchPlaceholder="Buscar projeto..."
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Task">
          <SearchableSelect aria-label="Task" value={taskId} onChange={setTaskId} disabled={!projectId}
            placeholder={projectId ? 'Selecione a task…' : 'Escolha o projeto primeiro'}
            searchPlaceholder="Buscar por ID ou título..."
            options={tasks.map((t) => ({ value: t.id, label: `${taskLabel(t)} ${t.title}`, sublabel: t.dueDate ? `prazo ${fmtForecast(t.dueDate)}` : 'sem prazo' }))} />
        </Field>
        {task && !task.dueDate && <div style={{ fontSize: 13, color: 'var(--warning)' }}>Esta task não tem prazo. Defina o prazo nela antes de vincular.</div>}
        {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      </div>
    </Modal>
  )
}

/** "Criar task" no chamado (ID 1.1): título do chamado, tipo e prazo obrigatórios. */
export function CreateTaskFromTicketModal({ ticket, onClose, onCreated }: { ticket: Ticket; onClose: () => void; onCreated: () => void }) {
  const projects = useProjects()
  const [projectId, setProjectId] = useState('')
  const [types, setTypes] = useState<TaskType[]>([])
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [form, setForm] = useState({ title: ticket.title, taskTypeId: '', dueDate: '', assigneeId: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTypes([])
    setMembers([])
    setForm((f) => ({ ...f, taskTypeId: '', assigneeId: '' }))
    if (!projectId) return
    listTaskTypes(projectId).then(setTypes).catch(() => setTypes([]))
    listMembers(projectId).then((m) => setMembers(m.filter((x) => x.role !== 'viewer'))).catch(() => setMembers([]))
  }, [projectId])

  const type = types.find((t) => t.id === form.taskTypeId)
  const pastDue = !!form.dueDate && form.dueDate < todayInput()
  const ready = projectId && form.title.trim() && form.taskTypeId && form.dueDate && !pastDue

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await createTaskFromTicket(projectId, {
        ticket: ticket.id,
        title: form.title.trim(),
        taskTypeId: form.taskTypeId,
        dueDate: `${form.dueDate}T12:00:00.000Z`,
        assigneeId: form.assigneeId || null,
      })
      onCreated()
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível criar a task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Criar task a partir do chamado"
      footer={<Btn variant="primary" size="sm" onClick={confirm} disabled={busy || !ready}>{busy ? 'Criando…' : 'Criar e vincular'}</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
          A task nasce com a descrição do chamado e já vinculada: o chamado sai do SLA, segue o prazo da task e o cliente recebe a previsão por e-mail.
        </div>
        <Field label="Projeto">
          <SearchableSelect aria-label="Projeto" value={projectId} onChange={setProjectId}
            placeholder="Selecione o projeto…" searchPlaceholder="Buscar projeto..."
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Título">
          <Inp aria-label="Título da task" value={form.title} maxLength={300} onChange={(e: any) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Tipo">
            <Sel aria-label="Tipo da task" value={form.taskTypeId} disabled={!projectId} onChange={(e: any) => setForm({ ...form, taskTypeId: e.target.value })}>
              <option value="">{projectId ? 'Selecione o tipo…' : 'Escolha o projeto'}</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.prefix ? `${t.prefix} · ` : ''}{t.name}</option>)}
            </Sel>
          </Field>
          <Field label="Prazo (previsão ao cliente)">
            <Inp aria-label="Prazo da task" type="date" min={todayInput()} value={form.dueDate} onChange={(e: any) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Responsável (opcional)">
          <SearchableSelect aria-label="Responsável" value={form.assigneeId} disabled={!projectId} onChange={(v) => setForm({ ...form, assigneeId: v })}
            placeholder="Sem responsável" searchPlaceholder="Buscar pessoa..."
            options={[{ value: '', label: 'Sem responsável' }, ...members.map((m) => ({ value: m.userId, label: m.user.name }))]} />
        </Field>
        {type && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>O ID será gerado automaticamente: {type.prefix}-{type.nextNumber}</div>}
        {pastDue && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>O prazo já passou: escolha hoje ou uma data futura.</div>}
        {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      </div>
    </Modal>
  )
}
