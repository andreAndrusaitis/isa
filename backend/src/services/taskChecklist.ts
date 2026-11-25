import { z } from 'zod'
import prisma from '../config/prisma'
import { logChecklistActivity } from './taskActivity'

export const createChecklistItemSchema = z.object({
  text: z.string().min(1),
})

export async function createChecklistItem(taskId: string, data: z.infer<typeof createChecklistItemSchema>, actorId?: string) {
  const count = await prisma.checklistItem.count({ where: { task_id: taskId } })
  const item = await prisma.checklistItem.create({ data: { task_id: taskId, text: data.text, position: count } })
  if (actorId) await logChecklistActivity(taskId, actorId, 'added', item.text)
  return item
}

export async function toggleChecklistItem(itemId: string, done: boolean, actorId?: string) {
  const before = actorId ? await prisma.checklistItem.findUnique({ where: { id: itemId }, select: { done: true } }) : null
  const item = await prisma.checklistItem.update({ where: { id: itemId }, data: { done } })
  if (actorId && before && before.done !== done) await logChecklistActivity(item.task_id, actorId, done ? 'done' : 'reopened', item.text)
  return item
}

export async function deleteChecklistItem(itemId: string, actorId?: string) {
  const item = await prisma.checklistItem.delete({ where: { id: itemId } })
  if (actorId) await logChecklistActivity(item.task_id, actorId, 'removed', item.text)
}
