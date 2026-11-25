import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', WEBHOOKS_ALLOW_PRIVATE_URLS: false },
}))

const prismaMock = vi.hoisted(() => ({
  webhookEndpoint: { findMany: vi.fn() },
  webhookDelivery: { create: vi.fn() },
  ticket: { findUnique: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

const attemptDeliveryMock = vi.hoisted(() => vi.fn())
vi.mock('./webhookDelivery', () => ({
  attemptDelivery: (...args: any[]) => attemptDeliveryMock(...args),
}))

import {
  emitWebhookEventInternal,
  emitWebhookEvent,
  buildTicketPayload,
  buildUserPayload,
  buildMessagePayload,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
} from './webhookEvents'

beforeEach(() => {
  prismaMock.webhookEndpoint.findMany.mockReset()
  prismaMock.webhookDelivery.create.mockReset()
  prismaMock.webhookDelivery.create.mockImplementation(async ({ data }: any) => data)
  prismaMock.ticket.findUnique.mockReset()
  // Por padrão o ticket não é reencontrado — emitWebhookEventInternal segue
  // sem o enriquecimento (usa só o snapshot recebido pelo call site).
  prismaMock.ticket.findUnique.mockResolvedValue(null)
  attemptDeliveryMock.mockReset()
  attemptDeliveryMock.mockResolvedValue(undefined)
})

describe('emitWebhookEventInternal', () => {
  it('cria uma delivery por endpoint assinante e dispara a tentativa imediata', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([{ id: 'ep-1' }, { id: 'ep-2' }])

    const ids = await emitWebhookEventInternal('ticket.created', { ticket: { id: 'ISA-1001' } })

    expect(ids).toHaveLength(2)
    // Filtro correto: só endpoints ativos que assinam o evento
    expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, events: { has: 'ticket.created' } },
    }))
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(2)
    expect(attemptDeliveryMock).toHaveBeenCalledTimes(2)
  })

  it('não cria nada quando ninguém assina o evento', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([])
    const ids = await emitWebhookEventInternal('user.created', { user: {} })
    expect(ids).toEqual([])
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled()
    expect(attemptDeliveryMock).not.toHaveBeenCalled()
  })

  it('grava o envelope { event, timestamp, delivery_id, data } no payload', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([{ id: 'ep-1' }])

    const [id] = await emitWebhookEventInternal('sla.warning', { foo: 'bar' })

    const created = prismaMock.webhookDelivery.create.mock.calls[0][0].data
    expect(created.event).toBe('sla.warning')
    expect(created.payload.event).toBe('sla.warning')
    expect(created.payload.delivery_id).toBe(id)
    expect(created.payload.data).toEqual({ foo: 'bar' })
    expect(new Date(created.payload.timestamp).getTime()).not.toBeNaN()
  })

  it('enriquece data.ticket com descrição/organização/anexos quando o ticket ainda existe', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([{ id: 'ep-1', filters: null }])
    prismaMock.ticket.findUnique.mockResolvedValue({
      id: 'ISA-1001',
      description: 'Detalhe completo do problema',
      org: { id: 'org-1', name: 'ACME' },
      user: { id: 'u-1', name: 'Maria', email: 'maria@acme.com' },
      category: { id: 'cat-1', name: 'Financeiro' },
      subcategory: null,
      attachment_url: null,
      attachments: [],
    })

    await emitWebhookEventInternal('ticket.created', { ticket: { id: 'ISA-1001', title: 'Erro' } })

    const created = prismaMock.webhookDelivery.create.mock.calls[0][0].data
    expect(created.payload.data.ticket.description).toBe('Detalhe completo do problema')
    expect(created.payload.data.ticket.organization).toEqual({ id: 'org-1', name: 'ACME' })
  })

  it('respeita os filtros do endpoint (ex.: só prioridade alta) e pula quem não casa', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-alta', filters: { priorities: ['high'] } },
      { id: 'ep-qualquer', filters: null },
    ])
    prismaMock.ticket.findUnique.mockResolvedValue(null)

    const ids = await emitWebhookEventInternal('ticket.created', { ticket: { id: 'ISA-1001', priority: 'low' } })

    // Só o endpoint sem filtro deve receber; o filtrado por 'high' é pulado.
    expect(ids).toHaveLength(1)
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.webhookDelivery.create.mock.calls[0][0].data.endpoint_id).toBe('ep-qualquer')
  })

  it('filtra ticket.inactive pelo gestor do analista (atual ou anterior)', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-gestor-x', filters: { manager_ids: ['gestor-x'] } },
      { id: 'ep-gestor-y', filters: { manager_ids: ['gestor-y'] } },
      { id: 'ep-gestor-z', filters: { manager_ids: ['gestor-z'] } },
    ])
    prismaMock.ticket.findUnique.mockResolvedValue(null)

    const ids = await emitWebhookEventInternal('ticket.inactive', {
      ticket: { id: 'ISA-1001' },
      inactive_hours: 8,
      manager_id: 'gestor-x',
      previous_manager_id: 'gestor-y',
    })

    // Gestor atual e anterior passam; o gestor sem relação com o chamado é pulado.
    expect(ids).toHaveLength(2)
    const endpoints = prismaMock.webhookDelivery.create.mock.calls.map((c: any) => c[0].data.endpoint_id)
    expect(endpoints).toEqual(['ep-gestor-x', 'ep-gestor-y'])
  })

  it('resolve manager_id pelo analista responsável quando o call site não informa', async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-gestor-x', filters: { manager_ids: ['gestor-x'] } },
      { id: 'ep-gestor-z', filters: { manager_ids: ['gestor-z'] } },
    ])
    prismaMock.ticket.findUnique.mockResolvedValue({
      id: 'ISA-1001',
      attachments: [],
      attachment_url: null,
      assigned_to: { id: 'agente-1', name: 'Ana', manager_id: 'gestor-x' },
    })

    const ids = await emitWebhookEventInternal('ticket.updated', { ticket: { id: 'ISA-1001' } })

    expect(ids).toEqual([expect.any(String)])
    expect(prismaMock.webhookDelivery.create.mock.calls[0][0].data.endpoint_id).toBe('ep-gestor-x')
  })
})

