import { useEffect, useState } from 'react'
import {
  BookmarkCheck, Bug, CheckSquare, Zap, Flag, Milestone, AlertCircle, Package, Layers, Puzzle,
  Sparkles, FlaskConical, FileText, Pencil, Trash2,
} from 'lucide-react'
import { Btn, ColorDot, Field, Inp, Sel, Modal, Loading } from '@/components/ui'
import { listTaskTypes, createTaskType, updateTaskType, deleteTaskType } from '@/services/projectsService'
import { TaskType } from '@/types/projects'
import { PROJECT_COLORS, ProjectColorPicker } from './ProjectColorPicker'
import './projects.css'

// Mesma lista fechada de ícones que o backend valida (createTaskTypeSchema
// em backend/src/services/taskTypes.ts) — mantidas em sincronia manualmente,
// mesmo padrão já usado para ALLOWED_ATTACHMENT_EXTENSIONS.
const TASK_TYPE_ICON_MAP: Record<string, typeof BookmarkCheck> = {
  BookmarkCheck, Bug, CheckSquare, Zap, Flag, Milestone, AlertCircle, Package, Layers, Puzzle,
  Sparkles, FlaskConical, FileText,
}

const ICON_NAMES = Object.keys(TASK_TYPE_ICON_MAP)
const DEFAULT_COLOR = PROJECT_COLORS[0].value

interface TaskTypeFormState {
  name: string
  icon: string
  color: string
  prefix: string
}

function emptyForm(): TaskTypeFormState {
  return { name: '', icon: 'CheckSquare', color: DEFAULT_COLOR, prefix: '' }
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {ICON_NAMES.map((name) => {
        const Icon = TASK_TYPE_ICON_MAP[name]
        const selected = value === name
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            title={name}
            className="icon-act"
            style={selected ? { background: 'var(--accent-soft)', color: 'var(--text-1)' } : undefined}
            aria-pressed={selected}
          >
            <Icon size={15} />
          </button>
        )
      })}
    </div>
  )
}

/** Prefixo do ID (BUG → BUG-12): só maiúsculas e números, até 8. */
function PrefixField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label="Prefixo do ID">
      <Inp
        value={value}
        onChange={(e: any) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
        placeholder={placeholder ?? 'Ex.: BUG'}
        aria-describedby="prefix-hint"
      />
      <span id="prefix-hint" style={{ fontSize: 12, color: 'var(--text-3)' }}>
        As tasks deste tipo ficam {value || 'PREFIXO'}-1, {value || 'PREFIXO'}-2… Mudar o prefixo atualiza o ID das existentes.
      </span>
    </Field>
  )
}

export function TaskTypeManager({ projectId }: { projectId: string }) {
  const [types, setTypes] = useState<TaskType[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<TaskTypeFormState>(emptyForm())
  const [editing, setEditing] = useState<TaskType | null>(null)
  const [editForm, setEditForm] = useState<TaskTypeFormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [replacementId, setReplacementId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    listTaskTypes(projectId).then(setTypes).finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  function openCreate() {
    setCreateForm(emptyForm())
    setError(null)
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!createForm.name.trim()) { setError('Dê um nome ao tipo.'); return }
    setSaving(true)
    setError(null)
    try {
      const { prefix, ...rest } = createForm
      const created = await createTaskType(projectId, prefix ? { ...rest, prefix } : rest)
      setTypes((prev) => [...prev, created])
      setCreateOpen(false)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível criar o tipo.')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(type: TaskType) {
    setEditing(type)
    setEditForm({ name: type.name, icon: type.icon, color: type.color, prefix: type.prefix })
    setError(null)
  }

  async function handleEditSave() {
    if (!editing) return
    if (!editForm.name.trim()) { setError('Dê um nome ao tipo.'); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await updateTaskType(projectId, editing.id, editForm)
      setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setEditing(null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível salvar as alterações.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await deleteTaskType(projectId, editing.id, replacementId || undefined)
      setTypes((prev) => prev.filter((t) => t.id !== editing.id))
      setEditing(null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível excluir o tipo.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading size="compact" label="Carregando tipos de tarefa…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {types.length > 0 ? (
        <div className="pj-rows">
          {types.map((type) => (
            <button key={type.id} type="button" title={`Editar ${type.name}`} onClick={() => openEdit(type)} className="pj-row">
              <ColorDot color={type.color} size={10} />
              <b>{type.name}</b>
              <small style={{ minWidth: 80 }}>{type.prefix}</small>
              <Pencil size={14} color="var(--text-3)" aria-hidden />
            </button>
          ))}
        </div>
      ) : <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-3)' }}>Nenhum tipo configurado. Crie tipos como Bug, Feature ou Epic para classificar as tarefas e gerar os IDs (BUG-12).</p>}

      <Btn variant="secondary" size="sm" onClick={openCreate} style={{ alignSelf: 'flex-start' }}>
        Novo tipo
      </Btn>

      <Modal isOpen={!!(createOpen)} onClose={() => setCreateOpen(false)} title={'Novo tipo'} width={360}>
        {(createOpen) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={createForm.name} onChange={(e: any) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Ex: Bug" autoFocus />
            </Field>
            <PrefixField value={createForm.prefix} onChange={(prefix) => setCreateForm({ ...createForm, prefix })} placeholder="Automático pelo nome" />
            <Field label="Ícone">
              <IconPicker value={createForm.icon} onChange={(icon) => setCreateForm({ ...createForm, icon })} />
            </Field>
            <Field label="Cor">
              <ProjectColorPicker noDefault label="Cor" value={createForm.color} onChange={(c) => c && setCreateForm({ ...createForm, color: c })} />
            </Field>
            {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={handleCreate} disabled={saving}>{saving ? 'Criando…' : 'Criar'}</Btn>
            </div>
        </div>
        )}
      </Modal>

      <Modal isOpen={!!(editing)} onClose={() => setEditing(null)} title={'Editar tipo'} width={360}>
        {(editing) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} autoFocus />
            </Field>
            <PrefixField value={editForm.prefix} onChange={(prefix) => setEditForm({ ...editForm, prefix })} />
            <Field label="Ícone">
              <IconPicker value={editForm.icon} onChange={(icon) => setEditForm({ ...editForm, icon })} />
            </Field>
            <Field label="Cor">
              <ProjectColorPicker noDefault label="Cor" value={editForm.color} onChange={(c) => c && setEditForm({ ...editForm, color: c })} />
            </Field>
            {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <Btn variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={() => { setReplacementId(''); setConfirmingDelete(true) }} disabled={saving || types.length <= 1}>Excluir</Btn>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancelar</Btn>
                <Btn variant="primary" size="sm" onClick={handleEditSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
              </div>
            </div>
        </div>
        )}
      </Modal>
      <Modal isOpen={confirmingDelete} onClose={() => setConfirmingDelete(false)} title="Excluir tipo de task" width={380}>
        {confirmingDelete && editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
              O tipo é obrigatório nas tasks. As tasks de <strong>{editing.name}</strong> vão para o tipo escolhido e ganham um ID novo nele.
            </p>
            <Field label="Mover as tasks para">
              <Sel value={replacementId} onChange={(e: any) => setReplacementId(e.target.value)} aria-label="Tipo de destino">
                <option value="">Tarefa (padrão)</option>
                {types.filter((t) => t.id !== editing.id).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
              </Sel>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>Cancelar</Btn>
              <Btn variant="danger" size="sm" onClick={() => { setConfirmingDelete(false); handleDelete() }}>Excluir e mover</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
