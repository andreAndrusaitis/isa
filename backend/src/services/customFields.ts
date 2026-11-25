import { z } from 'zod'
import prisma from '../config/prisma'

export const createCustomFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'long_text', 'number', 'currency', 'date', 'checkbox', 'dropdown', 'multi_select', 'person', 'url']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
})

export async function createCustomField(projectId: string, data: z.infer<typeof createCustomFieldSchema>) {
  const count = await prisma.customField.count({ where: { project_id: projectId } })
  return prisma.customField.create({
    data: {
      project_id: projectId,
      name: data.name,
      type: data.type,
      required: data.required,
      options: data.options ?? undefined,
      position: count,
    },
  })
}

export async function listCustomFields(projectId: string) {
  return prisma.customField.findMany({ where: { project_id: projectId }, orderBy: { position: 'asc' } })
}

export const setCustomFieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
})

export async function setCustomFieldValue(taskId: string, customFieldId: string, value: unknown) {
  return prisma.customFieldValue.upsert({
    where: { task_id_custom_field_id: { task_id: taskId, custom_field_id: customFieldId } },
    create: { task_id: taskId, custom_field_id: customFieldId, value: value as any },
    update: { value: value as any },
  })
}
