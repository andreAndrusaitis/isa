import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, FileText, PanelLeft, Plus, Search, Settings2, Trash2, Users } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { Btn, ConfirmModal, EmptyState, Loading, NavItem, PageHeader } from '@/components/ui'
import { PageTree } from '@/components/docs/PageTree'
import { PagePicker } from '@/components/docs/PagePicker'
import { ShareModal, SpaceModal } from '@/components/docs/ShareModal'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { docsService } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { connectSocket } from '@/services/socketService'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toastStore'
import { canEdit, type DocPageMeta, type DocSpace, type DocTreeNode } from '@/types/docs'
import { DocHome, DocTrash } from './DocLists'
import { DocPageView } from './DocPageView'

const LAST_SPACE = 'isa-docs-space'

export default function DocumentosPage() {
  const token = useAuthStore(s => s.accessToken)!
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isMobile = useMediaQuery('(max-width: 1024px)')
  const [sidebar, setSidebar] = useState(false)
  const [spaces, setSpaces] = useState<DocSpace[] | null>(null)
  const [spaceId, setSpaceId] = useState<string | null>(() => { try { return localStorage.getItem(LAST_SPACE) } catch { return null } })
  const [nodes, setNodes] = useState<DocTreeNode[]>([])
  const [pageId, setPageId] = useState<string | undefined>()
  const [spaceModal, setSpaceModal] = useState<'new' | 'edit' | null>(null)
  const [share, setShare] = useState(false)
  const [search, setSearch] = useState(false)
  const [picker, setPicker] = useState(false)
  const [deleting, setDeleting] = useState<DocTreeNode | null>(null)

  const space = spaces?.find(s => s.id === spaceId)
  const editable = canEdit(space?.role)

  const loadSpaces = useCallback(async () => {
    try {
      const list = await docsService.spaces()
      setSpaces(list)
      setSpaceId(id => (id && list.some(s => s.id === id) ? id : list[0]?.id ?? null))
    } catch (err) { setSpaces(s => s ?? []); toast.error(apiErrorMessage(err, 'Não foi possível carregar os espaços.')) }
  }, [])
  const loadTree = useCallback(() => {
    if (!spaceId) { setNodes([]); return Promise.resolve() }
    return docsService.tree(spaceId).then(setNodes).catch(() => setNodes([]))
  }, [spaceId])

  useEffect(() => { void loadSpaces() }, [loadSpaces])
  useEffect(() => { void loadTree(); if (spaceId) try { localStorage.setItem(LAST_SPACE, spaceId) } catch { /* sem armazenamento */ } }, [loadTree, spaceId])
  useEffect(() => { if (!pathname.startsWith('/documentos/p/')) setPageId(undefined); setSidebar(false) }, [pathname])

  // Árvore e espaços mudados por outras pessoas.
  useEffect(() => {
    const s = connectSocket(token)
    const join = () => { if (spaceId) s.emit('docspace:join', { spaceId }) }
    const onTree = (m: { spaceId: string }) => { if (m.spaceId === spaceId) void loadTree() }
    const onSpaces = () => { void loadSpaces() }
    s.on('connect', join)
    s.on('doc:tree', onTree)
    s.on('doc:spaces', onSpaces)
    s.on('docspace:revoked', onSpaces)
    if (s.connected) join()
    return () => {
      if (spaceId) s.emit('docspace:leave', { spaceId })
      s.off('connect', join); s.off('doc:tree', onTree); s.off('doc:spaces', onSpaces); s.off('docspace:revoked', onSpaces)
    }
  }, [token, spaceId, loadTree, loadSpaces])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    if (!picker) return
    const off = () => setPicker(false)
    document.addEventListener('click', off)
    return () => document.removeEventListener('click', off)
  }, [picker])

  const onMeta = useCallback((m: DocPageMeta | null) => { setPageId(m?.id); if (m) setSpaceId(m.spaceId) }, [])

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    try { await action() } catch (err) { toast.error(apiErrorMessage(err, fallback)); void loadTree() }
  }
  const create = (parentId: string | null, inSpace = spaceId) => attempt(async () => {
    const p = await docsService.createPage(inSpace!, { parentId })
    await loadTree()
    navigate(`/documentos/p/${p.id}`)
  }, 'Não foi possível criar a página.')
  const move = (id: string, parentId: string | null, position: number) => {
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, parentId, position } : n)))
    void attempt(() => docsService.movePage(id, { parentId, position }).then(loadTree), 'Não foi possível mover a página.')
  }

  const openSpace = async (s: DocSpace) => {
    setSpaceId(s.id)
    const tree = await docsService.tree(s.id).catch(() => [] as DocTreeNode[])
    const first = tree.filter(n => !n.parentId).sort((a, b) => a.position - b.position)[0]
    navigate(first ? `/documentos/p/${first.id}` : `/documentos/espaco/${s.id}`)
  }

  const header = useMemo(() => <AppHeader responsive panelToggle={<button type="button" className="icon-btn panel-toggle" aria-label="Páginas" aria-expanded={sidebar} onClick={() => setSidebar(o => !o)}><PanelLeft size={18} /></button>} />, [sidebar])
  if (!spaces) return <div className="app-shell">{header}<Loading label="Abrindo Documentos…" /></div>

  return (
    <div className="app-shell">
      {header}
      <div className="app-body">
        {isMobile && sidebar && <div className="drawer-backdrop" style={{ zIndex: 49 }} onClick={() => setSidebar(false)} aria-hidden="true" />}
        <aside className="nav-panel" aria-label="Navegação de Documentos" style={isMobile ? {
          position: 'fixed', inset: '0 auto 0 0', zIndex: 50, maxWidth: '86vw', transform: sidebar ? 'none' : 'translateX(-100%)', visibility: sidebar ? 'visible' : 'hidden', transition: 'transform .2s ease',
        } : undefined}>
          <nav>
            <NavItem icon={FileText} label="Início" active={pathname === '/documentos'} onClick={() => navigate('/documentos')} />
            <NavItem icon={Search} label="Buscar  (Ctrl K)" active={false} onClick={() => setSearch(true)} />
            <NavItem icon={Trash2} label="Lixeira" active={pathname === '/documentos/lixeira'} onClick={() => navigate('/documentos/lixeira')} />
            <div style={{ position: 'relative', margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: 2 }}>
              <button type="button" className="doc-space" aria-haspopup="menu" aria-expanded={picker} onClick={e => { e.stopPropagation(); setPicker(p => !p) }}>
                <span className="doc-icon">{space?.icon ?? '📘'}</span><span className="t">{space?.name ?? 'Escolher espaço'}</span><ChevronDown size={14} />
              </button>
              {space && <button type="button" className="icon-btn" aria-label="Pessoas do espaço" title="Pessoas do espaço" onClick={() => setShare(true)}><Users size={16} /></button>}
              {space?.role === 'owner' && <button type="button" className="icon-btn" aria-label="Editar espaço" title="Editar espaço" onClick={() => setSpaceModal('edit')}><Settings2 size={16} /></button>}
              {picker && (
                <div className="doc-pop" role="menu" style={{ left: 0, right: 0, maxHeight: 320, overflowY: 'auto' }}>
                  {spaces.map(s => <button key={s.id} type="button" role="menuitem" onClick={() => void openSpace(s)}><span className="doc-icon">{s.icon ?? '📘'}</span>{s.name}</button>)}
                  <button type="button" role="menuitem" onClick={() => setSpaceModal('new')}><Plus size={15} /> Novo espaço</button>
                </div>
              )}
            </div>
            {space && (
              <PageTree
                nodes={nodes}
                activeId={pageId}
                editable={editable}
                onCreate={p => void create(p)}
                onMove={move}
                onDuplicate={id => void attempt(() => docsService.duplicatePage(id).then(loadTree), 'Não foi possível duplicar.')}
                onDelete={setDeleting}
                onFavorite={n => void attempt(() => docsService.favorite(n.id, !n.favorite).then(loadTree), 'Não foi possível favoritar.')}
              />
            )}
          </nav>
        </aside>
        <div className="app-main">
          <Routes>
            <Route index element={<DocHome spaces={spaces} onNewSpace={() => setSpaceModal('new')} onOpenSpace={s => void openSpace(s)} />} />
            <Route path="lixeira" element={<DocTrash onChanged={() => void loadTree()} />} />
            <Route path="espaco/:id" element={<EmptySpace spaces={spaces} onSelect={setSpaceId} onCreate={id => void create(null, id)} />} />
            <Route path="p/:pageId" element={<DocPageView onMeta={onMeta} onChanged={() => void loadTree()} />} />
            <Route path="*" element={<Navigate to="/documentos" replace />} />
          </Routes>
        </div>
      </div>
      {spaceModal && (
        <SpaceModal
          space={spaceModal === 'edit' ? space : undefined}
          onClose={() => setSpaceModal(null)}
          onSaved={s => { const isNew = spaceModal === 'new'; setSpaceModal(null); void loadSpaces().then(() => { if (isNew) { setSpaceId(s.id); navigate(`/documentos/espaco/${s.id}`) } }) }}
          onArchived={() => { setSpaceModal(null); setSpaceId(null); void loadSpaces(); navigate('/documentos') }}
        />
      )}
      {share && space && <ShareModal space={space} onClose={() => setShare(false)} />}
      {search && <PagePicker title="Buscar em Documentos" onClose={() => setSearch(false)} onPick={p => { setSearch(false); navigate(`/documentos/p/${p.id}`) }} />}
      <ConfirmModal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Mover para a lixeira?" message={`"${deleting?.title}" e as páginas dentro dela vão para a lixeira. Dá para restaurar.`} confirmText="Mover" variant="danger" onConfirm={() => {
        const n = deleting!
        setDeleting(null)
        void attempt(async () => { await docsService.trashPage(n.id); await loadTree(); if (n.id === pageId) navigate('/documentos') }, 'Não foi possível excluir.')
      }} />
    </div>
  )
}

function EmptySpace({ spaces, onSelect, onCreate }: { spaces: DocSpace[]; onSelect: (id: string) => void; onCreate: (id: string) => void }) {
  const { id = '' } = useParams()
  const space = spaces.find(s => s.id === id)
  useEffect(() => { if (space) onSelect(space.id) }, [space?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!space) return <Navigate to="/documentos" replace />
  return (
    <div>
      <PageHeader title={`${space.icon ?? '📘'} ${space.name}`} subtitle={space.description ?? undefined} />
      <EmptyState icon={<FileText size={28} />} title="Este espaço ainda não tem páginas" desc={canEdit(space.role) ? 'Crie a primeira e comece a escrever.' : 'Quem edita o espaço ainda não criou páginas.'} action={canEdit(space.role) ? <Btn icon={<Plus size={15} />} onClick={() => onCreate(space.id)}>Nova página</Btn> : undefined} />
    </div>
  )
}
