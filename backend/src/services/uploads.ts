/**
 * Serviço de anexos — Azure Blob Storage.
 *
 * Fluxo atual (transparente):
 *  - PERSISTÊNCIA: `storeAttachment` recebe o data URI base64 vindo do frontend,
 *    sobe o binário para o blob e devolve apenas o NOME do blob (guardado no banco).
 *  - LEITURA: `presentAttachment` converte o nome do blob numa URL de leitura
 *    assinada (SAS) de curta duração. Anexos legados (data:/http) passam direto.
 */

import { randomUUID } from 'node:crypto'
import {
  blobEnabled,
  blobAccount,
  blobContainer,
  getContainerClient,
  getSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '../config/blob'
import { AppError } from '../middlewares/errorHandler'

// Tipos permitidos (MIME → extensão). Bloqueia executáveis, SVG (XSS), etc.
export const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  // Documentos Word / Office
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  // Excel
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  // PowerPoint
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  // Texto / CSV / Logs / JSON
  'text/plain': 'txt',
  'text/log': 'log',
  'text/csv': 'csv',
  'application/json': 'json',
  // ZIP
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  // E-mail anexado a e-mail (chega pela caixa de atendimento)
  'message/rfc822': 'eml',
}
export const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const DATA_URI_RE = /^data:([a-z0-9.+/-]+);base64,(.+)$/i

/**
 * MIME aceito para um anexo. Usa o content-type informado quando permitido;
 * senão (ex.: application/octet-stream), deduz pela extensão do nome.
 * Retorna undefined se o tipo não for permitido.
 */
export function resolveAttachmentMime(fileName: string, contentType?: string | null): string | undefined {
  const mime = contentType?.split(';')[0].trim().toLowerCase()
  if (mime && ALLOWED_TYPES[mime]) return mime
  let ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'
  return Object.keys(ALLOWED_TYPES).find((m) => ALLOWED_TYPES[m] === ext)
}

export function isDataUri(value: string): boolean {
  return DATA_URI_RE.test(value)
}

/** Sobe um data URI para o blob e retorna o nome do blob (chave guardada no banco). */
export async function uploadDataUri(dataUri: string, prefix = 'tickets'): Promise<string> {
  const match = DATA_URI_RE.exec(dataUri)
  if (!match) throw new AppError(400, 'Formato de anexo inválido', 'INVALID_ATTACHMENT')

  const mime = match[1].toLowerCase()
  const ext = ALLOWED_TYPES[mime]
  if (!ext) throw new AppError(400, 'Tipo de arquivo não permitido', 'INVALID_ATTACHMENT_TYPE')

  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) throw new AppError(400, 'Anexo vazio', 'EMPTY_ATTACHMENT')
  if (buffer.length > MAX_BYTES) {
    throw new AppError(413, 'Anexo excede o tamanho máximo (10 MB)', 'ATTACHMENT_TOO_LARGE')
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobName = `${prefix}/${yyyy}/${mm}/${randomUUID()}.${ext}`

  const blockBlob = getContainerClient().getBlockBlobClient(blobName)
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mime },
  })
  return blobName
}

/** Gera uma URL de leitura assinada (SAS) válida por `ttlMinutes` (padrão 60 min). */
export function signReadUrl(blobName: string, ttlMinutes = 60): string {
  const startsOn = new Date(Date.now() - 5 * 60 * 1000) // tolerância de relógio
  const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000)
  const sas = generateBlobSASQueryParameters(
    {
      containerName: blobContainer,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    getSharedKeyCredential(),
  ).toString()
  return `https://${blobAccount}.blob.core.windows.net/${blobContainer}/${encodeURI(blobName)}?${sas}`
}

/**
 * PERSISTÊNCIA: se o valor é um data URI e o blob está ativo, sobe e retorna o
 * nome do blob. Caso contrário, devolve o valor original (compatibilidade), salvo
 * nome de blob fora do `prefix` informado.
 */
