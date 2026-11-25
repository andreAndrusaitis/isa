import { z } from 'zod'
import prisma from '../config/prisma'
import { fireProjectWebhook } from './projectWebhooks'

const blockSchema = z.object({
  type: z.enum(['heading', 'paragraph', 'bulleted_list', 'checklist', 'code', 'image', 'link', 'table']),
  text: z.string().optional(),
  items: z.array(z.string()).optional(),
  url: z.string().optional(),
  language: z.string().optional(),
})

export const createDocumentSchema = z.object({
  title: z.string().min(1),
  content: z.array(blockSchema).default([]),
  parentId: z.string().uuid().nullable().optional(),
})

export const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.array(blockSchema).optional(),
})

export async function createDocument(projectId: string, authorId: string, data: z.infer<typeof createDocumentSchema>) {
  const count = await prisma.document.count({ where: { project_id: projectId, parent_id: data.parentId ?? null } })
  const doc = await prisma.document.create({
    data: {
      project_id: projectId,
      parent_id: data.parentId ?? null,
      title: data.title,
      content: data.content,
      position: count,
      created_by: authorId,
      updated_by: authorId,
    },
  })
  fireProjectWebhook('document.created', projectId, authorId, { document: { id: doc.id, title: doc.title } })
  return doc
}

export async function listDocuments(projectId: string) {
  return prisma.document.findMany({ where: { project_id: projectId, archived_at: null }, orderBy: { position: 'asc' } })
}

export async function getDocument(documentId: string) {
  return prisma.document.findUnique({ where: { id: documentId } })
}

export async function updateDocument(documentId: string, editorId: string, data: z.infer<typeof updateDocumentSchema>) {
  const doc = await prisma.document.update({
    where: { id: documentId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      updated_by: editorId,
    },
  })
  fireProjectWebhook('document.updated', doc.project_id, editorId, { document: { id: doc.id, title: doc.title } })
  return doc
}

export async function linkDocumentToTask(taskId: string, documentId: string) {
  return prisma.taskDocument.create({ data: { task_id: taskId, document_id: documentId } })
}

export async function unlinkDocumentFromTask(taskId: string, documentId: string) {
  await prisma.taskDocument.delete({ where: { task_id_document_id: { task_id: taskId, document_id: documentId } } })
}
