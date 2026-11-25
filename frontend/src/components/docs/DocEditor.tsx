import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { docExtensions } from '@/lib/docs/extensions'
import { caretColor, type DocProvider } from '@/lib/docs/provider'
import { docsService } from '@/services/docsService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SlashCommand, slashItems } from './slash'
import { SelectionToolbar, TableToolbar } from './Toolbar'
import { PagePicker } from './PagePicker'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE = 10 * 1024 * 1024

export function DocEditor({ provider, pageId, spaceId, editable, user, onReady }: {
  provider: DocProvider; pageId: string; spaceId: string; editable: boolean; user: { id: string; name: string }; onReady?: (editor: Editor) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pickPage, setPickPage] = useState(false)
  const editorRef = useRef<Editor | null>(null)

  const upload = async (files: File[]) => {
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) { toast.error('Use imagens PNG, JPG, GIF ou WebP.'); continue }
      if (file.size > MAX_IMAGE) { toast.error('A imagem passa de 10 MB.'); continue }
      try {
        const a = await docsService.uploadAttachment(pageId, file)
        editorRef.current?.chain().focus().insertContent({ type: 'docImage', attrs: { attachmentId: a.id, alt: file.name } }).run()
      } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível enviar a imagem.')) }
    }
  }
  const uploadRef = useRef(upload)
  uploadRef.current = upload
  const images = (list?: FileList | null) => Array.from(list ?? []).filter(f => f.type.startsWith('image/'))

  const extensions = useMemo(() => [
    ...docExtensions(),
    Collaboration.configure({ document: provider.doc, field: 'default' }),
    CollaborationCaret.configure({ provider, user: { name: user.name, color: caretColor(user.id) } }),
    SlashCommand.configure({ items: slashItems({ pickImage: () => fileRef.current?.click(), pickPage: () => setPickPage(true) }) }),
  ], [provider, user.id, user.name])

  const editor = useEditor({
    extensions,
    editable,
    editorProps: {
      attributes: { class: 'doc-content', 'aria-label': 'Conteúdo da página', spellcheck: 'true' },
      handlePaste: (_v, e) => { const f = images(e.clipboardData?.files); if (!f.length) return false; void uploadRef.current(f); return true },
      handleDrop: (_v, e, _s, moved) => { const f = moved ? [] : images((e as DragEvent).dataTransfer?.files); if (!f.length) return false; e.preventDefault(); void uploadRef.current(f); return true },
    },
  }, [extensions])
  editorRef.current = editor

  useEffect(() => { if (editor && editor.isEditable !== editable) editor.setEditable(editable) }, [editor, editable])
  useEffect(() => { if (editor) onReady?.(editor) }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null
  return (
    <>
      {editable && <SelectionToolbar editor={editor} />}
      {editable && <TableToolbar editor={editor} />}
      <EditorContent editor={editor} />
      <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      {pickPage && <PagePicker spaceId={spaceId} onClose={() => setPickPage(false)} onPick={p => {
        setPickPage(false)
        editor.chain().focus().insertContent([{ type: 'text', text: `${p.icon ? `${p.icon} ` : ''}${p.title}`, marks: [{ type: 'link', attrs: { href: `/documentos/p/${p.id}` } }] }, { type: 'text', text: ' ' }]).run()
      }} />}
    </>
  )
}
