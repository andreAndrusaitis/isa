import { useEffect, useState } from 'react'
import { Modal, Btn, Field, Inp, Txta, Sel, Toggle } from '@/components/ui'
import { createTask } from '@/services/tasksService'
import { listMembers, listTaskTypes, listSprints } from '@/services/projectsService'
import { Task, ProjectStatus, TaskPriority, ProjectMemberWithUser, TaskType, Sprint } from '@/types/projects'

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade',
}

const STORY_POINTS_OPTIONS = [1, 2, 3, 5, 8, 13, 21]

/** Task-mãe quando o modal cria uma subtarefa: a filha herda lista e (como padrão) sprint. */
export interface ParentTaskInfo { id: string; label: string; title: string; listId: string | null; sprintId: string | null }

function emptyState(defaultStatusId: string, parent?: ParentTaskInfo, initialTitle = '') {
  return {
    title: initialTitle, description: '', statusId: defaultStatusId, taskTypeId: '', sprintId: parent?.sprintId ?? '', storyPoints: '', priority: 'none' as TaskPriority,
    assigneeId: '', startDate: '', dueDate: '', isMilestone: false,
  }
}

export function CreateTaskModal({ isOpen, onClose, onCreated, projectId, statuses, defaultStatusId, parent, initialTitle }: {
  isOpen: boolean
  onClose: () => void
  onCreated: (task: Task) => void
  projectId: string
  statuses: ProjectStatus[]
  defaultStatusId?: string
  parent?: ParentTaskInfo
  /** Título já digitado no campo rápido de subtarefa. */
  initialTitle?: string
}) {
  const [form, setForm] = useState(() => emptyState(defaultStatusId ?? statuses[0]?.id ?? '', parent, initialTitle))
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([])
  const selectedType = taskTypes.find((t) => t.id === form.taskTypeId)
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reseta o formulário sempre que o modal é reaberto — senão os dados da
  // task criada por último ficam pré-preenchidos na próxima.
  useEffect(() => {
    if (isOpen) setForm(emptyState(defaultStatusId ?? statuses[0]?.id ?? '', parent, initialTitle))
  }, [isOpen, defaultStatusId, statuses]) // eslint-disable-line react-hooks/exhaustive-deps -- parent/initialTitle só valem na abertura

  useEffect(() => {
    if (isOpen) listMembers(projectId).then(setMembers).catch(() => setMembers([]))
  }, [isOpen, projectId])

  useEffect(() => {
    if (isOpen) listTaskTypes(projectId).then(setTaskTypes).catch(() => setTaskTypes([]))
  }, [isOpen, projectId])

  useEffect(() => {
    if (isOpen) listSprints(projectId).then(setSprints).catch(() => setSprints([]))
  }, [isOpen, projectId])

  async function handleSubmit() {
    if (!form.title.trim() || !form.statusId || !form.taskTypeId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const task = await createTask(projectId, {
        title: form.title.trim(),
        statusId: form.statusId,
        description: form.description.trim() || null,
        taskTypeId: form.taskTypeId,
        sprintId: form.sprintId || null,
        storyPoints: form.storyPoints ? Number(form.storyPoints) : null,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        startDate: form.startDate ? `${form.startDate}T12:00:00.000Z` : null,
        dueDate: form.dueDate ? `${form.dueDate}T12:00:00.000Z` : null,
        isMilestone: form.isMilestone,
        ...(parent ? { parentId: parent.id, listId: parent.listId } : {}),
      })
      onCreated(task)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? (parent ? 'Não foi possível criar a subtarefa.' : 'Não foi possível criar a task.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={parent ? 'Nova subtarefa' : 'Nova task'}
      width={560}
      footer={
        <Btn variant="primary" size="sm" onClick={handleSubmit} disabled={!form.title.trim() || !form.statusId || !form.taskTypeId || submitting}>
          {submitting ? 'Criando…' : parent ? 'Criar subtarefa' : 'Criar task'}
        </Btn>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {parent && (
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Subtarefa de <strong style={{ color: 'var(--text-1)' }}>{parent.label}</strong> {parent.title}
          </div>
        )}
        <Field label="Título" required>
          <Inp
            value={form.title}
            onChange={(e: any) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex: Configurar ambiente de staging"
            autoFocus
          />
        </Field>

        <Field label="Tipo" required>
          <Sel value={form.taskTypeId} onChange={(e: any) => setForm({ ...form, taskTypeId: e.target.value })} aria-label="Tipo" aria-required="true" aria-describedby="task-type-hint">
            <option value="" disabled>Selecione o tipo…</option>
            {taskTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
          </Sel>
          <span id="task-type-hint" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {selectedType
              ? <>O ID será gerado automaticamente: <strong style={{ color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{selectedType.prefix}-{selectedType.nextNumber}</strong></>
              : 'Obrigatório — define o ID da task (ex.: BUG-12, FEAT-3).'}
          </span>
        </Field>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Field label="Responsável" style={{ flex: '1 1 200px' }}>
            <Sel value={form.assigneeId} onChange={(e: any) => setForm({ ...form, assigneeId: e.target.value })}>
              <option value="">Sem responsável</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
            </Sel>
          </Field>
          <Field label="Sprint" style={{ flex: '1 1 200px' }}>
            <Sel value={form.sprintId} onChange={(e: any) => setForm({ ...form, sprintId: e.target.value })} aria-label="Sprint">
              <option value="">Sem sprint</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
          </Field>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Field label="Status" required style={{ flex: '1 1 140px' }}>
            <Sel value={form.statusId} onChange={(e: any) => setForm({ ...form, statusId: e.target.value })}>
              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </Sel>
          </Field>
          <Field label="Prioridade" style={{ flex: '1 1 140px' }}>
            <Sel value={form.priority} onChange={(e: any) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Sel>
          </Field>
          <Field label="Story Points" style={{ flex: '1 1 140px' }}>
            <Sel value={form.storyPoints} onChange={(e: any) => setForm({ ...form, storyPoints: e.target.value })} aria-label="Story Points">
              <option value="">Sem estimativa</option>
              {STORY_POINTS_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Sel>
          </Field>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Field label="Início" style={{ flex: '1 1 140px' }}>
            <Inp type="date" value={form.startDate} onChange={(e: any) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Prazo" style={{ flex: '1 1 140px' }}>
            <Inp type="date" value={form.dueDate} onChange={(e: any) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
        </div>

        <Field label="Descrição">
          <Txta
            value={form.description}
            onChange={(e: any) => setForm({ ...form, description: e.target.value })}
            placeholder="Detalhes, critérios de aceite, links…"
            rows={3}
          />
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-1)' }}>
          <Toggle value={form.isMilestone} onChange={(v: boolean) => setForm({ ...form, isMilestone: v })} />
          Marcar como ponto de controle
        </label>

        {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      </div>
    </Modal>
  )
}
