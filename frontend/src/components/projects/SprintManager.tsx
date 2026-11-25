import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Btn, Field, Inp, Modal, ConfirmModal, Loading } from '@/components/ui'
import { SprintApi, listSprints, createSprint, updateSprint, deleteSprint, startSprint, completeSprint } from '@/services/projectsService'
import { SprintStatus } from '@/types/projects'
import './projects.css'

const STATUS_LABEL: Record<SprintStatus, string> = {
  planned: 'Planejado', active: 'Ativo', completed: 'Encerrado',
}

interface SprintFormState {
  name: string
  startDate: string
  endDate: string
}

function emptyForm(): SprintFormState {
  return { name: '', startDate: '', endDate: '' }
}

function toIso(date: string): string | null {
  return date ? `${date}T12:00:00.000Z` : null // meio-dia UTC: o dia não muda em nenhum fuso do Brasil
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export function projectSprintApi(projectId: string): SprintApi {
  return {
    list: () => listSprints(projectId),
    create: (input) => createSprint(projectId, input),
    update: (id, input) => updateSprint(projectId, id, input),
    remove: (id) => deleteSprint(projectId, id),
    start: (id) => startSprint(projectId, id),
    complete: (id) => completeSprint(projectId, id),
  }
}

type Sprint = Awaited<ReturnType<SprintApi['list']>>[number]

/** `readOnly`: projeto que segue o calendário global só enxerga os sprints. */
export function SprintManager({ api, readOnly = false }: { api: SprintApi; readOnly?: boolean }) {
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<SprintFormState>(emptyForm())
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [editForm, setEditForm] = useState<SprintFormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api.list().then(setSprints).finally(() => setLoading(false))
  }

  useEffect(load, [api])

  function openCreate() {
    setCreateForm(emptyForm())
    setError(null)
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!createForm.name.trim()) { setError('Dê um nome ao sprint.'); return }
    setSaving(true)
    setError(null)
    try {
      const created = await api.create({
        name: createForm.name, startDate: toIso(createForm.startDate), endDate: toIso(createForm.endDate),
      })
      setSprints((prev) => [...prev, created])
      setCreateOpen(false)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível criar o sprint.')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(sprint: Sprint) {
    setEditing(sprint)
    setEditForm({ name: sprint.name, startDate: toDateInput(sprint.startDate), endDate: toDateInput(sprint.endDate) })
    setError(null)
  }

  async function handleEditSave() {
    if (!editing) return
    if (!editForm.name.trim()) { setError('Dê um nome ao sprint.'); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await api.update(editing.id, {
        name: editForm.name, startDate: toIso(editForm.startDate), endDate: toIso(editForm.endDate),
      })
      setSprints((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
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
      await api.remove(editing.id)
      setSprints((prev) => prev.filter((s) => s.id !== editing.id))
      setEditing(null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível excluir o sprint.')
    } finally {
      setSaving(false)
    }
  }

  async function handleStart(sprint: Sprint) {
    try {
      const updated = await api.start(sprint.id)
      setSprints((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível iniciar o sprint.')
    }
  }

  async function handleComplete(sprint: Sprint) {
    try {
      const updated = await api.complete(sprint.id)
      setSprints((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível encerrar o sprint.')
    }
  }

  if (loading) return <Loading size="compact" label="Carregando sprints…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

      {sprints.length > 0 ? (
        <div className="pj-rows">
          {sprints.map((sprint) => (
            <div key={sprint.id} className="pj-row">
              <b>{sprint.name}</b>
              <small style={sprint.status === 'active' ? { color: 'var(--text-1)', fontWeight: 500 } : undefined}>{STATUS_LABEL[sprint.status]}</small>
              {!readOnly && sprint.status === 'planned' && <Btn variant="ghost" size="xs" onClick={() => handleStart(sprint)}>Iniciar</Btn>}
              {!readOnly && sprint.status === 'active' && <Btn variant="ghost" size="xs" onClick={() => handleComplete(sprint)}>Encerrar</Btn>}
              {!readOnly && <button type="button" className="icon-act" title={`Editar ${sprint.name}`} aria-label={`Editar ${sprint.name}`} onClick={() => openEdit(sprint)}><Pencil size={14} /></button>}
            </div>
          ))}
        </div>
      ) : <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-3)' }}>Nenhum sprint configurado. {readOnly ? 'O calendário do Gerente ainda não tem sprints.' : 'Crie sprints para organizar as tarefas deste projeto por período.'}</p>}

      {!readOnly && (
        <Btn variant="secondary" size="sm" onClick={openCreate} style={{ alignSelf: 'flex-start' }}>
          Novo sprint
        </Btn>
      )}

      <Modal isOpen={!!(createOpen)} onClose={() => setCreateOpen(false)} title={'Novo sprint'} width={360}>
        {(createOpen) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={createForm.name} onChange={(e: any) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Sprint 1" autoFocus />
            </Field>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Início" style={{ flex: 1 }}>
                <Inp type="date" value={createForm.startDate} onChange={(e: any) => setCreateForm({ ...createForm, startDate: e.target.value })} />
              </Field>
              <Field label="Fim" style={{ flex: 1 }}>
                <Inp type="date" value={createForm.endDate} onChange={(e: any) => setCreateForm({ ...createForm, endDate: e.target.value })} />
              </Field>
            </div>
            {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={handleCreate} disabled={saving}>{saving ? 'Criando…' : 'Criar'}</Btn>
            </div>
        </div>
        )}
      </Modal>

      <Modal isOpen={!!(editing)} onClose={() => setEditing(null)} title={'Editar sprint'} width={360}>
        {(editing) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} autoFocus />
            </Field>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Início" style={{ flex: 1 }}>
                <Inp type="date" value={editForm.startDate} onChange={(e: any) => setEditForm({ ...editForm, startDate: e.target.value })} />
              </Field>
              <Field label="Fim" style={{ flex: 1 }}>
                <Inp type="date" value={editForm.endDate} onChange={(e: any) => setEditForm({ ...editForm, endDate: e.target.value })} />
              </Field>
            </div>
            {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <Btn variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={() => setConfirmingDelete(true)} disabled={saving}>Excluir</Btn>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancelar</Btn>
                <Btn variant="primary" size="sm" onClick={handleEditSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
              </div>
            </div>
        </div>
        )}
      </Modal>
      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => { setConfirmingDelete(false); handleDelete() }}
        title="Excluir sprint"
        message={`Excluir o sprint "${editing?.name}"? Tasks vinculadas ficarão sem sprint.`}
        confirmText="Excluir"
        variant="danger"
      />
    </div>
  )
}
