/**
 * Evidência de um chamado para os agentes: título e descrição mascarados,
 * campos de formulário especial, trechos de anexos de texto, até 3 imagens e os
 * nomes de todos os arquivos. PDF/Office entram só pelo nome por enquanto.
 */
import { blobEnabled, getContainerClient } from '../../config/blob'
import { ALLOWED_TYPES, isBlobName, resolveAttachmentMime } from '../../services/uploads'
import type { ChatContent } from './llm'
import { maskPII, sanitizeForModel } from './masking'

export interface Evidence {
  /** Texto mascarado enviado ao modelo — também é a fonte das citações. */
  text: string
  /** "Categoria > Subcategoria" escolhida pelo cliente (null se não escolheu). */
  userCategory: string | null
  fileNames: string[]
  /** Imagens como data URI (máx. 3). Prints podem ter dados pessoais: ver aval do jurídico. */
  images: string[]
}

export interface TicketForEvidence {
  title: string
  description: string | null
  special_data: unknown
  category: { name: string } | null
  subcategory: { name: string } | null
  attachments: { name: string; url: string }[]
  /** Print do wizard de abertura, gravado direto no chamado (nome de blob ou data URI). */
  attachment_url?: string | null
}

export type ReadBlob = (value: string) => Promise<Buffer | null>

const MAX_IMAGES = 3
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TEXT_FILE_CHARS = 2000
// Título sem limite no banco (já houve de 100 KB): ia inteiro em cada pergunta ao modelo.
const MAX_TITLE_CHARS = 500
const TEXT_MIME = new Set(['text/plain', 'text/log', 'text/csv', 'application/json'])

export async function readAttachment(value: string): Promise<Buffer | null> {
  if (value.startsWith('data:')) return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  if (!blobEnabled || !isBlobName(value)) return null
  return getContainerClient().getBlockBlobClient(value).downloadToBuffer()
}

/** Nome legível do anexo do wizard: último segmento do caminho, ou 'anexo.<ext>' para data URI. */
function wizardAttachmentName(value: string): string {
  if (!value.startsWith('data:')) return value.split('?')[0].split('/').pop() || 'anexo'
  const mime = value.slice(5, value.search(/[;,]/)).toLowerCase()
  return `anexo.${ALLOWED_TYPES[mime] ?? 'bin'}`
}

function specialDataText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('\n')
}

export async function buildEvidence(t: TicketForEvidence, readBlob: ReadBlob = readAttachment): Promise<Evidence> {
  const parts = [
    `Título: ${maskPII(t.title.slice(0, MAX_TITLE_CHARS))}`,
    `Descrição: ${sanitizeForModel(t.description || specialDataText(t.special_data))}`,
  ]
  const files = [...t.attachments]
  if (t.attachment_url && !files.some(a => a.url === t.attachment_url)) {
    files.unshift({ name: wizardAttachmentName(t.attachment_url), url: t.attachment_url })
  }
  const images: string[] = []
  for (const a of files) {
    const mime = resolveAttachmentMime(a.name)
    if (!mime) continue
    const isImage = mime.startsWith('image/')
    if (isImage ? images.length >= MAX_IMAGES : !TEXT_MIME.has(mime)) continue
    const buf = await readBlob(a.url).catch(() => null)
    if (!buf || buf.length > MAX_FILE_BYTES) continue
    if (isImage) images.push(`data:${mime};base64,${buf.toString('base64')}`)
    else parts.push(`Trecho do anexo ${a.name}: ${maskPII(buf.toString('utf8').slice(0, MAX_TEXT_FILE_CHARS))}`)
  }
  return {
    text: parts.join('\n'),
    userCategory: t.category ? [t.category.name, t.subcategory?.name].filter(Boolean).join(' > ') : null,
    fileNames: files.map(a => a.name),
    images,
  }
}

/** Bloco do chamado para a mensagem do modelo (texto + imagens). */
export function evidenceContent(e: Evidence, showUserCategory: boolean): ChatContent {
  const lines = [e.text]
  if (showUserCategory && e.userCategory) lines.push(`Categoria escolhida pelo cliente: ${e.userCategory}`)
  if (e.fileNames.length) lines.push(`Arquivos anexados: ${e.fileNames.join(', ')}`)
  return [
    { type: 'text', text: `<chamado>\n${lines.join('\n')}\n</chamado>` },
    ...e.images.map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
  ]
}
