import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Clock, CloudOff, Download, History, Lock, MoreHorizontal, Star, Trash2, Upload } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { Btn, ConfirmModal, EmptyState, Loading } from '@/components/ui'
import { DocEditor } from '@/components/docs/DocEditor'
import { IconPicker } from '@/components/docs/IconPicker'
import { VersionPreview, VersionsPanel } from '@/components/docs/VersionsPanel'
import { DocProvider } from '@/lib/docs/provider'
import { docsService } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { getSocket } from '@/services/socketService'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toastStore'
import { canEdit, type DocPageMeta } from '@/types/docs'

const initials = (name: string) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

export function DocPageView({ onMeta, onChanged }: { onMeta: (m: DocPageMeta | null) => void; onChanged: () => void }) {
  const { pageId = '' } = useParams()
  const user = useAuthStore(s => s.user)!
  const token = useAuthStore(s => s.accessToken)!
  const navigate = useNavigate()
  const [meta, setMeta] = useState<DocPageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<DocProvider | null>(null)
  const [, tick] = useState(0)
  const [versions, setVersions] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const tokenRef = useRef(token)
  tokenRef.current = token

  const load = useCallback(async () => {
    try {
      const m = await docsService.page(pageId)
      setMeta(m); setTitle(t => (document.activeElement === titleRef.current ? t : m.title)); setError(null); onMeta(m)
    } catch (err) { setMeta(null); setError(apiErrorMessage(err, 'Não foi possível abrir a página.')) }
  }, [pageId, onMeta])

  useEffect(() => {
    setMeta(null); setError(null); setVersions(false); setVersion(null)
    void load()
    const p = new DocProvider(pageId, tokenRef.current, () => tick(n => n + 1))
    setProvider(p)
    return () => { p.destroy(); setProvider(null) }
  }, [pageId, load])

  // Título e ícone mudados por outra pessoa.
  useEffect(() => {
    const s = getSocket()
    const onDocMeta = (m: { pageId: string; title: string; icon: string | null }) => {
      if (m.pageId !== pageId) return
      setMeta(old => (old ? { ...old, title: m.title, icon: m.icon } : old))
      if (document.activeElement !== titleRef.current) setTitle(m.title)
    }
    s?.on('doc:meta', onDocMeta)
    return () => { s?.off('doc:meta', onDocMeta) }
  }, [pageId, provider])

  useEffect(() => { const el = titleRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }, [title, meta])
  useEffect(() => { if (meta) document.title = `${meta.title} · ISA` ; return () => { document.title = 'ISA' } }, [meta?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return
    const off = () => setMenu(false)
    document.addEventListener('click', off)
    return () => document.removeEventListener('click', off)
  }, [menu])

  const role = provider?.role ?? meta?.role
  const editable = canEdit(role) && provider?.status !== 'revoked'

  const saveMeta = async (input: { title?: string; icon?: string | null }) => {
    try { await docsService.updatePage(pageId, input); onChanged() }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível salvar.')) }
  }
  const changeTitle = (v: string) => {
    const clean = v.replace(/\n/g, ' ').slice(0, 200)
    setTitle(clean)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveMeta({ title: clean }), 600)
  }

  const exportMd = () => {
    const md = editorRef.current?.getMarkdown() ?? ''
    const url = URL.createObjectURL(new Blob([`# ${meta!.title}\n\n${md}\n`], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${meta!.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'pagina'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  const importMd = async (file: File) => {
    if (file.size > 1024 * 1024) { toast.error('O arquivo passa de 1 MB.'); return }
    editorRef.current?.chain().focus('end').insertContent(await file.text(), { contentType: 'markdown' }).run()
    toast.success('Texto importado no fim da página.')
  }
  const toggleFavorite = async () => {
    const on = !meta!.favorite
    setMeta(m => (m ? { ...m, favorite: on } : m))
    try { await docsService.favorite(pageId, on); onChanged() } catch (err) { setMeta(m => (m ? { ...m, favorite: !on } : m)); toast.error(apiErrorMessage(err, 'Não foi possível favoritar.')) }
  }
  const trash = async () => {
    setConfirmTrash(false)
    try { await docsService.trashPage(pageId); toast.success('Página na lixeira.'); onChanged(); navigate('/documentos') }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível excluir.')) }
  }

  if (error) return <div className="doc-page"><EmptyState icon={<Lock size={28} />} title="Página indisponível" desc={error} /></div>
  if (!meta || !provider) return <div className="doc-page"><Loading label="Abrindo página…" /></div>

  const people = [...new Map([...provider.awareness.getStates().entries()]
    .filter(([id, s]) => id !== provider.doc.clientID && s.user)
    .map(([, s]) => [s.user.name as string, s.user as { name: string; color: string }])).values()]

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="doc-page">
        <div className="doc-bar">
          <div className="doc-crumbs">
            <span>{meta.space.icon ?? '📘'} {meta.space.name}</span>
            {meta.breadcrumb.map(b => <span key={b.id}>/ <Link to={`/documentos/p/${b.id}`}>{b.title}</Link></span>)}
          </div>
          <div style={{ flex: 1 }} />
          {provider.status === 'offline' && <span role="status" style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--warning)' }}><CloudOff size={15} /> Sem conexão</span>}
          {provider.status === 'connecting' && <span role="status">Conectando…</span>}
          {provider.rejected && <span role="alert" style={{ color: 'var(--danger)' }}>Última mudança não foi salva</span>}
          {provider.status === 'synced' && editable && !provider.rejected && <span role="status" className="hide-on-tablet">{provider.pending ? 'Salvando…' : 'Salvo'}</span>}
          {!editable && provider.status === 'synced' && <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Lock size={14} /> Só leitura</span>}
          {people.length > 0 && <div className="doc-people" aria-label={`Na página: ${people.map(p => p.name).join(', ')}`}>{people.slice(0, 5).map(p => <span key={p.name} title={p.name} style={{ background: p.color }}>{initials(p.name)}</span>)}</div>}
          <button type="button" className="icon-btn" aria-label={meta.favorite ? 'Tirar dos favoritos' : 'Favoritar'} aria-pressed={meta.favorite} onClick={toggleFavorite}><Star size={17} fill={meta.favorite ? 'currentColor' : 'none'} /></button>
          <button type="button" className="icon-btn" aria-label="Histórico" aria-pressed={versions} onClick={() => { setVersions(v => !v); setVersion(null) }}><History size={17} /></button>
          <div style={{ position: 'relative' }}>
            <button type="button" className="icon-btn" aria-label="Mais opções" aria-haspopup="menu" onClick={e => { e.stopPropagation(); setMenu(m => !m) }}><MoreHorizontal size={17} /></button>
            {menu && (
              <div className="doc-pop" role="menu">
                <button type="button" role="menuitem" onClick={exportMd}><Download size={15} /> Exportar Markdown</button>
                {editable && <button type="button" role="menuitem" onClick={() => importRef.current?.click()}><Upload size={15} /> Importar Markdown</button>}
                {editable && <button type="button" role="menuitem" className="danger" onClick={() => setConfirmTrash(true)}><Trash2 size={15} /> Mover para a lixeira</button>}
              </div>
            )}
          </div>
        </div>
        {provider.status === 'revoked' && <div className="doc-note" role="alert"><Lock size={16} /> Você não tem mais acesso a esta página, ou ela foi excluída. O texto abaixo é o último que chegou.</div>}
        {version && <div className="doc-note" role="status"><Clock size={16} /> Você está vendo uma versão antiga. <Btn size="xs" variant="secondary" onClick={() => setVersion(null)}>Voltar à atual</Btn></div>}
        <article className="doc-sheet">
          <IconPicker value={meta.icon} disabled={!editable} label="Ícone da página" onChange={icon => { setMeta(m => (m ? { ...m, icon } : m)); void saveMeta({ icon }) }} />
          <textarea
            ref={titleRef}
            className="doc-title"
            rows={1}
            value={title}
            readOnly={!editable}
            aria-label="Título da página"
            placeholder="Sem título"
            onChange={e => changeTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); editorRef.current?.commands.focus('start') } }}
          />
          {version ? <VersionPreview versionId={version} /> : (
            <DocEditor key={pageId} provider={provider} pageId={pageId} spaceId={meta.spaceId} editable={editable} user={user} onReady={e => { editorRef.current = e }} />
          )}
        </article>
        <input ref={importRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importMd(f); e.target.value = '' }} />
      </div>
      {versions && <VersionsPanel pageId={pageId} selected={version} editable={editable} onSelect={setVersion} onClose={() => { setVersions(false); setVersion(null) }} onRestored={() => setVersion(null)} />}
      <ConfirmModal isOpen={confirmTrash} onClose={() => setConfirmTrash(false)} onConfirm={trash} title="Mover para a lixeira?" message="As páginas dentro dela vão junto. Dá para restaurar pela lixeira." confirmText="Mover" variant="danger" />
    </div>
  )
}