export async function storeAttachment(value: string | null | undefined, prefix?: string): Promise<string | null> {
  if (!value) return null
  // Sem blob o base64 vai direto ao banco: o limite de 10 MB vale nos dois caminhos.
  if (isDataUri(value) && Math.floor((value.length - value.indexOf(',') - 1) * 3 / 4) > MAX_BYTES) {
    throw new AppError(413, 'Anexo excede o tamanho máximo (10 MB)', 'ATTACHMENT_TOO_LARGE')
  }
  // O tipo é conferido também sem blob: senão data:text/html iria parar no banco.
  if (/^data:/i.test(value)) {
    const mime = /^data:([^;,]*)/i.exec(value)?.[1].toLowerCase() ?? ''
    if (!isDataUri(value) || !ALLOWED_TYPES[mime]) throw new AppError(400, 'Tipo de arquivo não permitido', 'INVALID_ATTACHMENT_TYPE')
  }
  if (blobEnabled && isDataUri(value)) {
    return uploadDataUri(value, prefix)
  }
  // Nome de blob fora da pasta deste anexo veio do cliente: a leitura assinaria o arquivo
  // de outro registro. Vira "sem anexo" e não erro porque o perfil reenvia as iniciais no avatar.
  if (prefix && isBlobName(value) && (!value.startsWith(`${prefix}/`) || value.includes('..'))) return null
  return value
}

/**
 * LEITURA: converte o nome do blob guardado numa URL assinada temporária.
 * Anexos legados (data:, http, caminho relativo) passam direto.
 */
export function presentAttachment(value: string | null | undefined): string | null {
  if (!value) return null
  if (!isBlobName(value)) return value
  return blobEnabled ? signReadUrl(value) : value
}

/**
 * Conteúdo de um anexo guardado (nome do blob ou data URI legado), para reenviar
 * por e-mail. null se não der para ler (link externo, blob desligado, sumiu).
 */
export async function readStoredAttachment(value: string): Promise<{ mime: string; ext: string; buffer: Buffer } | null> {
  const data = DATA_URI_RE.exec(value)
  if (data) {
    const mime = data[1].toLowerCase()
    return { mime, ext: ALLOWED_TYPES[mime] ?? 'bin', buffer: Buffer.from(data[2], 'base64') }
  }
  if (!isBlobName(value) || !blobEnabled) return null
  const ext = value.split('.').pop()?.toLowerCase() ?? 'bin'
  const mime = Object.keys(ALLOWED_TYPES).find(m => ALLOWED_TYPES[m] === ext) ?? 'application/octet-stream'
  const buffer = await getContainerClient().getBlockBlobClient(value).downloadToBuffer()
  return { mime, ext, buffer }
}

/** Valor guardado no banco é nome de blob (não é data:, http ou caminho relativo). */
export function isBlobName(value: string): boolean {
  return !(
    value.startsWith('data:') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/')
  )
}

/**
 * Remove do blob os anexos informados (valores como guardados no banco). Ignora
 * legados (data:/http) e nulos. Nunca lança: falha vira órfão no storage, logado
 * pelo chamador via retorno.
 */
export async function deleteAttachments(values: (string | null | undefined)[]): Promise<string[]> {
  if (!blobEnabled) return []
  const names = [...new Set(values.filter((v): v is string => !!v && isBlobName(v)))]
  const results = await Promise.allSettled(names.map(n => getContainerClient().getBlockBlobClient(n).deleteIfExists()))
  return names.filter((_, i) => results[i].status === 'rejected')
}

/** Foto enviada pelo cliente: imagem em data URI ou as iniciais. Endereço externo viraria rastreador de quem vê. */
export function checkAvatar(value: string): string {
  if (/^data:/i.test(value)) {
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) throw new AppError(400, 'A foto precisa ser PNG, JPG, GIF ou WebP.', 'INVALID_AVATAR')
    return value
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) throw new AppError(400, 'Envie a foto como arquivo.', 'INVALID_AVATAR')
  return value
}
