import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import prisma from '../config/prisma'
import { AppError } from './errorHandler'
import { roleDenied, areaDenied } from '../utils/denials'

import { userHasExplicitPermission } from '../config/permissions'
import { getEffectiveModules } from '../services/moduleAccess'

export interface JwtPayload {
  sub: string
  role: string
  orgId: string | null
  permissions?: string[]
  iat?: number
  iat_ms?: number
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

/**
 * Etiqueta de cada trava: diz o que ela exige, sem mudar o que ela faz. O
 * inventário de rotas (access/routeInventory.ts) lê isso para comparar as
 * travas de hoje com o porteiro (access/can.ts).
 */
export type Gate =
  | { kind: 'auth' }
  | { kind: 'role'; roles: string[] }
  | { kind: 'area'; area: string; roles: string[] }
  | { kind: 'module'; module: string }
  | { kind: 'cap'; cap: string }
  | { kind: 'requester' }

export function tagGate<T extends Function>(fn: T, gate: Gate): T {
  return Object.assign(fn, { gate })
}

/**
 * Token emitido antes (ou no instante) da invalidação da sessão. Compara em ms
 * pelo claim `iat_ms`: em segundos, o login feito no mesmo segundo do logout
 * nascia já revogado. Tokens antigos (sem `iat_ms`) mantêm a regra em segundos.
 */
export function issuedBeforeInvalidation(payload: { iat?: number; iat_ms?: number }, invalidatedAt: Date | null | undefined): boolean {
  if (!invalidatedAt) return false
  if (typeof payload.iat_ms === 'number') return payload.iat_ms <= invalidatedAt.getTime()
  return payload.iat !== undefined && payload.iat * 1000 <= invalidatedAt.getTime()
}

/** Com senha provisória, só dá para ver a própria sessão, trocar a senha e sair. */
const PASSWORD_CHANGE_PATHS = /^\/api\/(auth\/|users\/me\/password$)/

export const authenticate = tagGate(async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Token não fornecido', 'UNAUTHORIZED')
  }

  const token = header.slice(7)
  let payload: JwtPayload
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    throw new AppError(401, 'Token inválido ou expirado', 'UNAUTHORIZED')
  }

  // CWE-613: o token é stateless, então checamos no banco se a sessão foi
  // invalidada (logout) ou a conta desativada/removida depois de emitido.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { active: true, deleted_at: true, session_invalidated_at: true, role: true, permissions: true, org_id: true, must_change_password: true },
  })

  if (
    !user ||
    !user.active ||
    user.deleted_at ||
    issuedBeforeInvalidation(payload, user.session_invalidated_at)
  ) {
    throw new AppError(401, 'Token inválido ou expirado', 'UNAUTHORIZED')
  }

  if (user.must_change_password && !PASSWORD_CHANGE_PATHS.test(req.originalUrl.split('?')[0])) {
    throw new AppError(403, 'Troque a senha provisória para continuar.', 'PASSWORD_CHANGE_REQUIRED')
  }

  req.user = {
    ...payload,
    role: (user.role as any) || payload.role,
    // Empresa atual do banco: o token antigo não segura a empresa anterior depois de uma troca.
    orgId: user.org_id !== undefined ? user.org_id : payload.orgId,
    permissions: user.permissions || payload.permissions || [],
  }
  next()
}, { kind: 'auth' })

export function authorize(...roles: string[]) {
  return tagGate((req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    if (req.user.role === 'admin' || roles.includes(req.user.role)) {
      return next()
    }
    throw roleDenied(roles, req.user.role)
  }, { kind: 'role', roles })
}

export function authorizeArea(area: string, ...roles: string[]) {
  return tagGate((req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    if (req.user.role === 'admin') return next()
    if (roles.includes(req.user.role)) return next()
    if (userHasExplicitPermission(req.user, area)) return next()
    throw areaDenied(area, req.user.role)
  }, { kind: 'area', area, roles })
}

/**
 * Guard de acesso a Projetos ou Documentos: módulo efetivo do usuário
 * (users.module_projects / module_documents, herdado da carteira do gerente via manager_id —
 * ver services/moduleAccess.ts). Lido do banco a cada request, como o
 * authenticate: desligar o módulo vale na hora, sem esperar o token expirar.
 */
export function requireModule(module: 'projects' | 'documents') {
  return tagGate(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    const modules = await getEffectiveModules(req.user.sub, req.user.role)
    if (!modules[module]) throw new AppError(403, 'Sem acesso a este módulo', 'FORBIDDEN')
    next()
  }, { kind: 'module', module })
}

