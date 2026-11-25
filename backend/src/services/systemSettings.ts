/**
 * Configurações do sistema (tabela system_settings): valor em JSON e segredos
 * cifrados. O cache curto serve às telas públicas; com várias instâncias, uma
 * mudança aparece nas outras em até CACHE_MS.
 */
import prisma from '../config/prisma'
import { createAuditLog } from './audit'
import { open, seal } from '../utils/secretBox'
import type { AuditInfo } from '../utils/audit'

export type SettingKey = 'appearance' | 'sso_microsoft' | 'ai_provider'
export interface SettingRow {
  value: Record<string, unknown>
  secrets: Record<string, string>
  updatedAt: number
}

const CACHE_MS = 10_000
const cache = new Map<SettingKey, { at: number; row: SettingRow | null }>()

export async function readSetting(key: SettingKey, { fresh = false } = {}): Promise<SettingRow | null> {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.row
  const found = await prisma.systemSetting.findUnique({ where: { key } })
  const row = found && {
    value: (found.value ?? {}) as Record<string, unknown>,
    secrets: (found.secrets ?? {}) as Record<string, string>,
    updatedAt: found.updated_at.getTime(),
  }
  cache.set(key, { at: Date.now(), row })
  return row
}

export function openSecret(key: SettingKey, row: SettingRow | null, name: string): string | null {
  const sealed = row?.secrets[name]
  return sealed ? open(sealed, `${key}.${name}`) : null
}

/**
 * Grava o valor e os segredos informados. `secrets`: texto troca, null apaga,
 * ausente mantém. A auditoria registra o valor e só os NOMES dos segredos alterados.
 */
export async function writeSetting(
  key: SettingKey,
  value: Record<string, unknown>,
  secrets: Record<string, string | null | undefined>,
  audit: AuditInfo,
): Promise<SettingRow> {
  const current = await readSetting(key, { fresh: true })
  const sealed = { ...(current?.secrets ?? {}) }
  const changed: string[] = []
  for (const [name, plain] of Object.entries(secrets)) {
    if (plain === undefined) continue
    changed.push(name)
    if (plain === null) delete sealed[name]
    else sealed[name] = seal(plain, `${key}.${name}`)
  }
  const data = { value: value as object, secrets: sealed, updated_by_id: audit.actorId ?? null }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, ...data }, update: data })
  cache.delete(key)
  await createAuditLog({
    userId: audit.actorId,
    action: 'UPDATE_SYSTEM_SETTING',
    resource: 'SYSTEM_SETTING',
    details: { key, before: current?.value ?? null, after: value, secretsChanged: changed },
    ip: audit.ip,
    userAgent: audit.userAgent,
  })
  return (await readSetting(key, { fresh: true }))!
}

export async function clearSetting(key: SettingKey, audit: AuditInfo): Promise<void> {
  const current = await readSetting(key, { fresh: true })
  if (!current) return
  await prisma.systemSetting.delete({ where: { key } })
  cache.delete(key)
  await createAuditLog({
    userId: audit.actorId, action: 'RESET_SYSTEM_SETTING', resource: 'SYSTEM_SETTING',
    details: { key, before: current.value }, ip: audit.ip, userAgent: audit.userAgent,
  })
}

export const forgetSettingsCache = () => cache.clear()
