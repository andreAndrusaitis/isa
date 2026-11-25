import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

export const createMcpTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const SAFE_SELECT = {
  id: true,
  name: true,
  token_prefix: true,
  active: true,
  created_at: true,
  last_used_at: true,
} as const

function newMcpToken(): string {
  return `isamcp_${randomBytes(32).toString('hex')}`
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createMcpToken(userId: string, input: unknown) {
  const data = createMcpTokenSchema.parse(input)
  const token = newMcpToken()

  const created = await prisma.mcpToken.create({
    data: {
      user_id: userId,
      name: data.name,
      token_hash: hashMcpToken(token),
      token_prefix: token.slice(0, 11),
    },
    select: SAFE_SELECT,
  })

  return { ...created, token }
}

export async function listMcpTokens(userId: string) {
  return prisma.mcpToken.findMany({
    where: { user_id: userId },
    select: SAFE_SELECT,
    orderBy: { created_at: 'desc' },
  })
}

export async function revokeMcpToken(userId: string, tokenId: string) {
  const token = await prisma.mcpToken.findUnique({ where: { id: tokenId } })
  if (!token || token.user_id !== userId) {
    throw new AppError(404, 'Token não encontrado', 'MCP_TOKEN_NOT_FOUND')
  }
  await prisma.mcpToken.update({ where: { id: tokenId }, data: { active: false } })
}

/**
 * Desliga todos os tokens da pessoa ao trocar credencial, senão sobreviveriam a ela.
 * Sem async: precisa seguir PrismaPromise para entrar em $transaction.
 */
export function deactivateMcpTokens(userId: string) {
  return prisma.mcpToken.updateMany({ where: { user_id: userId, active: true }, data: { active: false } })
}

export async function resolveUserIdFromToken(token: string): Promise<string | null> {
  const match = await prisma.mcpToken.findUnique({
    where: { token_hash: hashMcpToken(token) },
  })
  if (!match || !match.active) return null

  prisma.mcpToken.update({ where: { id: match.id }, data: { last_used_at: new Date() } }).catch(() => undefined)

  return match.user_id
}
