import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'

export const macroSchema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1),
  active: z.boolean().default(true),
})

export async function listMacros() {
  return prisma.macro.findMany({ orderBy: { title: 'asc' } })
}

export async function createMacro(data: z.infer<typeof macroSchema>, audit?: AuditInfo) {
  const macro = await prisma.macro.create({
    data: { ...data, created_by_id: audit?.actorId ?? null },
  })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_MACRO',
      resource: 'MACRO',
      details: { macroId: macro.id, title: macro.title },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
  return macro
}

export async function updateMacro(id: string, data: Partial<z.infer<typeof macroSchema>>, audit?: AuditInfo) {
  const existing = await prisma.macro.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Macro não encontrada')

  const macro = await prisma.macro.update({ where: { id }, data })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_MACRO',
      resource: 'MACRO',
      details: { macroId: id, changes: data },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
  return macro
}

export async function deleteMacro(id: string, audit?: AuditInfo) {
  const existing = await prisma.macro.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Macro não encontrada')

  await prisma.macro.delete({ where: { id } })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_MACRO',
      resource: 'MACRO',
      details: { macroId: id, title: existing.title },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
  return { success: true }
}

