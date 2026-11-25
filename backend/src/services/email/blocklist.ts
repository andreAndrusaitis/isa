import { z } from 'zod'
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { createAuditLog } from '../audit'

/**
 * Remetentes que não abrem chamado por e-mail nem pela API: endereço exato ou domínio
 * (vale para os subdomínios). Configurado pelo admin em E-mail → Bloqueios.
 */

export type BlockKind = 'email' | 'domain'

/** Remetentes automáticos que nunca abrem chamado (avisos de não entrega etc.). */
export const SYSTEM_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /^mailer-daemon@/i, label: 'mailer-daemon@ (aviso de não entrega)' },
  { pattern: /^postmaster@/i, label: 'postmaster@ (aviso de não entrega)' },
  { pattern: /^microsoftexchange[0-9a-f]*@/i, label: 'microsoftexchange…@ (aviso do Exchange)' },
]

const emailSchema = z.string().trim().toLowerCase().email().max(255)
const domainSchema = z.string().trim().toLowerCase().transform(v => v.replace(/^@/, ''))
  .pipe(z.string().max(253).regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Domínio inválido (ex.: exemplo.com.br)'))

export const createBlockSchema = z.object({
  kind: z.enum(['email', 'domain']),
  value: z.string().min(1).max(255),
  reason: z.string().trim().max(300).nullish(),
})

// Cache curto: cada e-mail que chega consulta a lista sem ir ao banco toda vez.
const TTL_MS = 30_000
let cache: { at: number; rows: { id: string; kind: string; value: string }[] } | null = null
async function rules() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), rows: await prisma.emailBlock.findMany({ select: { id: true, kind: true, value: true } }) }
  }
  return cache.rows
}
/** Esquece a lista em memória (após mudar a tabela fora deste módulo, ex.: testes). */
export function resetBlocklistCache() { cache = null }

/** Motivo do bloqueio, ou null se o remetente pode abrir chamado. */
export async function blockedReason(email: string): Promise<string | null> {
  const addr = email.trim().toLowerCase()
  const system = SYSTEM_RULES.find(r => r.pattern.test(addr))
  if (system) return `remetente automático: ${system.label}`

  const domain = addr.split('@')[1] ?? ''
  const hit = (await rules()).find(r => r.kind === 'email'
    ? r.value === addr
    : domain === r.value || domain.endsWith(`.${r.value}`))
  if (!hit) return null
  // Contador só informativo: falha aqui não muda o bloqueio.
  prisma.emailBlock.update({ where: { id: hit.id }, data: { hits: { increment: 1 }, last_hit_at: new Date() } }).catch(() => {})
  return `remetente bloqueado (${hit.kind === 'email' ? 'e-mail' : 'domínio'} ${hit.value})`
}

/** Para a abertura de chamado: lança 422 SENDER_BLOCKED se o remetente está bloqueado. */
export async function assertSenderAllowed(email: string) {
  const reason = await blockedReason(email)
  if (reason) throw new AppError(422, `Chamado não aberto: ${reason}. Ajuste em Admin → E-mail → Bloqueios.`, 'SENDER_BLOCKED')
}

export async function listBlocks() {
  const rows = await prisma.emailBlock.findMany({ orderBy: [{ kind: 'asc' }, { value: 'asc' }] })
  return { data: rows, system: SYSTEM_RULES.map(r => r.label) }
}

export async function createBlock(input: unknown, actorId: string | undefined) {
  const data = createBlockSchema.parse(input)
  const parsed = (data.kind === 'email' ? emailSchema : domainSchema).safeParse(data.value)
  if (!parsed.success) throw new AppError(400, data.kind === 'email' ? 'E-mail inválido' : 'Domínio inválido (ex.: exemplo.com.br)', 'INVALID_BLOCK_VALUE')
  const value = parsed.data

  const exists = await prisma.emailBlock.findUnique({ where: { kind_value: { kind: data.kind, value } } })
  if (exists) throw new AppError(409, 'Esse remetente já está bloqueado', 'BLOCK_EXISTS')

  const row = await prisma.emailBlock.create({ data: { kind: data.kind, value, reason: data.reason || null, created_by_id: actorId ?? null } })
  cache = null
  await createAuditLog({ userId: actorId, action: 'EMAIL_BLOCK_CREATE', resource: 'EMAIL', details: { kind: row.kind, value: row.value, reason: row.reason } })
  return row
}

export async function deleteBlock(id: string, actorId: string | undefined) {
  const row = await prisma.emailBlock.findUnique({ where: { id } })
  if (!row) throw new AppError(404, 'Bloqueio não encontrado', 'NOT_FOUND')
  await prisma.emailBlock.delete({ where: { id } })
  cache = null
  await createAuditLog({ userId: actorId, action: 'EMAIL_BLOCK_DELETE', resource: 'EMAIL', details: { kind: row.kind, value: row.value, reason: row.reason, hits: row.hits } })
}
