import { Request, Response, NextFunction } from 'express'
import { effectiveProjectRole } from '../services/projectAccess'
import { AppError } from './errorHandler'
import { ProjectMemberRole } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      projectMembership?: { role: ProjectMemberRole }
    }
  }
}

/**
 * Autorização dentro de um projeto (RBAC próprio, separado do RBAC global
 * do sistema). Admin NÃO tem bypass automático: só quem é ProjectMember vê o
 * projeto.
 *
 * Retorna 404 (não 403) para quem não é membro, para não revelar a
 * existência de projetos privados/restritos a quem não tem acesso.
 */
export function requireProjectRole(...roles: ProjectMemberRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const projectId = req.params.projectId as string
      const role = await effectiveProjectRole(projectId, req.user!.sub)
      if (!role) {
        throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')
      }
      if (!roles.includes(role)) {
        throw new AppError(403, 'Sem permissão nesta ação', 'FORBIDDEN')
      }
      req.projectMembership = { role }
      next()
    } catch (err) {
      next(err)
    }
  }
}
