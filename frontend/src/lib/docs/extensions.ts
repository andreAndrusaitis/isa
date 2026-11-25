import { Node, mergeAttributes, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Highlight } from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { DocImage } from '@/components/docs/DocImage'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { callout: { setCallout: () => ReturnType } }
}

/** Caixa de destaque. Em Markdown vira citação. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'doc-callout' }), 0],
  addCommands() {
    return { setCallout: () => ({ commands }) => commands.wrapIn(this.name) }
  },
  renderMarkdown: (node, h) => h.renderChildren(node.content ?? [], '\n\n').split('\n').map((l: string) => `> ${l}`).join('\n'),
})

/** Só endereços que o navegador abre com segurança (nada de javascript:). */
const SAFE_LINK = /^(https?:|mailto:|\/)/i

/** O que o documento aceita: tudo fora disto é descartado ao colar ou importar. */
export function docExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false, // o histórico é o do Yjs: desfaz só o que a própria pessoa fez
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, isAllowedUri: url => SAFE_LINK.test(url.trim()), HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `Tarefa: ${node.textContent || 'sem texto'}` } }),
    TableKit.configure({ table: { resizable: true } }),
    Highlight,
    Callout,
    DocImage,
    Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Título' : 'Escreva, ou digite / para inserir'), showOnlyCurrent: true }),
    Markdown,
  ]
}
