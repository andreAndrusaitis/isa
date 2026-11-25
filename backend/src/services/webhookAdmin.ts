/**
 * CRUD administrativo de webhooks de saída.
 *
 * Segurança de credenciais: secret plaintext no banco (necessário para
 * assinar cada envio), mas NUNCA retornado em listagens — só na
 * criação/regeneração.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, WebhookEventType, buildExamplePayload, buildEventJsonSchema } from './webhookEvents'
import { attemptDelivery, validateWebhookUrl } from './webhookDelivery'

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------

const eventList = z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Selecione pelo menos um evento')

const filtersSchema = z.object({
  types: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  queues: z.array(z.string()).optional(),
  org_ids: z.array(z.string()).optional(),
  category_ids: z.array(z.string()).optional(),
  subcategory_ids: z.array(z.string()).optional(),
  manager_ids: z.array(z.string()).optional(),
}).strict()

export const createEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  events: eventList,
  filters: filtersSchema.optional().nullable(),
  active: z.boolean().default(true),
})

export const updateEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2000).optional(),
  events: eventList.optional(),
  filters: filtersSchema.optional().nullable(),
  active: z.boolean().optional(),
})

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const ENDPOINT_SAFE_SELECT = {
  id: true,
  name: true,
  url: true,
  events: true,
  filters: true,
  active: true,
  created_by_id: true,
  created_at: true,
  updated_at: true,
} as const

function newSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`
}

async function getEndpointOr404(id: string) {
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id } })
  if (!endpoint) throw new AppError(404, 'Webhook não encontrado', 'WEBHOOK_NOT_FOUND')
  return endpoint
}

// ------------------------------------------------------------------
// Outbound — endpoints
// ------------------------------------------------------------------

export function listWebhookEvents() {
  return WEBHOOK_EVENTS
    .filter((event) => event !== 'ping')
    .map((event) => ({ event, ...WEBHOOK_EVENT_LABELS[event] }))
}

/**
 * Gera um payload de exemplo (envelope + dados fictícios) para um evento.
 * Usado pela UI admin para o operador copiar/colar em outros sistemas —
 * ex.: "Usar conteúdo de exemplo para gerar o esquema" no Power Automate.
 */
export function getEventExample(event: string) {
  if (!WEBHOOK_EVENTS.includes(event as WebhookEventType)) {
    throw new AppError(404, 'Evento desconhecido', 'WEBHOOK_EVENT_NOT_FOUND')
  }
  return buildExamplePayload(event as WebhookEventType)
}

/**
 * JSON Schema (draft-07) pronto para colar em campos como "Solicitar Esquema
 * JSON do Corpo" (gatilho HTTP do Power Automate) — sem precisar da etapa
 * "gerar a partir de um exemplo".
 */
export function getEventJsonSchema(event: string) {
  if (!WEBHOOK_EVENTS.includes(event as WebhookEventType)) {
    throw new AppError(404, 'Evento desconhecido', 'WEBHOOK_EVENT_NOT_FOUND')
  }
  return buildEventJsonSchema(event as WebhookEventType)
}

export async function listEndpoints() {
  const endpoints = await prisma.webhookEndpoint.findMany({
    select: {
      ...ENDPOINT_SAFE_SELECT,
      deliveries: {
        select: { status: true },
        orderBy: { created_at: 'desc' },
        take: 50,
      },
    },
    orderBy: { created_at: 'asc' },
  })

  // Resumo de saúde das últimas 50 entregas (para o indicador na UI).
  return endpoints.map(({ deliveries, ...endpoint }) => ({
    ...endpoint,
    recent_deliveries: {
      total: deliveries.length,
      success: deliveries.filter((d) => d.status === 'success').length,
      failed: deliveries.filter((d) => d.status === 'failed').length,
      pending: deliveries.filter((d) => d.status === 'pending').length,
    },
  }))
}

