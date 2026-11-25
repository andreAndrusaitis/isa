import prisma from '../config/prisma'
import { createAuditLog } from './audit'
import type { BusinessHoursConfig } from '@prisma/client'

// Cache em memória do singleton. Invalidado a cada update.
let cache: BusinessHoursConfig | null = null

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
  if (cache) return cache
  let cfg = await prisma.businessHoursConfig.findFirst()
  if (!cfg) cfg = await prisma.businessHoursConfig.create({ data: {} })
  cache = cfg
  return cfg
}

export async function updateBusinessHoursConfig(
  data: Partial<Omit<BusinessHoursConfig, 'id' | 'created_at' | 'updated_at'>>,
  actorId?: string,
): Promise<BusinessHoursConfig> {
  const existing = await prisma.businessHoursConfig.findFirst()
  const cfg = existing
    ? await prisma.businessHoursConfig.update({ where: { id: existing.id }, data })
    : await prisma.businessHoursConfig.create({ data: data as any })
  cache = cfg
  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'UPDATE_BUSINESS_HOURS',
      resource: 'SLA',
      details: { changes: data },
    })
  }
  return cfg
}
