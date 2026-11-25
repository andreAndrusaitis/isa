import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Btn, ConfirmModal, EmptyState, Loading, PageHeader } from '@/components/ui'
import { docsService } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import type { DocListItem, DocSpace, DocTrashItem } from '@/types/docs'

const ago = (d: string) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function Rows({ items }: { items: DocListItem[] }) {
  const navigate = useNavigate()
  return (
    <div className="doc-list">
      {items.map(p => (
        <button key={p.id} type="button" onClick={() => navigate(`/documentos/p/${p.id}`)}>
          <span className="doc-icon">{p.icon ?? '📄'}</span>
          <span className="t">{p.title}</span>
          <small className="hide-on-tablet">{p.space.name}</small>
          <small>{[p.updatedBy?.name?.split(' ')[0], ago(p.updatedAt)].filter(Boolean).join(', ')}</small>
        </button>
      ))}
    </div>
  )
}

export function DocHome({ spaces, onNewSpace, onOpenSpace }: { spaces: DocSpace[]; onNewSpace: () => void; onOpenSpace: (s: DocSpace) => void }) {
  const [recent, setRecent] = useState<DocListItem[] | null>(null)
  const [favorites, setFavorites] = useState<DocListItem[]>([])
  useEffect(() => {
    docsService.recent().then(setRecent).catch(() => setRecent([]))
    docsService.favorites().then(setFavorites).catch(() => {})
  }, [])
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader title="Documentos" subtitle="Páginas da equipe, escritas a várias mãos" actions={<Btn size="sm" icon={<Plus size={15} />} onClick={onNewSpace}>Novo espaço</Btn>} />
      <div className="doc-home">
        <section>
          <h2>Espaços</h2>
          {spaces.length === 0 ? <EmptyState icon={<FileText size={28} />} title="Nenhum espaço ainda" desc="Um espaço reúne as páginas de um assunto ou de uma equipe." /> : (
            <div className="doc-cards">
              {spaces.map(s => (
                <button key={s.id} type="button" className="doc-card" onClick={() => onOpenSpace(s)}>
                  <span className="i">{s.icon ?? '📘'}</span>
                  <b>{s.name}</b>
                  {s.description && <span style={{ color: 'var(--text-2)' }}>{s.description}</span>}
                  <small>{s.pageCount} {s.pageCount === 1 ? 'página' : 'páginas'} · {s.visibility === 'internal' ? 'Todos leem' : `${s.memberCount} ${s.memberCount === 1 ? 'pessoa' : 'pessoas'}`}</small>
                </button>
              ))}
            </div>
          )}
        </section>
        {favorites.length > 0 && <section><h2>Favoritos</h2><Rows items={favorites} /></section>}
        <section>
          <h2>Editadas há pouco</h2>
          {!recent ? <Loading size="compact" /> : recent.length ? <Rows items={recent} /> : <p style={{ color: 'var(--text-3)' }}>As páginas editadas aparecem aqui.</p>}
        </section>
      </div>
    </div>
  )
}

export function DocTrash({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<DocTrashItem[] | null>(null)
  const [deleting, setDeleting] = useState<DocTrashItem | null>(null)
  const load = useCallback(() => docsService.trash().then(setItems).catch(err => { setItems([]); toast.error(apiErrorMessage(err, 'Não foi possível abrir a lixeira.')) }), [])
  useEffect(() => { void load() }, [load])
  const run = async (action: () => Promise<unknown>, ok: string) => {
    try { await action(); toast.success(ok); onChanged(); await load() } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível concluir.')) }
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader title="Lixeira" subtitle="Páginas excluídas dos espaços que você edita" />
      <div className="doc-home">
        {!items ? <Loading size="compact" /> : items.length === 0 ? <EmptyState icon={<Trash2 size={28} />} title="Lixeira vazia" desc="O que for excluído fica aqui até ser restaurado ou apagado." /> : (
          <div className="doc-list">
            {items.map(p => (
              <div key={p.id}>
                <span className="doc-icon">{p.icon ?? '📄'}</span>
                <span className="t">{p.title}{p.childCount > 0 && <small> e mais {p.childCount}</small>}</span>
                <small className="hide-on-tablet">{p.space.name}</small>
                <small>{ago(p.deletedAt)}{p.deletedBy ? `, por ${p.deletedBy.name.split(' ')[0]}` : ''}</small>
                <Btn size="xs" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => run(() => docsService.restorePage(p.id), 'Página restaurada.')}>Restaurar</Btn>
                <button type="button" className="icon-btn" aria-label={`Apagar ${p.title} de vez`} onClick={() => setDeleting(p)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmModal isOpen={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => { const p = deleting!; setDeleting(null); void run(() => docsService.deletePage(p.id), 'Página apagada.') }} title="Apagar de vez?" message="A página, as que estão dentro dela, o histórico e as imagens serão apagados. Não dá para desfazer." confirmText="Apagar" variant="danger" />
    </div>
  )
}
