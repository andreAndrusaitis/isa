import { z } from 'zod'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { validateWebhookUrl } from './webhookDelivery'
import { WEBHOOK_EVENTS } from './webhookEvents'

const filtersSchema = z.object({
  types: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  queues: z.array(z.string()).optional(),
  org_ids: z.array(z.string()).optional(),
  category_ids: z.array(z.string()).optional(),
  subcategory_ids: z.array(z.string()).optional(),
  manager_ids: z.array(z.string()).optional(),
}).strict()

const configuredEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  secret: z.string().trim().min(1),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  active: z.boolean().default(true),
  filters: filtersSchema.optional().nullable(),
})

export type ConfiguredWebhookEndpoint = z.infer<typeof configuredEndpointSchema>

export function parseConfiguredWebhookEndpoints(): ConfiguredWebhookEndpoint[] {
  const endpoints: ConfiguredWebhookEndpoint[] = []
  const rawEndpoints = normalizeNullableString(env.WEBHOOK_BOOTSTRAP_ENDPOINTS)

  if (rawEndpoints) {
    const parsed = JSON.parse(rawEndpoints)
    const source = Array.isArray(parsed) ? parsed : [parsed]
    endpoints.push(...z.array(configuredEndpointSchema).parse(source))
  }

  return endpoints
}

export async function ensureConfiguredWebhookEndpoints(): Promise<number> {
  const endpoints = parseConfiguredWebhookEndpoints()

  for (const endpoint of endpoints) {
    await validateWebhookUrl(endpoint.url)

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { name: endpoint.name },
      orderBy: { created_at: 'asc' },
      select: { id: true },
    })
    const data = {
      name: endpoint.name,
      url: endpoint.url,
      secret: endpoint.secret,
      events: endpoint.events,
      active: endpoint.active,
      filters: endpoint.filters ?? undefined,
    }

    if (existing) {
      await prisma.webhookEndpoint.update({
        where: { id: existing.id },
        data,
      })
    } else {
      await prisma.webhookEndpoint.create({ data })
    }
  }

  return endpoints.length
}

export function startConfiguredWebhookBootstrap(): void {
  ensureConfiguredWebhookEndpoints()
    .then((count) => {
      if (count > 0) {
        logger.info(`[Webhooks] ${count} endpoint(s) configurado(s) via env`)
      }
    })
    .catch((error) => {
      logger.error('[Webhooks] Falha ao configurar endpoints via env:', { err: error })
    })
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}
