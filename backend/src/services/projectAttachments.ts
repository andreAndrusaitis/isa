import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { storeAttachment, presentAttachment } from './uploads'
import { logTaskActivity } from './taskActivity'

export const createAttachmentSchema = z.object({
  entityType: z.enum(['task', 'comment', 'document']),
  entityId: z.string(),
  fileName: z.string().min(1),
  dataUri: z.string(),
})

function withSignedUrl<T extends { storage_key: string }>(attachment: T) {
  return { ...attachment, url: presentAttachment(attachment.storage_key) }
}

/**
 * O anexo pendura em algo DESTE projeto: o histórico da task é gravado só pelo id,
 * então uma task de outro projeto receberia a entrada. A Central de arquivos envia
 * o arquivo solto como `document` com o id do próprio projeto.
 */
async function assertEntityInProject(projectId: string, data: z.infer<typeof createAttachmentSchema>) {
  const owner = data.entityType === 'task'
    ? await prisma.task.findFirst({ where: { id: data.entityId, project_id: projectId }, select: { id: true } })
    : data.entityType === 'comment'
      ? await prisma.taskComment.findFirst({ where: { id: data.entityId, deleted_at: null, task: { project_id: projectId } }, select: { id: true } })
      : data.entityId === projectId || await prisma.document.findFirst({ where: { id: data.entityId, project_id: projectId }, select: { id: true } })
  if (!owner) throw new AppError(400, 'O item do anexo não pertence a este projeto.', 'CROSS_PROJECT_REFERENCE')
}

export async function createAttachment(projectId: string, uploaderId: string, data: z.infer<typeof createAttachmentSchema>) {
  await assertEntityInProject(projectId, data)
  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(data.dataUri)
  if (!match) throw new Error('INVALID_ATTACHMENT')
  const mime = match[1]
  const sizeBytes = Buffer.byteLength(match[2], 'base64')

  const storageKey = await storeAttachment(data.dataUri, `projects/${projectId}`)
  const attachment = await prisma.attachment.create({
    data: {
      project_id: projectId,
      entity_type: data.entityType,
      entity_id: data.entityId,
      file_name: data.fileName,
      file_size: sizeBytes,
      mime_type: mime,
      storage_key: storageKey!,
      uploaded_by: uploaderId,
    },
  })
  // Anexo de comentário aparece no próprio comentário; não repete no histórico.
  if (data.entityType === 'task') await logTaskActivity(data.entityId, uploaderId, 'attachment_changed', { to: data.fileName })
  return withSignedUrl(attachment)
}

export async function listAttachments(projectId: string, filters: { type?: string; taskId?: string } = {}) {
  // taskId: só os anexos da task e dos comentários dela (o drawer pedia o projeto inteiro,
  // com um link assinado por arquivo, e filtrava no navegador).
  let taskScope = {}
  if (filters.taskId) {
    const comments = await prisma.taskComment.findMany({ where: { task_id: filters.taskId }, select: { id: true } })
    taskScope = { OR: [
      { entity_type: 'task', entity_id: filters.taskId },
      { entity_type: 'comment', entity_id: { in: comments.map((c) => c.id) } },
    ] }
  }
  const attachments = await prisma.attachment.findMany({
    where: {
      project_id: projectId,
      ...(filters.type ? { mime_type: { startsWith: filters.type } } : {}),
      ...taskScope,
    },
    orderBy: { created_at: 'desc' },
    include: { uploader: { select: { id: true, name: true } } },
  })
  const taskOf = await tasksOfAttachments(attachments)
  return attachments.map((a) => ({ ...withSignedUrl(a), task: taskOf.get(a.id) ?? null }))
}

/**
 * Task de origem de cada anexo (direto na task ou num comentário dela), para a
 * Central de arquivos mostrar de onde o arquivo veio. Duas consultas, não uma por anexo.
 */
async function tasksOfAttachments(attachments: { id: string; entity_type: string; entity_id: string }[]) {
  const commentIds = attachments.filter((a) => a.entity_type === 'comment').map((a) => a.entity_id)
  const comments = commentIds.length
    ? await prisma.taskComment.findMany({ where: { id: { in: commentIds } }, select: { id: true, task_id: true } })
    : []
  const taskOfComment = new Map(comments.map((c) => [c.id, c.task_id]))
  const taskIdOf = new Map<string, string>()
  for (const a of attachments) {
    const taskId = a.entity_type === 'task' ? a.entity_id : a.entity_type === 'comment' ? taskOfComment.get(a.entity_id) : undefined
    if (taskId) taskIdOf.set(a.id, taskId)
  }
  const ids = [...new Set(taskIdOf.values())]
  const tasks = ids.length
    ? await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, title: true } })
    : []
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = new Map<string, { id: string; key: string | null; title: string }>()
  for (const [attId, taskId] of taskIdOf) { const t = byId.get(taskId); if (t) out.set(attId, t) }
  return out
}

export async function getAttachment(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } })
  if (!attachment) return null
  return withSignedUrl(attachment)
}
