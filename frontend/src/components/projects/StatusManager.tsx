import { useEffect, useState } from 'react'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Btn, ColorDot, Field, Inp, Sel, Toggle, EmptyState, Modal, Loading } from '@/components/ui'
import {
  listProjectStatuses, createStatusFull, updateStatus, reorderStatuses, deleteStatus,
} from '@/services/projectsService'
import { ProjectStatus, StatusCategory } from '@/types/projects'
import { ProjectColorPicker } from './ProjectColorPicker'
import './projects.css'

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  backlog: 'Backlog', open: 'Aberto', in_progress: 'Em progresso',
  in_review: 'Em revisão', done: 'Concluído', cancelled: 'Cancelado',
}

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL) as Array<[StatusCategory, string]>

const DEFAULT_COLOR_BY_CATEGORY: Record<StatusCategory, string> = {
  backlog: '#6b7f8a', open: '#5a6d9c', in_progress: '#0f73ac',
  in_review: '#a8761b', done: '#3a7f6b', cancelled: '#b3402a',
}

interface StatusFormState {
  name: string
  color: string
  category: StatusCategory
  requiresApproval: boolean
  wipLimit: string
}

function emptyForm(category: StatusCategory = 'open'): StatusFormState {
  return { name: '', color: DEFAULT_COLOR_BY_CATEGORY[category], category, requiresApproval: false, wipLimit: '' }
}

function StatusRow({
  status, onEdit, onDelete, onInsert, readOnly,
}: {
  status: ProjectStatus
  onEdit: () => void
  onDelete: () => void
  onInsert: () => void
  readOnly?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id, disabled: readOnly })

  return (
    <div ref={setNodeRef} className="pj-row" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      {/* Somente leitura: sem alça de arrastar (nem listeners do dnd-kit). */}
      {!readOnly && (
        <span {...attributes} {...listeners} aria-label={`Arrastar ${status.name}`} style={{ cursor: 'grab', color: 'var(--text-3)', display: 'flex' }}>
          <GripVertical size={16} />
        </span>
      )}
      <ColorDot color={status.color} size={10} />
      <b>{status.name}</b>
      {status.requiresApproval && <small title="Exige aprovação para concluir">Exige aprovação</small>}
      <small style={{ minWidth: 110 }}>{CATEGORY_LABEL[status.category]}</small>
      {!readOnly && (
        <span style={{ display: 'flex' }}>
          <button type="button" className="icon-act" onClick={onInsert} title={`Adicionar status depois de "${status.name}"`} aria-label={`Adicionar status depois de "${status.name}"`}><Plus size={15} /></button>
          <button type="button" className="icon-act" onClick={onEdit} title="Editar" aria-label={`Editar ${status.name}`}><Pencil size={14} /></button>
          <button type="button" className="icon-act danger" onClick={onDelete} title="Excluir" aria-label={`Excluir ${status.name}`}><Trash2 size={14} /></button>
        </span>
      )}
    </div>
  )
}

