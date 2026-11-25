import { z } from 'zod'

// Postgres recusa \u0000 em TEXT: sem isso, vira 500 no lugar de erro de validação.
export const noNullByte = (s: string) => !s.includes('\u0000')

// Teto acima de qualquer manual real: mantém a indexação em poucas chamadas de embedding.
export const MAX_CONTENT_CHARS = 500_000

const title = z.string().trim().min(1, 'Informe o título').max(200).refine(noNullByte, 'Texto inválido')
const content = z.string().trim().min(1, 'Informe o conteúdo').max(MAX_CONTENT_CHARS).refine(noNullByte, 'Texto inválido')
const categoryIds = z.array(z.string().min(1).max(100)).max(50).transform(ids => [...new Set(ids)])

export const createSchema = z.object({ title, content, categoryIds: categoryIds.optional() })

export const updateSchema = z.object({ title: title.optional(), content: content.optional(), categoryIds: categoryIds.optional() })
  .refine(v => v.title !== undefined || v.content !== undefined || v.categoryIds !== undefined, 'Informe ao menos um campo para alterar')

export const importSchema = z.object({
  fileName: z.string().trim().min(1, 'Informe o nome do arquivo').max(255).refine(noNullByte, 'Nome inválido'),
  dataUri: z.string().min(1, 'Envie o arquivo'),
})

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'published']).optional(),
  categoryId: z.string().min(1).max(100).optional(),
})

export const gapsSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

export type CreateInput = z.infer<typeof createSchema>
export type UpdateInput = z.infer<typeof updateSchema>
export type ImportInput = z.infer<typeof importSchema>
export type ListQuery = z.infer<typeof listSchema>
