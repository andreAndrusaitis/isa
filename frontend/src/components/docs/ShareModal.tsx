import { useCallback, useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Avatar, Btn, ConfirmModal, Field, Inp, Loading, Modal, Sel, Txta } from '@/components/ui'
import { docsService, type SpaceInput } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toastStore'
import { ROLE_LABEL, type DocMember, type DocPerson, type DocSpace, type SpaceRole } from '@/types/docs'
import { IconPicker } from './IconPicker'

const ROLES: SpaceRole[] = ['owner', 'editor', 'viewer']
const photo = (src?: string | null) => (src?.startsWith('http') || src?.startsWith('data:') ? src : undefined)

/** Criar ou editar um espaço. */
export function SpaceModal({ space, onClose, onSaved, onArchived }: { space?: DocSpace; onClose: () => void; onSaved: (s: DocSpace) => void; onArchived?: () => void }) {
  const [form, setForm] = useState<Required<Pick<SpaceInput, 'name' | 'visibility'>> & { icon: string | null; description: string }>({
    name: space?.name ?? '', icon: space?.icon ?? '📘', description: space?.description ?? '', visibility: space?.visibility ?? 'private',
  })
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const save = async () => {
    setBusy(true)
    try { onSaved(space ? await docsService.updateSpace(space.id, form) : await docsService.createSpace(form)) }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível salvar o espaço.')); setBusy(false) }
  }
  const archive = async () => {
    setConfirm(false)
    try { await docsService.archiveSpace(space!.id); toast.success('Espaço arquivado.'); onArchived?.() }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível arquivar o espaço.')) }
  }
  return (
    <Modal isOpen onClose={onClose} title={space ? 'Editar espaço' : 'Novo espaço'} width={460} footer={
      <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
        {space && onArchived && <Btn variant="ghost" size="sm" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => setConfirm(true)}>Arquivar</Btn>}
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancelar</Btn>
        <Btn size="sm" disabled={busy || !form.name.trim()} onClick={save}>{space ? 'Salvar' : 'Criar espaço'}</Btn>
      </div>
    }>
      <form onSubmit={e => { e.preventDefault(); if (form.name.trim()) void save() }} style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <IconPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} label="Ícone do espaço" />
          <div style={{ flex: 1 }}><Field label="Nome"><Inp autoFocus value={form.name} maxLength={120} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex.: Guia de atendimento" /></Field></div>
        </div>
        <Field label="Descrição"><Txta rows={2} value={form.description} maxLength={500} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
        <div>
          <Field label="Quem pode ver">
            <Sel value={form.visibility} onChange={e => setForm(f => ({ ...f, visibility: e.target.value as 'private' | 'internal' }))}>
              <option value="private">Só as pessoas do espaço</option>
              <option value="internal">Todos que usam Documentos (leitura)</option>
            </Sel>
          </Field>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>Editar é sempre só para quem foi incluído como editor ou dono.</p>
        </div>
      </form>
      <ConfirmModal isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={archive} title="Arquivar este espaço?" message="As páginas deixam de aparecer para todos. Um dono pode desarquivar depois." confirmText="Arquivar" variant="danger" />
    </Modal>
  )
}

/** Pessoas do espaço e o que cada uma pode fazer. */
export function ShareModal({ space, onClose }: { space: DocSpace; onClose: () => void }) {
  const me = useAuthStore(s => s.user)!
  const [members, setMembers] = useState<DocMember[] | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<DocPerson[]>([])
  const manage = space.role === 'owner'

  const load = useCallback(() => docsService.members(space.id).then(setMembers).catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar as pessoas.'))), [space.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!manage || q.trim().length < 2) { setFound([]); return }
    let alive = true
    const t = setTimeout(() => docsService.people(q.trim()).then(r => { if (alive) setFound(r) }).catch(() => {}), 220)
    return () => { alive = false; clearTimeout(t) }
  }, [q, manage])

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    try { await action(); await load() } catch (err) { toast.error(apiErrorMessage(err, fallback)) }
  }
  const options = found.filter(p => !members?.some(m => m.user.id === p.id))

  return (
    <Modal isOpen onClose={onClose} title={`Pessoas em ${space.name}`} width={520}>
      {manage && (
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Inp value={q} onChange={e => setQ(e.target.value)} placeholder="Incluir por nome ou e-mail" aria-label="Incluir pessoa" />
          {options.length > 0 && (
            <div className="doc-pop" style={{ left: 0, right: 0, maxHeight: 220, overflowY: 'auto' }}>
              {options.map(p => (
                <button key={p.id} type="button" onClick={() => { setQ(''); void run(() => docsService.setMember(space.id, p.id, 'editor'), 'Não foi possível incluir a pessoa.') }}>
                  <UserPlus size={15} /><span><b style={{ fontWeight: 500 }}>{p.name}</b> <span style={{ color: 'var(--text-3)' }}>{p.email}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!members ? <Loading size="compact" /> : (
        <div style={{ display: 'grid', gap: 2 }}>
          {members.map(m => (
            <div key={m.user.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              <Avatar name={m.user.name} size={30} src={photo(m.user.avatar)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{m.user.name}{m.user.id === me.id ? ' (você)' : ''}</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user.email}</div>
              </div>
              {manage ? (
                <>
                  <Sel aria-label={`Papel de ${m.user.name}`} value={m.role} style={{ width: 140 }} onChange={e => run(() => docsService.setMember(space.id, m.user.id, e.target.value as SpaceRole), 'Não foi possível mudar o papel.')}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Sel>
                  <button type="button" className="icon-btn" aria-label={`Remover ${m.user.name}`} onClick={() => run(() => docsService.removeMember(space.id, m.user.id), 'Não foi possível remover a pessoa.')}><X size={15} /></button>
                </>
              ) : <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{ROLE_LABEL[m.role]}</span>}
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
        {space.visibility === 'internal' ? 'Além destas pessoas, todos que usam Documentos podem ler este espaço.' : 'Só estas pessoas e os administradores veem este espaço.'}
      </p>
    </Modal>
  )
}
