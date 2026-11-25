/**
 * Utilitários de anexos.
 *
 * Os anexos podem chegar como:
 *  - data URI base64 (legado): `data:image/png;base64,...`
 *  - URL assinada do Azure Blob (SAS): `https://...blob.core.windows.net/...nome.png?sv=...&sig=...`
 *
 * Por isso a detecção de imagem não pode depender só do prefixo `data:`.
 */

import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react'
import { isTeamsHost, openInTeams } from '@/teams/teamsContext'

const IMAGE_EXT_RE =/\.(png|jpe?g|gif|webp|bmp)$/i

/**
 * Extensões de anexo aceitas — espelha o `ALLOWED_TYPES` do backend
 * (`backend/src/services/uploads.ts`). Mantê-las em sincronia evita que o
 * usuário envie um arquivo que o servidor recusará com 400/500.
 */
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'log', 'csv', 'json', 'zip', 'rar',
] as const

/** Rótulo amigável dos tipos aceitos para exibir ao usuário. */
export const ALLOWED_ATTACHMENT_LABEL = 'Imagens, PDF, Word, Excel, PowerPoint, TXT, LOG, CSV, JSON, ZIP, RAR'

/** Limite de tamanho por anexo — espelha `MAX_BYTES` do backend (10 MB). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Atributo `accept` do <input type="file"> derivado do allowlist. */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map(e => `.${e}`).join(',')

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Valida um arquivo de anexo (extensão + tamanho).
 * Retorna uma mensagem de erro pronta para exibir, ou `null` se o arquivo é válido.
 */
