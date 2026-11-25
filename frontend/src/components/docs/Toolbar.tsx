import { useState, type ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, Code, Columns3, Heading1, Heading2, Highlighter, Italic, Link2, List, ListChecks, Rows3, Strikethrough, Trash2, Underline as UnderlineIcon, Unlink } from 'lucide-react'

function Tool({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={on} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
}

/** Barra sobre o texto selecionado. */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const [link, setLink] = useState<string | null>(null)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), code: e.isActive('code'),
      highlight: e.isActive('highlight'), link: e.isActive('link'), h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), list: e.isActive('bulletList'), task: e.isActive('taskList'),
    }),
  })
  const c = () => editor.chain().focus()
  const applyLink = () => {
    const raw = (link ?? '').trim()
    if (!raw) c().extendMarkRange('link').unsetLink().run()
    else c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|\/)/i.test(raw) ? raw : `https://${raw}` }).run()
    setLink(null)
  }
  return (
    <BubbleMenu editor={editor} className="doc-bubble" shouldShow={({ editor: e, from, to }) => e.isEditable && from !== to && !e.isActive('docImage') && !e.isActive('codeBlock')} options={{ placement: 'top', offset: 8 }}>
      {link !== null ? (
        <form onSubmit={e => { e.preventDefault(); applyLink() }}>
          <input autoFocus value={link} onChange={e => setLink(e.target.value)} placeholder="Cole o endereço" aria-label="Endereço do link" onKeyDown={e => { if (e.key === 'Escape') setLink(null) }} />
          <button type="submit">Aplicar</button>
          {s.link && <Tool label="Remover link" onClick={() => { c().extendMarkRange('link').unsetLink().run(); setLink(null) }}><Unlink size={15} /></Tool>}
        </form>
      ) : (
        <>
          <Tool label="Título 1" on={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Tool>
          <Tool label="Título 2" on={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Tool>
          <i />
          <Tool label="Negrito" on={s.bold} onClick={() => c().toggleBold().run()}><Bold size={15} /></Tool>
          <Tool label="Itálico" on={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={15} /></Tool>
          <Tool label="Sublinhado" on={s.underline} onClick={() => c().toggleUnderline().run()}><UnderlineIcon size={15} /></Tool>
          <Tool label="Riscado" on={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={15} /></Tool>
          <Tool label="Código" on={s.code} onClick={() => c().toggleCode().run()}><Code size={15} /></Tool>
          <Tool label="Marca-texto" on={s.highlight} onClick={() => c().toggleHighlight().run()}><Highlighter size={15} /></Tool>
          <Tool label="Link" on={s.link} onClick={() => setLink(editor.getAttributes('link').href ?? '')}><Link2 size={15} /></Tool>
          <i />
          <Tool label="Lista" on={s.list} onClick={() => c().toggleBulletList().run()}><List size={16} /></Tool>
          <Tool label="Tarefas" on={s.task} onClick={() => c().toggleTaskList().run()}><ListChecks size={16} /></Tool>
        </>
      )}
    </BubbleMenu>
  )
}

/** Barra que aparece com o cursor dentro de uma tabela. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus()
  return (
    <BubbleMenu editor={editor} pluginKey="tableMenu" className="doc-bubble" shouldShow={({ editor: e, from, to }) => e.isEditable && from === to && e.isActive('table')} options={{ placement: 'bottom', offset: 10 }}>
      <Tool label="Adicionar linha abaixo" onClick={() => c().addRowAfter().run()}><Rows3 size={15} /><span>Linha</span></Tool>
      <Tool label="Adicionar coluna à direita" onClick={() => c().addColumnAfter().run()}><Columns3 size={15} /><span>Coluna</span></Tool>
      <Tool label="Excluir linha" onClick={() => c().deleteRow().run()}><span>Excluir linha</span></Tool>
      <Tool label="Excluir coluna" onClick={() => c().deleteColumn().run()}><span>Excluir coluna</span></Tool>
      <Tool label="Excluir tabela" onClick={() => c().deleteTable().run()}><Trash2 size={15} /></Tool>
    </BubbleMenu>
  )
}