export async function createEndpoint(input: unknown, audit?: AuditInfo) {
  const data = createEndpointSchema.parse(input)
  await validateWebhookUrl(data.url)

  const secret = newSecret()
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ...data,
      secret,
      created_by_id: audit?.actorId ?? null,
      filters: data.filters === null ? Prisma.DbNull : data.filters !== undefined ? data.filters : undefined,
    },
    select: ENDPOINT_SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_WEBHOOK_ENDPOINT',
      resource: 'WEBHOOK',
      details: { endpointId: endpoint.id, name: endpoint.name, url: endpoint.url, events: endpoint.events },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  // O secret só é exposto aqui, uma única vez.
  return { ...endpoint, secret }
}

export async function updateEndpoint(id: string, input: unknown, audit?: AuditInfo) {
  await getEndpointOr404(id)
  const data = updateEndpointSchema.parse(input)
  if (data.url) await validateWebhookUrl(data.url)

  const endpoint = await prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...data,
      filters: data.filters === null ? Prisma.DbNull : data.filters !== undefined ? data.filters : undefined,
    },
    select: ENDPOINT_SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_WEBHOOK_ENDPOINT',
      resource: 'WEBHOOK',
      details: { endpointId: id, changes: data },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  return endpoint
}

export async function deleteEndpoint(id: string, audit?: AuditInfo) {
  const endpoint = await getEndpointOr404(id)
  await prisma.webhookEndpoint.delete({ where: { id } })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_WEBHOOK_ENDPOINT',
      resource: 'WEBHOOK',
      details: { endpointId: id, name: endpoint.name, url: endpoint.url },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
}

export async function regenerateEndpointSecret(id: string, audit?: AuditInfo) {
  await getEndpointOr404(id)
  const secret = newSecret()
  const endpoint = await prisma.webhookEndpoint.update({
    where: { id },
    data: { secret },
    select: ENDPOINT_SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'REGENERATE_WEBHOOK_SECRET',
      resource: 'WEBHOOK',
      details: { endpointId: id },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  return { ...endpoint, secret }
}

/** Dispara um evento 'ping' síncrono e retorna o resultado da entrega. */
export async function testEndpoint(id: string) {
  const endpoint = await getEndpointOr404(id)

  const deliveryId = randomUUID()
  await prisma.webhookDelivery.create({
    data: {
      id: deliveryId,
      endpoint_id: endpoint.id,
      event: 'ping',
      payload: {
        event: 'ping',
        timestamp: new Date().toISOString(),
        delivery_id: deliveryId,
        data: { message: 'Evento de teste disparado pelo painel do ISA' },
      },
      status: 'pending',
      next_retry_at: null,
    },
  })

  await attemptDelivery(deliveryId)

  const result = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { status: true, response_status: true, duration_ms: true, error_message: true },
  })
  return result
}

const DELIVERIES_PAGE_SIZE = 20

export async function listDeliveries(endpointId: string, page = 1, status?: string) {
  await getEndpointOr404(endpointId)

  const where: any = { endpoint_id: endpointId }
  if (status && ['pending', 'success', 'failed'].includes(status)) where.status = status

  const [total, deliveries] = await Promise.all([
    prisma.webhookDelivery.count({ where }),
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * DELIVERIES_PAGE_SIZE,
      take: DELIVERIES_PAGE_SIZE,
    }),
  ])

  return {
    data: deliveries,
    meta: { total, page, pages: Math.max(1, Math.ceil(total / DELIVERIES_PAGE_SIZE)) },
  }
}

/** Reenvio manual: zera tentativas e tenta imediatamente. */
export async function retryDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } })
  if (!delivery) throw new AppError(404, 'Entrega não encontrada', 'DELIVERY_NOT_FOUND')

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'pending', attempts: 0, next_retry_at: null, error_message: null },
  })
  await attemptDelivery(deliveryId)

  return prisma.webhookDelivery.findUnique({ where: { id: deliveryId } })
}