export function validateAttachment(file: File): string | null {
  const ext = getExtension(file.name)
  if (!ext) {
    return `"${file.name}" não tem uma extensão reconhecida. Tipos aceitos: ${ALLOWED_ATTACHMENT_LABEL}.`
  }
  if (!(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Arquivos .${ext} não são permitidos ("${file.name}"). Tipos aceitos: ${ALLOWED_ATTACHMENT_LABEL}.`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" excede o limite de 10 MB.`
  }
  return null
}

/**
 * Filtra uma lista de arquivos, mantendo apenas os válidos e chamando `onReject`
 * com uma mensagem por arquivo recusado. Usar ao adicionar arquivos (input/drop)
 * para que anexos inválidos nunca cheguem ao backend.
 */
export function filterValidAttachments(files: File[], onReject: (message: string) => void): File[] {
  const valid: File[] = []
  for (const file of files) {
    const error = validateAttachment(file)
    if (error) onReject(error)
    else valid.push(file)
  }
  return valid
}

/** Dica exibida perto dos campos que aceitam colar/arrastar prints. */
export const PASTE_HINT = 'Cole (Ctrl+V) ou arraste um print aqui'

const pad = (n: number) => String(n).padStart(2, '0')

/** Nome para print colado sem nome útil: `print-AAAAMMDD-HHMMSS.png`. */
export function pastedImageName(type: string, date = new Date(), suffix = ''): string {
  const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' } as Record<string, string>)[type] ?? (type.split('/')[1] || 'png')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `print-${stamp}${suffix}.${ext}`
}

/**
 * Extrai arquivos de um evento de colar (Ctrl+V). Prints da área de transferência
 * chegam sem nome ou como "image.png" — esses recebem um nome datado e único.
 * Retorna [] quando o clipboard só tem texto (o colar normal segue intacto).
 */
export function filesFromClipboard(e: { clipboardData: DataTransfer | null }): File[] {
  const data = e.clipboardData
  if (!data) return []
  let files = Array.from(data.files ?? [])
  if (files.length === 0) {
    files = Array.from(data.items ?? [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((f): f is File => !!f)
  }
  const now = new Date()
  return files.map((f, i) =>
    f.type.startsWith('image/') && (!f.name || /^image\.\w+$/i.test(f.name))
      ? new File([f], pastedImageName(f.type, now, i > 0 ? `-${i + 1}` : ''), { type: f.type, lastModified: f.lastModified })
      : f,
  )
}

/**
 * Handlers para espalhar num <textarea>: colar ou soltar arquivos chama `onFiles`.
 * Sem arquivo envolvido, não faz nada — texto colado/arrastado continua normal.
 */
export function fileDropPasteHandlers(onFiles: (files: File[]) => void) {
  return {
    onPaste: (e: ReactClipboardEvent<HTMLElement>) => {
      const files = filesFromClipboard(e)
      if (files.length === 0) return
      e.preventDefault()
      onFiles(files)
    },
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      onFiles(files)
    },
  }
}

/** Retorna true se o anexo é uma imagem (data URI de imagem ou URL com extensão de imagem). */
export function isImageAttachment(url?: string | null): boolean {
  if (!url) return false
  if (url.startsWith('data:image/')) return true
  // Remove a query string (SAS) antes de checar a extensão do caminho.
  const path = url.split('?')[0]
  return IMAGE_EXT_RE.test(path)
}

export interface FileTypeInfo {
  mime: string
  friendlyName: string
  color: string
  bgColor: string
  isImage: boolean
  isPdf: boolean
}

/**
 * Retorna informações detalhadas sobre o tipo do anexo,
 * incluindo nomes amigáveis e cores de estilo para a UI.
 */
export function getFileTypeInfo(url?: string | null): FileTypeInfo {
  if (!url) {
    return { mime: '', friendlyName: 'Arquivo', color: 'var(--text-3)', bgColor: 'color-mix(in srgb, var(--text-3) 10%, transparent)', isImage: false, isPdf: false }
  }

  let mime = ''
  if (url.startsWith('data:')) {
    mime = url.match(/^data:([^;]+)/)?.[1] || ''
  } else {
    const path = url.split('?')[0].toLowerCase()
    if (/\.(jpe?g)$/.test(path)) mime = 'image/jpeg'
    else if (/\.png$/.test(path)) mime = 'image/png'
    else if (/\.gif$/.test(path)) mime = 'image/gif'
    else if (/\.webp$/.test(path)) mime = 'image/webp'
    else if (/\.bmp$/.test(path)) mime = 'image/bmp'
    else if (/\.pdf$/.test(path)) mime = 'application/pdf'
    else if (/\.docx?$/.test(path)) mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else if (/\.xlsx?$/.test(path)) mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    else if (/\.pptx?$/.test(path)) mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    else if (/\.txt$/.test(path)) mime = 'text/plain'
    else if (/\.csv$/.test(path)) mime = 'text/csv'
    else if (/\.zip$/.test(path)) mime = 'application/zip'
    else if (/\.rar$/.test(path)) mime = 'application/x-rar-compressed'
  }

  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  const isWord = mime.includes('word') || mime.includes('msword')
  const isExcel = mime.includes('sheet') || mime.includes('excel')
  const isPowerPoint = mime.includes('presentation') || mime.includes('powerpoint')
  const isZip = mime.includes('zip') || mime.includes('rar')
  const isText = mime === 'text/plain' || mime === 'text/csv'

  let friendlyName = 'Arquivo anexo'
  let color = 'var(--text-2)'
  let bgColor = 'color-mix(in srgb, var(--text-3) 12%, transparent)'

  if (isImage) {
    friendlyName = 'Imagem'
    color = 'var(--success)'
    bgColor = 'color-mix(in srgb, var(--success) 10%, transparent)'
  } else if (isPdf) {
    friendlyName = 'Documento PDF'
    color = 'var(--danger)'
    bgColor = 'color-mix(in srgb, var(--danger) 10%, transparent)'
  } else if (isWord) {
    friendlyName = 'Documento Word'
    color = 'var(--accent)'
    bgColor = 'color-mix(in srgb, var(--accent) 10%, transparent)'
  } else if (isExcel) {
    friendlyName = 'Planilha Excel'
    color = 'var(--success)'
    bgColor = 'color-mix(in srgb, var(--success) 10%, transparent)'
  } else if (isPowerPoint) {
    friendlyName = 'Apresentação PowerPoint'
    color = 'var(--warning)'
    bgColor = 'color-mix(in srgb, var(--warning) 10%, transparent)'
  } else if (isZip) {
    friendlyName = 'Arquivo compactado'
    color = 'var(--alt-fg)'
    bgColor = 'color-mix(in srgb, var(--alt-fg) 10%, transparent)'
  } else if (isText) {
    friendlyName = 'Arquivo de texto'
    color = 'var(--text-3)'
    bgColor = 'color-mix(in srgb, var(--text-3) 10%, transparent)'
  }

  return { mime, friendlyName, color, bgColor, isImage, isPdf }
}

/**
 * Baixa o anexo forçando o download com nome de arquivo.
 * Necessário porque o atributo `download` do <a> é ignorado para URLs cross-origin
 * (como o blob): sem isto o navegador apenas abriria a imagem em vez de baixar.
 */
export async function downloadAttachment(url: string, filename: string): Promise<void> {
  // No Teams o iframe da aba bloqueia o download: o Teams abre o arquivo por fora.
  if (!url.startsWith('data:') && isTeamsHost() && await openInTeams(url)) return
  try {
    if (url.startsWith('data:')) {
      triggerDownload(url, filename)
      return
    }
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, filename)
    // Libera o objeto após o clique.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch {
    // Fallback: abre em nova aba se o fetch falhar.
    window.open(url, '_blank', 'noopener')
  }
}

/** "Ver" um anexo que não é imagem: nova aba no navegador, o Teams por fora dentro da aba do Teams. */
export function openAttachment(url: string): void {
  const openTab = () => { window.open(url, '_blank', 'noopener') }
  if (!isTeamsHost()) return openTab()
  void openInTeams(url).then(opened => { if (!opened) openTab() })
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
