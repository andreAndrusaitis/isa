import { z } from 'zod'
import prisma from '../config/prisma'

export const createTemplateSchema = z.object({
  scope: z.enum(['project', 'task']),
  name: z.string().min(1),
  structure: z.record(z.any()),
})

/**
 * `structure` é copiado como valor inicial ao criar projeto/task a
 * partir do template — nunca um vínculo vivo. Alterar o template depois
 * não retroage em projetos/tasks já criados
 * porque nada além deste create/list referencia o template por ID.
 */
export async function createTemplate(creatorId: string, data: z.infer<typeof createTemplateSchema>) {
  return prisma.template.create({
    data: { scope: data.scope, name: data.name, structure: data.structure, created_by: creatorId },
  })
}

export async function listTemplates(scope?: 'project' | 'task') {
  return prisma.template.findMany({ where: scope ? { scope } : undefined, orderBy: { created_at: 'desc' } })
}
