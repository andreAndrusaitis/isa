import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { Btn } from '@/components/ui'
import { applyMarkdown, type MarkdownAction } from '@/utils/markdownFormat'
import './projects.css'

const TOOLS: Array<{ action: MarkdownAction; label: string; icon: typeof Bold; shortcut?: string } | 'sep'> = [
  { action: 'bold', label: 'Negrito', icon: Bold, shortcut: 'Ctrl+B' },
  { action: 'italic', label: 'Itálico', icon: Italic, shortcut: 'Ctrl+I' },
  { action: 'strike', label: 'Riscado', icon: Strikethrough },
  'sep',
  { action: 'heading', label: 'Título', icon: Heading2 },
  { action: 'bullet', label: 'Lista', icon: List },
  { action: 'numbered', label: 'Lista numerada', icon: ListOrdered },
  { action: 'quote', label: 'Citação', icon: Quote },
  'sep',
  { action: 'link', label: 'Link', icon: Link2, shortcut: 'Ctrl+K' },
  { action: 'code', label: 'Código', icon: Code },
]

const SHORTCUTS: Record<string, MarkdownAction> = { b: 'bold', i: 'italic', k: 'link' }
/**
 * Editor de Markdown com barra de formatação: age sobre o texto selecionado, como
 * num editor de texto. Salvar e cancelar são botões: clicar na barra tira o foco
 * do campo, então "clique fora para salvar" gravaria no meio da edição.
 */
export function MarkdownEditor({ value, onChange, onSave, onCancel, renderPreview, minHeight = 200, placeholder, label = 'Texto' }: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  /** Devolve o HTML já sanitizado. */
  renderPreview: (value: string) => string
  /** Altura com que o campo abre: a do texto em leitura, para a área não encolher. */
  minHeight?: number
  placeholder?: string
  label?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const [dirtyAtOpen] = useState(value)

  // O campo cresce com o texto até o limite; depois disso ele rola.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight + 2, minHeight)}px`
  }, [value, minHeight, preview])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  function format(action: MarkdownAction) {
    const el = ref.current
    if (!el) return
    const edit = applyMarkdown(el.value, el.selectionStart, el.selectionEnd, action)
    el.focus()
    el.setSelectionRange(edit.from, edit.to)
    // insertText mantém o Ctrl+Z do navegador; onde não existe, troca direto.
    if (!document.execCommand?.('insertText', false, edit.text)) el.setRangeText(edit.text, edit.from, edit.to, 'end')
    onChange(el.value)
    el.setSelectionRange(edit.selStart, edit.selEnd)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey
    const action = mod && !e.altKey ? SHORTCUTS[e.key.toLowerCase()] : undefined
    if (action) { e.preventDefault(); format(action); return }
    if (mod && e.key === 'Enter') { e.preventDefault(); onSave(); return }
    if (e.key === 'Escape') {
      // Esc não fecha o painel no meio da edição, e só sai sem perguntar se nada mudou.
      e.preventDefault()
      if (value === dirtyAtOpen) onCancel()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div role="toolbar" aria-label="Formatação do texto" className="md-bar">
          {TOOLS.map((tool, i) => (tool === 'sep'
            ? <i key={`sep-${i}`} aria-hidden="true" />
            : (
              <button
                key={tool.action}
                type="button"
                className="icon-act"
                disabled={preview}
                aria-label={tool.label}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                // Clicar na barra não pode tirar a seleção do campo.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(tool.action)}
              >
                <tool.icon size={15} aria-hidden="true" />
              </button>
            )))}
          <span style={{ flex: 1 }} />
          <button type="button" className="pj-link" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
            {preview ? 'Voltar ao texto' : 'Pré-visualizar'}
          </button>
        </div>

        {preview ? (
          <div
            className="markdown-body"
            style={{ minHeight, maxHeight: '60vh', overflowY: 'auto', padding: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)', boxSizing: 'border-box', borderBlock: '1px solid var(--border)' }}
            dangerouslySetInnerHTML={{ __html: renderPreview(value) }}
          />
        ) : (
          <textarea
            ref={ref}
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="md-area"
            style={{ minHeight }}
          />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Selecione o texto e use a barra. Ctrl+Enter salva.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={onCancel}>Cancelar</Btn>
          <Btn variant="primary" size="sm" onClick={onSave}>Salvar</Btn>
        </div>
      </div>
    </div>
  )
}
