import prisma from '../config/prisma'
import { ReopenSlaConfig } from '@prisma/client'

export async function getReopenSlaConfig(): Promise<ReopenSlaConfig> {
  let config = await prisma.reopenSlaConfig.findFirst()
  if (!config) {
    config = await prisma.reopenSlaConfig.create({
      data: {
        enabled: true,
        reopen_limit_hours: 24,
        reopen_deadline_rule: 'org_sla',
        reopen_deadline_hours: 8,
      },
    })
  }
  return config
}

export async function upsertReopenSlaConfig(data: Partial<Omit<ReopenSlaConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<ReopenSlaConfig> {
  const existing = await prisma.reopenSlaConfig.findFirst()
  if (existing) {
    return prisma.reopenSlaConfig.update({
      where: { id: existing.id },
      data,
    })
  }
  return prisma.reopenSlaConfig.create({
    data: {
      enabled: data.enabled ?? true,
      reopen_limit_hours: data.reopen_limit_hours ?? 24,
      reopen_deadline_rule: data.reopen_deadline_rule ?? 'org_sla',
      reopen_deadline_hours: data.reopen_deadline_hours ?? 8,
    },
  })
}
