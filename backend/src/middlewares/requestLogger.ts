import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

// Trechos que, se aparecerem no nome de qualquer campo, marcam o valor como sensível.
// Usamos correspondência por substring para pegar variações como accessToken,
// refreshToken, jwtSecret, api_key, etc. — não apenas nomes exatos.
const SENSITIVE_PATTERNS = ['password', 'senha', 'token', 'secret', 'authorization', 'apikey', 'api_key', 'privatekey', 'certificate']

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '')
  return k === 'key' || SENSITIVE_PATTERNS.some(p => k.includes(p.replace(/[_-]/g, '')))
}

function sanitize(obj: unknown, depth = 0): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (depth > 8) return '[…]'
  if (Array.isArray(obj)) return obj.slice(0, 20).map(v => sanitize(v, depth + 1))
  const result: Record<string, unknown> = {}
  try {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? '***' : sanitize(value, depth + 1)
    }
  } catch {
    return '[Unserializable]'
  }
  return result
}

function colorMethod(method: string): string {
  const colors: Record<string, string> = {
    GET: '\x1b[36m', POST: '\x1b[32m', PATCH: '\x1b[33m',
    PUT: '\x1b[33m', DELETE: '\x1b[31m',
  }
  return `${colors[method] ?? '\x1b[37m'}${method}\x1b[0m`
}

function colorStatus(status: number): string {
  if (status >= 500) return `\x1b[31m${status}\x1b[0m`
  if (status >= 400) return `\x1b[33m${status}\x1b[0m`
  if (status >= 300) return `\x1b[36m${status}\x1b[0m`
  return `\x1b[32m${status}\x1b[0m`
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Nível http desligado (produção): nem monta o texto.
  if (!logger.isLevelEnabled('http')) return next()
  const start = Date.now()
  const method = req.method
  const url = req.originalUrl

  // Loga a chegada da requisição com body (apenas para mutations).
  const hasMutationBody = ['POST', 'PUT', 'PATCH'].includes(method) &&
    Object.keys(req.body ?? {}).length > 0

  const bodyPreview = hasMutationBody
    ? `  \x1b[2mREQ: ${JSON.stringify(sanitize(req.body)).slice(0, 500)}\x1b[0m`
    : ''

  logger.http(`→ ${colorMethod(method)} ${url}${bodyPreview}`)

  // Intercepta o corpo da resposta para logar o que está retornando.
  const oldSend = res.send
  let responseBody: any
  
  res.send = function (body) {
    responseBody = body
    return oldSend.apply(res, arguments as any)
  }

  // Captura o momento em que a resposta é enviada para logar o resultado.
  res.on('finish', () => {
    const ms = Date.now() - start
    const status = res.statusCode
    const user = (req as Request & { user?: { sub: string; role: string } }).user
    const userTag = user ? `  \x1b[2m[${user.sub} · ${user.role}]\x1b[0m` : ''
    
    // Rotas de autenticação retornam tokens no corpo — nunca logar o body de resposta.
    const isAuthRoute = url.startsWith('/api/auth')

    let resPreview = ''
    if (responseBody && !isAuthRoute) {
      try {
        const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody
        resPreview = `  \x1b[2mRES: ${JSON.stringify(sanitize(parsed)).slice(0, 500)}\x1b[0m`
      } catch {
        // Se não for JSON ou falhar o parse, não loga o body da resposta ou loga truncado.
        resPreview = typeof responseBody === 'string' ? `  \x1b[2mRES: ${responseBody.slice(0, 100)}...\x1b[0m` : ''
      }
    }

    logger.http(`← ${colorStatus(status)} ${colorMethod(method)} ${url}  \x1b[2m${ms}ms\x1b[0m${userTag}${resPreview}`)
  })

  next()
}
