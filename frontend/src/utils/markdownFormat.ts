/**
 * Formatação rápida de Markdown sobre o texto selecionado. Função pura: recebe o
 * texto e a seleção e devolve o trecho a trocar e a seleção final, para o editor
 * aplicar pelo campo sem perder o Ctrl+Z.
 */
export type MarkdownAction = 'bold' | 'italic' | 'strike' | 'code' | 'heading' | 'bullet' | 'numbered' | 'quote' | 'link'

export interface MarkdownEdit {
  from: number
  to: number
  text: string
  selStart: number
  selEnd: number
}

const WRAP: Partial<Record<MarkdownAction, { mark: string; sample: string }>> = {
  bold: { mark: '**', sample: 'texto em negrito' },
  italic: { mark: '_', sample: 'texto em itálico' },
  strike: { mark: '~~', sample: 'texto riscado' },
  code: { mark: '`', sample: 'código' },
}

function wrap(value: string, start: number, end: number, mark: string, sample: string): MarkdownEdit {
  // Espaço nas pontas fica fora das marcas: "** texto **" não vira negrito.
  const raw = value.slice(start, end)
  const from = start + (raw.length - raw.trimStart().length)
  const to = end - (raw.length - raw.trimEnd().length)
  const selected = value.slice(from, to)

  // Já formatado: desfaz, com as marcas dentro ou em volta da seleção.
  if (selected.length > 2 * mark.length && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, -mark.length)
    return { from, to, text: inner, selStart: from, selEnd: from + inner.length }
  }
  if (selected && value.slice(from - mark.length, from) === mark && value.slice(to, to + mark.length) === mark) {
    return { from: from - mark.length, to: to + mark.length, text: selected, selStart: from - mark.length, selEnd: to - mark.length }
  }

  const inner = selected || sample
  return { from, to, text: `${mark}${inner}${mark}`, selStart: from + mark.length, selEnd: from + mark.length + inner.length }
}

const LINE_PREFIX: Partial<Record<MarkdownAction, RegExp>> = {
  heading: /^## /,
  bullet: /^- /,
  numbered: /^\d+\. /,
  quote: /^> /,
}

function prefixFor(action: MarkdownAction, n: number) {
  if (action === 'heading') return '## '
  if (action === 'bullet') return '- '
  if (action === 'quote') return '> '
  return `${n}. `
}

function toggleLines(value: string, start: number, end: number, action: MarkdownAction): MarkdownEdit {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end)
  const to = lineEnd === -1 ? value.length : lineEnd
  const lines = value.slice(from, to).split('\n')
  const prefix = LINE_PREFIX[action]!
  const filled = lines.filter((l) => l.trim())
  const remove = filled.length > 0 && filled.every((l) => prefix.test(l))

  let n = 0
  const text = lines.map((line) => {
    if (!line.trim()) return line
    if (remove) return line.replace(prefix, '')
    n += 1
    return prefixFor(action, n) + line.replace(/^(#{1,6} |- |\d+\. |> )/, '')
  }).join('\n')

  return { from, to, text, selStart: from, selEnd: from + text.length }
}

function link(value: string, start: number, end: number): MarkdownEdit {
  const selected = value.slice(start, end).trim()
  if (/^https?:\/\/\S+$/i.test(selected)) {
    const text = `[texto do link](${selected})`
    return { from: start, to: end, text, selStart: start + 1, selEnd: start + 'texto do link'.length + 1 }
  }
  const label = selected || 'texto do link'
  const text = `[${label}](https://)`
  // Deixa o endereço selecionado: é o que a pessoa vai digitar em seguida.
  const urlStart = start + label.length + 3
  return { from: start, to: end, text, selStart: urlStart, selEnd: urlStart + 'https://'.length }
}

export function applyMarkdown(value: string, start: number, end: number, action: MarkdownAction): MarkdownEdit {
  const w = WRAP[action]
  if (w) return wrap(value, start, end, w.mark, w.sample)
  if (action === 'link') return link(value, start, end)
  return toggleLines(value, start, end, action)
}
