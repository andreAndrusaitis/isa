import { NextFunction, Request, Response } from 'express'
import prisma from '../config/prisma'
import { AppError } from './errorHandler'
import { hashApiKey } from '../services/apiKeys'

export interface ApiKeyContext {
  id: string
  scopes: string[]
  org_id: string | null
}

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyContext
  }
}

/**
 * Autentica a API externa (/api/integrations/v1/*): busca a chave pelo hash
 * SHA-256 do token Bearer.
 */
export async function authenticateApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = extractToken(req)
    if (!token) {
      throw new AppError(401, 'Informe a API key no header Authorization', 'API_KEY_MISSING')
    }

    // Busca por igualdade do hash SHA-256 — não é uma comparação de string bruta
    // (onde timing attack importaria), então o lookup direto no índice é seguro.
    const match = await prisma.apiKey.findFirst({ where: { key_hash: hashApiKey(token), active: true } })

    if (!match) {
      throw new AppError(401, 'API key inválida', 'API_KEY_INVALID')
    }

    req.apiKey = { id: match.id, scopes: match.scopes, org_id: match.org_id }

    // Fire-and-safe: não bloqueia a resposta nem derruba a requisição em caso de erro.
    prisma.apiKey.update({ where: { id: match.id }, data: { last_used_at: new Date() } }).catch(() => undefined)

    next()
  } catch (error) {
    next(error)
  }
}

/** Middleware factory: exige que a key autenticada tenha o escopo informado. */
export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiKey?.scopes.includes(scope)) {
      return next(new AppError(403, `Esta API key não tem o escopo "${scope}" exigido por este endpoint. Edite a key (ou gere uma nova) com esse escopo na tela de Webhooks, seção API Keys.`, 'API_KEY_SCOPE_DENIED'))
    }
    next()
  }
}

export function extractToken(req: Request): string | null {
  const authorization = req.headers.authorization
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null
  }
  const header = req.headers['x-api-key']
  if (typeof header === 'string') {
    return header.trim() || null
  }
  return null
}