describe('emitWebhookEvent (fire-safe)', () => {
  it('não emite em ambiente de teste e nunca lança', () => {
    expect(() => emitWebhookEvent('ticket.created', {})).not.toThrow()
    expect(prismaMock.webhookEndpoint.findMany).not.toHaveBeenCalled()
  })
})

describe('builders de payload', () => {
  it('buildTicketPayload inclui description/organização/anexos quando fornecidos', () => {
    const payload = buildTicketPayload({
      id: 'ISA-1001', title: 'Erro', status: 'open', priority: 'high',
      description: 'Detalhe do problema', attachment_url: 'blob/erro.png',
      org_id: 'org-1', user_id: 'u-1',
      organization: { id: 'org-1', name: 'ACME' },
      category: { id: 'cat-1', name: 'Financeiro' },
    })
    expect(payload.id).toBe('ISA-1001')
    expect(payload.description).toBe('Detalhe do problema')
    expect(payload.attachment_url).toBe('blob/erro.png')
    expect((payload.organization as any).name).toBe('ACME')
  })

  it('buildUserPayload não expõe senha', () => {
    const payload = buildUserPayload({ id: 'u-1', name: 'Ana', email: 'a@b.com', role: 'user', password: 'hash' })
    expect(payload.email).toBe('a@b.com')
    expect(payload).not.toHaveProperty('password')
  })

  it('buildMessagePayload trunca textos longos', () => {
    const payload = buildMessagePayload({ id: 'm-1', text: 'y'.repeat(5000) })
    expect((payload.text as string).length).toBe(2000)
  })
})

describe('catálogo de eventos', () => {
  it('todo evento tem label/grupo/descrição para a UI', () => {
    for (const event of WEBHOOK_EVENTS) {
      expect(WEBHOOK_EVENT_LABELS[event]?.label, event).toBeTruthy()
      expect(WEBHOOK_EVENT_LABELS[event]?.group, event).toBeTruthy()
      expect(WEBHOOK_EVENT_LABELS[event]?.description, event).toBeTruthy()
    }
  })
})
