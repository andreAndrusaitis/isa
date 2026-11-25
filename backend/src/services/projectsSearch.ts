import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'

/**
 * Busca sempre filtrada por membership antes de agregar (nunca retorna
 * conteúdo de projeto ao qual o usuário não pertence). Match exato de seq (ex: usuário digita "42" e a task #42 do
 * projeto existe) é priorizado, mas não implementado como ranking
 * separado nesta fase — é um filtro OR simples, suficiente para o MVP.
 */
export async function search(userId: string, query: string) {
  const seqAsNumber = /^\d+$/.test(query) ? Number(query) : undefined

  const visible = await visibleProjectsWhere(userId)
  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        project: visible,
        archived_at: null,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          ...(seqAsNumber !== undefined ? [{ seq: seqAsNumber }] : []),
        ],
      },
      take: 20,
    }),
    prisma.project.findMany({
      where: {
        ...visible,
        archived_at: null,
        name: { contains: query, mode: 'insensitive' },
      },
      take: 20,
    }),
  ])

  return { tasks, projects }
}
