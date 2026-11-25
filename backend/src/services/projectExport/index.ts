import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { effectiveProjectRole, visibleProjectsWhere } from '../projectAccess'

export const MAX_EXPORT_PROJECTS = 50

/** Projetos da exportação: os pedidos (cada um checado) ou todos os visíveis não arquivados. */
export async function resolveExportProjects(userId: string, requested: string[] | undefined): Promise<string[]> {
  let ids: string[]
  if (requested?.length) {
    for (const id of requested) {
      if (!(await effectiveProjectRole(id, userId))) {
        throw new AppError(403, `Você não tem acesso ao projeto ${id}.`, 'PROJECT_FORBIDDEN')
      }
    }
    ids = [...new Set(requested)]
  } else {
    const visible = await prisma.project.findMany({ where: { archived_at: null, ...(await visibleProjectsWhere(userId)) }, select: { id: true } })
    ids = visible.map((p) => p.id)
  }
  if (ids.length === 0) throw new AppError(400, 'Nenhum projeto para exportar. Você não participa de projetos (nem a sua equipe).', 'NO_PROJECTS')
  if (ids.length > MAX_EXPORT_PROJECTS) {
    throw new AppError(400, `Selecione no máximo ${MAX_EXPORT_PROJECTS} projetos por exportação.`, 'TOO_MANY_PROJECTS')
  }
  return ids
}

/** 'AAAA-MM-DD' → início/fim do dia em São Paulo (sem horário de verão desde 2019). */
export const dayStartSp = (d: string) => new Date(`${d}T00:00:00.000-03:00`)
export const dayEndSp = (d: string) => new Date(`${d}T23:59:59.999-03:00`)
