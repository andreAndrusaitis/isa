import { createHash } from 'node:crypto'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

// Protege o endpoint de login: máximo 10 tentativas FALHAS por IP a cada 15 min.
// `skipSuccessfulRequests` faz o contador refletir apenas falhas,
// para que logins bem-sucedidos não sejam penalizados e o bloqueio represente
// de fato tentativas de força bruta.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
})

// Limite por CONTA (e-mail): complementa o limite por IP acima e cobre
// brute-force distribuído (muitos IPs atacando a mesma conta).
export const loginAccountRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : 'unknown'
    return `login-account:${email}`
  },
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Muitas tentativas para esta conta. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
})

// Protege o endpoint de refresh: mais permissivo, mas ainda limita abuso.
export const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições de refresh. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
})

// API externa de integração (/api/integrations/v1/*): 60 req/min por API key+IP.
// Aplicado DEPOIS de authenticateApiKey (chave composta usa req.apiKey.id) —
// evita que uma key barulhenta bloqueie as demais.
export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: env.API_KEY_RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `apikey:${req.apiKey?.id ?? req.projectApiKey?.id ?? 'unknown'}:${req.ip ?? 'noip'}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Muitas requisições para esta API key. Tente novamente em instantes.', code: 'RATE_LIMIT_EXCEEDED' },
})

// Sugestão da base no Wizard: por usuário, depois de authenticate. Quem estoura fica sem
// sugestão, nunca sem o chamado: por isso 200 com null, e não 429.
export const SUGGEST_RATE_MAX = 20
export const SUGGEST_RATE_WINDOW_MS = 5 * 60 * 1000
export const suggestRateLimit = rateLimit({
  windowMs: SUGGEST_RATE_WINDOW_MS,
  max: SUGGEST_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `suggest:${req.user?.sub ?? 'unknown'}`,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => { res.json({ suggestion: null }) },
})

// Rate limit geral para a API — proteção básica contra flood. Conta por usuário
// autenticado (JWT verificado): por IP, uma empresa inteira atrás do mesmo NAT
// dividia 500 req e todo mundo tomava 429. Sem token válido, conta por IP.
function apiRateKey(req: Request): string {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) {
    try {
      const { sub } = jwt.verify(h.slice(7), env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string }
      if (sub) return `u:${sub}`
    } catch { /* token inválido: cai no IP */ }
  }
  return `ip:${ipKeyGenerator(req.ip ?? '')}`
}

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Ajustável via API_RATE_LIMIT_MAX (ex: durante teste de carga autorizado) — default 500.
  max: Number(process.env.API_RATE_LIMIT_MAX) || 500,
  keyGenerator: apiRateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
})

// Login Microsoft (/auth) fica fora de /api: limite próprio por IP, folgado o bastante
// para uma empresa inteira atrás do mesmo NAT.
export const ssoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SSO_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
})

// MCP: clientes de IA fazem muitas chamadas seguidas; conta por token (hash), não por IP.
export const mcpRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.MCP_RATE_LIMIT_MAX) || 600,
  keyGenerator: (req) => (req.headers.authorization ? `mcp:${createHash('sha256').update(req.headers.authorization).digest('hex')}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.', code: 'RATE_LIMIT_EXCEEDED' },
})
