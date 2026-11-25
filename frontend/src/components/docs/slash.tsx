import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { CheckSquare, Code2, Heading1, Heading2, Heading3, Image, Info, Link2, List, ListOrdered, Minus, Pilcrow, Quote, Table as TableIcon, type LucideIcon } from 'lucide-react'

export interface SlashItem { title: string; hint: string; keys: string; icon: LucideIcon; run: (editor: Editor, range: Range) => void }

const block = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => (editor: Editor, range: Range) => { fn(editor.chain().focus().deleteRange(range)).run() }

export function slashItems(hooks: { pickImage: () => void; pickPage: () => void }): SlashItem[] {
  return [
    { title: 'Texto', hint: 'Parágrafo simples', keys: 'texto paragrafo p', icon: Pilcrow, run: block(c => c.setParagraph()) },
    { title: 'Título 1', hint: 'Seção principal', keys: 'titulo h1 #', icon: Heading1, run: block(c => c.setHeading({ level: 1 })) },
    { title: 'Título 2', hint: 'Subseção', keys: 'titulo h2 ##', icon: Heading2, run: block(c => c.setHeading({ level: 2 })) },
    { title: 'Título 3', hint: 'Detalhe', keys: 'titulo h3 ###', icon: Heading3, run: block(c => c.setHeading({ level: 3 })) },
    { title: 'Lista', hint: 'Com marcadores', keys: 'lista marcadores bullet -', icon: List, run: block(c => c.toggleBulletList()) },
    { title: 'Lista numerada', hint: 'Passo a passo', keys: 'lista numerada ordem 1.', icon: ListOrdered, run: block(c => c.toggleOrderedList()) },
    { title: 'Tarefas', hint: 'Caixas para marcar', keys: 'tarefas todo checklist []', icon: CheckSquare, run: block(c => c.toggleTaskList()) },
    { title: 'Tabela', hint: '3 por 3, ajustável', keys: 'tabela table', icon: TableIcon, run: block(c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    { title: 'Destaque', hint: 'Caixa de aviso', keys: 'destaque callout aviso nota', icon: Info, run: block(c => c.setCallout()) },
    { title: 'Citação', hint: 'Trecho citado', keys: 'citacao quote >', icon: Quote, run: block(c => c.toggleBlockquote()) },
    { title: 'Código', hint: 'Bloco de código', keys: 'codigo code ```', icon: Code2, run: block(c => c.toggleCodeBlock()) },
    { title: 'Divisória', hint: 'Linha entre seções', keys: 'divisoria linha hr ---', icon: Minus, run: block(c => c.setHorizontalRule()) },
    { title: 'Imagem', hint: 'Do seu computador', keys: 'imagem foto image', icon: Image, run: (e, r) => { e.chain().focus().deleteRange(r).run(); hooks.pickImage() } },
    { title: 'Link para página', hint: 'Outra página daqui', keys: 'link pagina documento', icon: Link2, run: (e, r) => { e.chain().focus().deleteRange(r).run(); hooks.pickPage() } },
  ]
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = plain(query.trim())
  return q ? items.filter(i => plain(`${i.title} ${i.keys}`).includes(q)) : items
}

interface MenuRef { onKeyDown: (e: KeyboardEvent) => boolean }

const Menu = forwardRef<MenuRef, SuggestionProps<SlashItem>>(function Menu({ items, command }, ref) {
  const [at, setAt] = useState(0)
  useEffect(() => setAt(0), [items])
  useEffect(() => { document.getElementById(`slash-${at}`)?.scrollIntoView?.({ block: 'nearest' }) }, [at])
  useImperativeHandle(ref, () => ({
    onKeyDown: e => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') { setAt(i => (i + 1) % items.length); return true }
      if (e.key === 'ArrowUp') { setAt(i => (i + items.length - 1) % items.length); return true }
      if (e.key === 'Enter' || e.key === 'Tab') { command(items[at]); return true }
      return false
    },
  }), [items, at, command])
  if (!items.length) return <div className="doc-menu"><p>Nada encontrado</p></div>
  return (
    <div className="doc-menu" role="listbox" aria-label="Inserir">
      {items.map((item, i) => (
        <button key={item.title} id={`slash-${i}`} type="button" role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onMouseDown={e => { e.preventDefault(); command(item) }}>
          <item.icon size={17} strokeWidth={1.8} aria-hidden />
          <span><b>{item.title}</b>{item.hint}</span>
        </button>
      ))}
    </div>
  )
})

function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const h = Math.min(el.offsetHeight || 320, 340)
  const below = rect.bottom + 6 + h < window.innerHeight
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`
  el.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - h - 6)}px`
}

/** Menu "/" do editor. */
export const SlashCommand = Extension.create<{ items: SlashItem[] }>({
  name: 'slashCommand',
  addOptions: () => ({ items: [] }),
  addProseMirrorPlugins() {
    return [Suggestion<SlashItem>({
      editor: this.editor,
      char: '/',
      allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
      items: ({ query }) => filterSlash(this.options.items, query),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: () => {
        let view: ReactRenderer<MenuRef, SuggestionProps<SlashItem>> | null = null
        const update = (p: SuggestionProps<SlashItem>) => { if (view) requestAnimationFrame(() => view && place(view.element as HTMLElement, p.clientRect?.())) }
        const close = () => { view?.element.remove(); view?.destroy(); view = null }
        return {
          onStart: p => {
            view = new ReactRenderer(Menu, { props: p, editor: p.editor })
            ;(view.element as HTMLElement).classList.add('doc-floating')
            document.body.appendChild(view.element)
            update(p)
          },
          onUpdate: p => { view?.updateProps(p); update(p) },
          onKeyDown: ({ event }) => { if (event.key === 'Escape') { close(); return true } return view?.ref?.onKeyDown(event) ?? false },
          onExit: close,
        }
      },
    })]
  },
})
