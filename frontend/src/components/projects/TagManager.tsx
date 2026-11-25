import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Btn, ColorDot, Field, Inp, Modal, Loading } from '@/components/ui'
import { listTags, createTag, deleteTag } from '@/services/projectsService'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import { Tag } from '@/types/projects'
import { PROJECT_COLORS, ProjectColorPicker } from './ProjectColorPicker'
import './projects.css'

const DEFAULT_COLOR = PROJECT_COLORS[0].value

/**
 * Tags são por projeto (aba Configurações), atribuídas a tasks individualmente
 * via TaskDrawer. Excluir tira a tag de todas as tasks: por isso a confirmação
 * mostra quantas usam. Quem não configura o projeto vê os botões desligados
 * (fieldset da tela), e o servidor confere de novo.
 */
export function TagManager({ projectId }: { projectId: string }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [removing, setRemoving] = useState(false)

  function load() {
    setLoading(true)
    listTags(projectId).then(setTags).finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  function openCreate() {
    setName('')
    setColor(DEFAULT_COLOR)
    setError(null)
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Dê um nome à tag.'); return }
    setSaving(true)
    setError(null)
    try {
      const created = await createTag(projectId, { name: name.trim(), color })
      setTags((prev) => [...prev, created])
      setCreateOpen(false)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Não foi possível criar a tag.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setRemoving(true)
    try {
      await deleteTag(projectId, deleting.id)
      setTags((prev) => prev.filter((t) => t.id !== deleting.id))
      toast.success(`Tag "${deleting.name}" excluída.`)
      setDeleting(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível excluir a tag.'))
    } finally {
      setRemoving(false)
    }
  }

  const uses = deleting?.taskCount ?? 0

  if (loading) return <Loading size="compact" label="Carregando tags…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {tags.length > 0 ? (
        <div className="pj-rows">
          {tags.map((tag) => (
            <div key={tag.id} className="pj-row">
              <ColorDot color={tag.color} size={10} />
              <b>{tag.name}</b>
              <button type="button" className="icon-act danger" onClick={() => setDeleting(tag)} aria-label={`Excluir tag ${tag.name}`} title={`Excluir tag ${tag.name}`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-3)' }}>Nenhuma tag configurada. Crie tags para classificar as tasks deste projeto.</p>}

      <Btn variant="secondary" size="sm" onClick={openCreate} style={{ alignSelf: 'flex-start' }}>
        Nova tag
      </Btn>

      <Modal isOpen={!!(createOpen)} onClose={() => setCreateOpen(false)} title={'Nova tag'} width={340}>
        {(createOpen) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Urgente" autoFocus />
            </Field>
            <Field label="Cor">
              <ProjectColorPicker noDefault label="Cor" value={color} onChange={(c) => c && setColor(c)} />
            </Field>
            {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={handleCreate} disabled={saving}>{saving ? 'Criando…' : 'Criar'}</Btn>
            </div>
        </div>
        )}
      </Modal>

      <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Excluir a tag "${deleting.name}"?` : ''} width={380}>
        {deleting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
              {uses > 0
                ? `Ela está em ${uses} ${uses === 1 ? 'task e será retirada dela' : 'tasks e será retirada de todas'}. A saída fica no histórico de cada task.`
                : 'Nenhuma task usa esta tag.'}
              {' '}Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancelar</Btn>
              <Btn variant="danger" size="sm" onClick={handleDelete} disabled={removing}>{removing ? 'Excluindo…' : 'Excluir'}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
