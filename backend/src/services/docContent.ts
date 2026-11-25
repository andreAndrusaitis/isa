/**
 * Conteúdo das páginas de Documentos: funções puras sobre o estado Yjs.
 * O editor (TipTap/ProseMirror) grava no XmlFragment 'default'.
 */
import * as Y from 'yjs'

export const DOC_FRAGMENT = 'default'
export const MAX_UPDATE_BYTES = 512 * 1024
export const MAX_YDOC_BYTES = 8 * 1024 * 1024
const MAX_TEXT = 200_000
const MAX_DEPTH = 100

/** Nós que ficam dentro da linha: não quebram o texto em blocos. */
const INLINE = new Set(['mention', 'hardBreak', 'emoji', 'pageLink', 'image'])

/** Texto que o Postgres aceita: sem NUL/controles e sem surrogate solto. */
export function cleanText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
}

export function docFromState(state: Uint8Array | null | undefined): Y.Doc {
  const doc = new Y.Doc()
  if (state && state.length) Y.applyUpdate(doc, state)
  return doc
}

export const encodeDoc = (doc: Y.Doc): Buffer => Buffer.from(Y.encodeStateAsUpdate(doc))

/** O update está íntegro? Decodifica tudo antes de tocar em qualquer documento. */
export function isValidUpdate(update: Uint8Array): boolean {
  try {
    Y.decodeUpdate(update)
    // decodeUpdate tolera sobra depois do fim; aplicar num documento vazio pega o resto.
    const probe = new Y.Doc()
    Y.applyUpdate(probe, update)
    probe.destroy()
    return true
  } catch {
    return false
  }
}

/** State vector vindo do cliente; inválido vira undefined (manda o documento todo). */
export function safeStateVector(value: unknown): Uint8Array | undefined {
  if (!(value instanceof Uint8Array) || value.length > 64 * 1024) return undefined
  try {
    Y.decodeStateVector(value)
    return value
  } catch {
    return undefined
  }
}

/** Texto corrido do documento, um bloco por linha, para a busca. Nunca lança. */
export function extractText(doc: Y.Doc): string {
  const out: string[] = []
  let length = 0
  const push = (s: string) => { if (length < MAX_TEXT) { out.push(s); length += s.length } }
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH || length >= MAX_TEXT) return
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert?: unknown }[]) if (typeof op.insert === 'string') push(op.insert)
      return
    }
    if (node instanceof Y.XmlElement) {
      const inline = INLINE.has(node.nodeName)
      const label = node.getAttribute('label') ?? (node.nodeName === 'image' ? node.getAttribute('alt') : undefined)
      if (node.nodeName === 'hardBreak') push('\n')
      else if (inline && typeof label === 'string') push(label)
      for (const child of node.toArray()) walk(child, depth + 1)
      if (!inline) push('\n')
    }
  }
  try {
    for (const child of doc.getXmlFragment(DOC_FRAGMENT).toArray()) walk(child, 0)
  } catch {
    // Fragmento de outro tipo (documento adulterado): sem texto para a busca.
    return ''
  }
  return cleanText(out.join('')).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, MAX_TEXT)
}

/**
 * Troca o conteúdo de `doc` pelo de `source` numa transação só. Devolve o update
 * gerado, que se junta ao que os outros estiverem digitando como qualquer edição.
 */
export function replaceContent(doc: Y.Doc, source: Y.Doc): Uint8Array {
  const before = Y.encodeStateVector(doc)
  const target = doc.getXmlFragment(DOC_FRAGMENT)
  const nodes = source.getXmlFragment(DOC_FRAGMENT).toArray()
    .map(n => (n as Y.XmlElement | Y.XmlText).clone() as Y.XmlElement | Y.XmlText)
  doc.transact(() => {
    if (target.length) target.delete(0, target.length)
    if (nodes.length) target.insert(0, nodes)
  })
  return Y.encodeStateAsUpdate(doc, before)
}

/** Troca textos dentro dos atributos dos nós (ids de anexo ao duplicar a página). */
export function replaceInAttributes(doc: Y.Doc, replacements: Map<string, string>): void {
  if (!replacements.size) return
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH || !(node instanceof Y.XmlElement)) return
    for (const [name, value] of Object.entries(node.getAttributes() as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      let next = value
      for (const [from, to] of replacements) next = next.split(from).join(to)
      if (next !== value) node.setAttribute(name, next)
    }
    for (const child of node.toArray()) walk(child, depth + 1)
  }
  doc.transact(() => {
    for (const child of doc.getXmlFragment(DOC_FRAGMENT).toArray()) walk(child, 0)
  })
}

// ── Montagem de conteúdo no servidor (seed) ──

export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: string[] }

/** Monta o estado Yjs a partir de nós no formato do ProseMirror (texto com marcas simples). */
export function buildDocState(nodes: DocNode[]): Buffer {
  const toOp = (n: DocNode) => ({ insert: n.text ?? '', attributes: Object.fromEntries((n.marks ?? []).map(m => [m, {}])) })
  const make = (n: DocNode): Y.XmlElement => {
    const el = new Y.XmlElement(n.type)
    for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v as string) // número/booleano também valem no Yjs
    const children: (Y.XmlElement | Y.XmlText)[] = []
    // Trechos vizinhos de texto viram um XmlText só, como o editor grava.
    let run: ReturnType<typeof toOp>[] | null = null
    for (const c of n.content ?? []) {
      if (c.type !== 'text') { run = null; children.push(make(c)); continue }
      if (!run) {
        run = []
        children.push(new Y.XmlText())
      }
      run.push(toOp(c))
      const text = new Y.XmlText()
      text.applyDelta(run)
      children[children.length - 1] = text
    }
    if (children.length) el.insert(0, children)
    return el
  }
  const doc = new Y.Doc()
  doc.getXmlFragment(DOC_FRAGMENT).insert(0, nodes.map(make))
  return encodeDoc(doc)
}