/** `readOnly`: membro/visualizador vê o fluxo, mas não arrasta, cria, edita nem exclui. */
export function StatusManager({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createAfterId, setCreateAfterId] = useState<string | undefined>(undefined)
  const [createForm, setCreateForm] = useState<StatusFormState>(emptyForm())

  const [editing, setEditing] = useState<ProjectStatus | null>(null)
  const [editForm, setEditForm] = useState<StatusFormState>(emptyForm())

  const [deleting, setDeleting] = useState<ProjectStatus | null>(null)
  const [reassignToId, setReassignToId] = useState('')

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function load() {
    setLoading(true)
    setError(null)
    listProjectStatuses(projectId)
      .then(setStatuses)
      .catch(() => setError('Não foi possível carregar os status.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  function openCreate(afterId?: string) {
    setCreateAfterId(afterId)
    setCreateForm(emptyForm())
    setFormError(null)
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!createForm.name.trim()) { setFormError('Dê um nome ao status.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const wipLimit = createForm.wipLimit.trim() ? Number(createForm.wipLimit) : null
      const created = await createStatusFull(projectId, { ...createForm, wipLimit, afterId: createAfterId })
      // Reflete a posição real sem esperar um novo GET — o backend já
      // reindexou os demais ao inserir "no meio".
      setStatuses((prev) => {
        const insertIndex = createAfterId ? prev.findIndex((s) => s.id === createAfterId) + 1 : prev.length
        const next = [...prev]
        next.splice(insertIndex, 0, created)
        return next
      })
      setCreateOpen(false)
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'Não foi possível criar o status.')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(status: ProjectStatus) {
    setEditing(status)
    setEditForm({ name: status.name, color: status.color, category: status.category, requiresApproval: status.requiresApproval, wipLimit: status.wipLimit != null ? String(status.wipLimit) : '' })
    setFormError(null)
  }

  async function handleEditSave() {
    if (!editing) return
    if (!editForm.name.trim()) { setFormError('Dê um nome ao status.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const wipLimit = editForm.wipLimit.trim() ? Number(editForm.wipLimit) : null
      const updated = await updateStatus(projectId, editing.id, { ...editForm, wipLimit })
      setStatuses((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setEditing(null)
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'Não foi possível salvar as alterações.')
    } finally {
      setSaving(false)
    }
  }

  function openDelete(status: ProjectStatus) {
    setDeleting(status)
    setReassignToId(statuses.find((s) => s.id !== status.id)?.id ?? '')
    setFormError(null)
  }

  async function handleDelete() {
    if (!deleting || !reassignToId) return
    setSaving(true)
    setFormError(null)
    try {
      await deleteStatus(projectId, deleting.id, reassignToId)
      setStatuses((prev) => prev.filter((s) => s.id !== deleting.id))
      setDeleting(null)
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'Não foi possível excluir o status.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (readOnly || !over || active.id === over.id) return

    const oldIndex = statuses.findIndex((s) => s.id === active.id)
    const newIndex = statuses.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(statuses, oldIndex, newIndex)

    setStatuses(reordered) // otimista
    try {
      await reorderStatuses(projectId, reordered.map((s) => s.id))
    } catch {
      setStatuses(statuses) // desfaz em caso de falha
      setError('Não foi possível salvar a nova ordem. Tente novamente.')
    }
  }

  if (loading) return <Loading size="compact" label="Carregando status…" />

  if (error && statuses.length === 0) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={error}
        action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="pj-rows">
            {statuses.map((status) => (
              <StatusRow key={status.id} status={status} onEdit={() => openEdit(status)} onDelete={() => openDelete(status)} onInsert={() => openCreate(status.id)} readOnly={readOnly} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {statuses.length === 0 && (
        <EmptyState title="Nenhum status configurado" desc="Todo projeto precisa de ao menos um status para receber tasks." />
      )}

      {!readOnly && (
        <Btn variant="secondary" size="sm" onClick={() => openCreate(undefined)} style={{ alignSelf: 'flex-start' }}>
          Novo status
        </Btn>
      )}

      {/* Criar */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title={createAfterId ? 'Adicionar status' : 'Novo status'} width={360}>
        {createOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={createForm.name} onChange={(e: any) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="QA" autoFocus />
            </Field>
            <Field label="Categoria">
              <Sel
                value={createForm.category}
                onChange={(e: any) => {
                  const category = e.target.value as StatusCategory
                  setCreateForm({ ...createForm, category, color: DEFAULT_COLOR_BY_CATEGORY[category] })
                }}
              >
                {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Sel>
            </Field>
            <Field label="Cor">
              <ProjectColorPicker noDefault label="Cor" value={createForm.color} onChange={(c) => c && setCreateForm({ ...createForm, color: c })} />
            </Field>
            <Field label="Limite de WIP (opcional)">
              <Inp
                type="number"
                min={1}
                value={createForm.wipLimit}
                onChange={(e: any) => setCreateForm({ ...createForm, wipLimit: e.target.value })}
                placeholder="Sem limite"
                aria-label="Limite de WIP"
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-2)' }}>
              <Toggle value={createForm.requiresApproval} onChange={(v: boolean) => setCreateForm({ ...createForm, requiresApproval: v })} />
              Exige aprovação para concluir a task
            </label>
            {formError && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{formError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={handleCreate} disabled={saving}>{saving ? 'Criando…' : 'Criar'}</Btn>
            </div>
        </div>
        )}
      </Modal>

      {/* Editar */}
      <Modal isOpen={!!(editing)} onClose={() => setEditing(null)} title={'Editar status'} width={360}>
        {(editing) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Categoria">
              <Sel value={editForm.category} onChange={(e: any) => setEditForm({ ...editForm, category: e.target.value as StatusCategory })}>
                {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Sel>
            </Field>
            <Field label="Cor">
              <ProjectColorPicker noDefault label="Cor" value={editForm.color} onChange={(c) => c && setEditForm({ ...editForm, color: c })} />
            </Field>
            <Field label="Limite de WIP (opcional)">
              <Inp
                type="number"
                min={1}
                value={editForm.wipLimit}
                onChange={(e: any) => setEditForm({ ...editForm, wipLimit: e.target.value })}
                placeholder="Sem limite"
                aria-label="Limite de WIP"
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-2)' }}>
              <Toggle value={editForm.requiresApproval} onChange={(v: boolean) => setEditForm({ ...editForm, requiresApproval: v })} />
              Exige aprovação para concluir a task
            </label>
            {formError && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{formError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={handleEditSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
            </div>
        </div>
        )}
      </Modal>

      {/* Excluir — realocação obrigatória (tasks nunca ficam órfãs) */}
      <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Excluir "${deleting.name}"` : ''} width={380}>
        {deleting && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: 0 }}>
              As tasks que estão neste status serão movidas para o status escolhido abaixo. Esta ação não pode ser desfeita.
            </p>
            {statuses.length <= 1 ? (
              <div style={{ fontSize: 13, color: 'var(--danger)' }}>Este é o único status do projeto — crie outro antes de excluir este.</div>
            ) : (
              <Field label="Mover tasks para">
                <Sel value={reassignToId} onChange={(e: any) => setReassignToId(e.target.value)}>
                  {statuses.filter((s) => s.id !== deleting.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Sel>
              </Field>
            )}
            {formError && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{formError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancelar</Btn>
              <Btn variant="danger" size="sm" onClick={handleDelete} disabled={saving || statuses.length <= 1}>
                {saving ? 'Excluindo…' : 'Excluir e mover tasks'}
              </Btn>
            </div>
        </div>
        )}
      </Modal>
    </div>
  )
}
