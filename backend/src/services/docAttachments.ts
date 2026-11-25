/** Anexos das páginas de Documentos (imagens e arquivos dentro do texto). */
import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { requirePage, type DocActor } from './docAccess'
import { docText } from './docSpaces'
import { MAX_BYTES, isDataUri, presentAttachment, resolveAttachmentMime, storeAttachment } from './uploads'

/** Mais restrito que o dos chamados; vale também sem blob (base64 no banco). Nada de SVG/HTML. */
const ALLOWED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
])
/** Sem tipo útil do navegador: deduz pela extensão. */
const UNKNOWN_MIMES = new Set(['', 'application/octet-stream', 'image/jpg'])

export const createAttachmentSchema = z.object({
  filename: docText(200).refine(s => s.length > 0, 'Nome do arquivo é obrigatório'),
  dataUri: z.string().min(1),
})

const SELECT = { id: true, page_id: true, filename: true, mime: true, size: true, created_at: true } as const

export async function createAttachment(actor: DocActor, pageId: string, body: unknown) {
  const { page } = await requirePage(pageId, actor, 'editor')
  const data = createAttachmentSchema.parse(body)
  const head = /^data:([a-z0-9.+/-]*);base64,/i.exec(data.dataUri.slice(0, 200))
  if (!head) throw new AppError(400, 'Formato de anexo inválido', 'INVALID_ATTACHMENT')
  const filename = data.filename.replace(/[\\/:*?"<>|]/g, '_')
  const declared = head[1].toLowerCase()
  const mime = UNKNOWN_MIMES.has(declared) ? resolveAttachmentMime(filename, declared === 'image/jpg' ? 'image/jpeg' : null) : declared
  if (!mime || !ALLOWED_MIMES.has(mime)) throw new AppError(400, 'Tipo de arquivo não permitido', 'INVALID_ATTACHMENT_TYPE')

  const payload = data.dataUri.slice(head[0].length)
  const size = Buffer.byteLength(payload, 'base64')
  if (size > MAX_BYTES) throw new AppError(413, 'Anexo excede o tamanho máximo (10 MB)', 'ATTACHMENT_TOO_LARGE')
  const dataUri = `data:${mime};base64,${payload}`
  if (!size || !/^[a-z0-9+/]+={0,2}$/i.test(payload) || !isDataUri(dataUri)) throw new AppError(400, 'Formato de anexo inválido', 'INVALID_ATTACHMENT')

  const storageKey = await storeAttachment(dataUri, `docs/${page.space_id}`)
  if (!storageKey) throw new AppError(400, 'Formato de anexo inválido', 'INVALID_ATTACHMENT')
  const row = await prisma.docAttachment.create({
    data: { page_id: pageId, space_id: page.space_id, filename, mime, size, storage_key: storageKey, created_by_id: actor.id },
    select: SELECT,
  })
  return { ...row, url: presentAttachment(storageKey) }
}

/** Link de leitura curto (blob) ou o próprio conteúdo em data URI (sem blob). O acesso vem da página. */
export async function getAttachment(actor: DocActor, attachmentId: string) {
  const row = await prisma.docAttachment.findUnique({ where: { id: attachmentId }, select: SELECT })
  if (!row) throw new AppError(404, 'Anexo não encontrado', 'NOT_FOUND')
  await requirePage(row.page_id, actor)
  const { storage_key } = await prisma.docAttachment.findUniqueOrThrow({ where: { id: attachmentId }, select: { storage_key: true } })
  return { ...row, url: presentAttachment(storage_key) }
}
