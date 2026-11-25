// backend/src/middlewares/mcpAuth.ts
import { NextFunction, Request, Response } from 'express'
import { AppError } from './errorHandler'
import { resolveUserIdFromToken } from '../services/mcpTokens'
import { getEffectiveModules } from '../services/moduleAccess'
import prisma from '../config/prisma'

declare module 'express-serve-static-core' {
  interface Request {
    mcpUserId?: string
  }
}

/**
 * Autentica o endpoint /mcp. Token Bearer pessoal (isamcp_...), resolvido para
 * o user_id dono do token — as tools reusam a autorização normal desse
 * usuário (ProjectMember, escopo etc.), não há RBAC novo aqui.
 */
export async function authenticateMcp(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'Informe o token MCP no header Authorization', 'MCP_TOKEN_MISSING')
    }

    const token = header.slice(7).trim()
    const userId = await resolveUserIdFromToken(token)
    if (!userId) {
      throw new AppError(401, 'Token MCP inválido ou revogado', 'MCP_TOKEN_INVALID')
    }

    // Mesmo guard das rotas web: conta ativa e módulo de projetos efetivo.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true, deleted_at: true } })
    if (!user || !user.active || user.deleted_at) {
      throw new AppError(401, 'Token MCP inválido ou revogado', 'MCP_TOKEN_INVALID')
    }
    if (!(await getEffectiveModules(userId, user.role)).projects) {
      throw new AppError(403, 'Sem acesso ao módulo de projetos', 'FORBIDDEN')
    }

    req.mcpUserId = userId
    next()
  } catch (error) {
    next(error)
  }
}
