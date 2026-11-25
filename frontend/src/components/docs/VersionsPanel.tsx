import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import { X } from 'lucide-react'
import { Btn, ConfirmModal, Loading } from '@/components/ui'
import { docExtensions } from '@/lib/docs/extensions'
import { docsService } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import type { DocVersion } from '@/types/docs'

const when = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Conteúdo de uma versão, só leitura. */
export function VersionPreview({ versionId }: { versionId: string }) {
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  useEffect(() => {
    let alive = true
    let made: Y.Doc | null = null
    setDoc(null)
    docsService.versionBytes(versionId).then(b => {
      if (!alive) return
      made = new Y.Doc()
      Y.applyUpdate(made, b)
      setDoc(made)
    }).catch(err => toast.error(apiErrorMessage(err, 'Não foi possível abrir a versão.')))
    return () => { alive = false; made?.destroy() }
  }, [versionId])
  return doc ? <Frozen key={versionId} doc={doc} /> : <Loading size="compact" label="Abrindo versão…" />
}

function Frozen({ doc }: { doc: Y.Doc }) {
  const extensions = useMemo(() => [...docExtensions(), Collaboration.configure({ document: doc, field: 'default' })], [doc])
  const editor = useEditor({ extensions, editable: false, editorProps: { attributes: { class: 'doc-content', 'aria-label': 'Versão da página' } } }, [extensions])
  return <EditorContent editor={editor} />
}

export function VersionsPanel({ pageId, selected, editable, onSelect, onClose, onRestored }: {
  pageId: string; selected: string | null; editable: boolean; onSelect: (id: string | null) => void; onClose: () => void; onRestored: () => void
}) {
  const [items, setItems] = useState<DocVersion[] | null>(null)
  const [confirm, setConfirm] = useState(false)
  const load = useCallback(() => docsService.versions(pageId).then(setItems).catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar o histórico.'))), [pageId])
  useEffect(() => { void load() }, [load])
  const restore = async () => {
    setConfirm(false)
    try { await docsService.restoreVersion(pageId, selected!); toast.success('Versão restaurada. O texto anterior ficou no histórico.'); onRestored(); void load() }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível restaurar a versão.')) }
  }
  const saveNow = async () => {
    try { await docsService.saveVersion(pageId, 'Salva à mão'); await load() } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível salvar a versão.')) }
  }
  return (
    <aside className="doc-versions" aria-label="Histórico da página">
      <header>Histórico<button type="button" className="icon-btn" aria-label="Fechar histórico" onClick={onClose}><X size={16} /></button></header>
      <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
        {editable && <Btn size="sm" variant="secondary" onClick={saveNow}>Salvar versão agora</Btn>}
        {selected && editable && <Btn size="sm" onClick={() => setConfirm(true)}>Restaurar esta versão</Btn>}
      </div>
      {!items ? <Loading size="compact" /> : (
        <ul style={{ margin: 0, padding: 0 }}>
          <li aria-current={selected === null ? 'true' : undefined} onClick={() => onSelect(null)}><b style={{ fontWeight: 600 }}>Agora</b><small>Versão em edição</small></li>
          {items.map(v => (
            <li key={v.id} aria-current={selected === v.id ? 'true' : undefined}>
              <button type="button" onClick={() => onSelect(v.id)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 2 }}>
                <b style={{ fontWeight: 500 }}>{when(v.createdAt)}</b>
                <small>{[v.label, v.createdBy?.name].filter(Boolean).join(' · ') || 'Automática'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items?.length === 0 && <p style={{ fontSize: 13.5, color: 'var(--text-3)', padding: '0 10px' }}>As versões são salvas sozinhas enquanto a página é editada.</p>}
      <ConfirmModal isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={restore} title="Restaurar esta versão?" message="O texto atual vira uma versão no histórico e a página passa a mostrar esta, para todos." confirmText="Restaurar" variant="warning" />
    </aside>
  )
}
