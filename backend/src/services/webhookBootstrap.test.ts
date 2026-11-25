import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    WEBHOOKS_ALLOW_PRIVATE_URLS: false,
    WEBHOOK_BOOTSTRAP_ENDPOINTS: JSON.stringify([
      {
        name: 'Power Automate',
        url: 'https://example.com/power-automate',
        secret: 'whsec_power',
        events: ['ticket.created']
      },
      {
        name: 'Hub',
        url: 'https://hooks.example.com/tickets',
        secret: 'whsec_hub',
        events: ['ticket.created', 'ticket.updated']
      }
    ])
  },
}))

const prismaMock = vi.hoisted(() => ({
  webhookEndpoint: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

// DNS real é lento/instável em teste; resolve os hosts públicos usados aqui
// para um IP público fixo (validateWebhookUrl faz lookup antes de aceitar).
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

import {
  ensureConfiguredWebhookEndpoints,
  parseConfiguredWebhookEndpoints,
} from './webhookBootstrap'

const HUB_URL = 'https://hooks.example.com/tickets'
const HUB_EVENTS = ['ticket.created', 'ticket.updated']

beforeEach(() => {
  prismaMock.webhookEndpoint.findFirst.mockReset()
  prismaMock.webhookEndpoint.create.mockReset()
  prismaMock.webhookEndpoint.update.mockReset()
  prismaMock.webhookEndpoint.findFirst.mockResolvedValue(null)
  prismaMock.webhookEndpoint.create.mockImplementation(async ({ data }: any) => ({ id: `${data.name}-id`, ...data }))
  prismaMock.webhookEndpoint.update.mockImplementation(async ({ data }: any) => ({ id: 'existing-id', ...data }))
})

describe('parseConfiguredWebhookEndpoints', () => {
  it('le endpoints genericos por JSON', () => {
    const endpoints = parseConfiguredWebhookEndpoints()

    expect(endpoints.map((endpoint) => endpoint.name)).toEqual(['Power Automate', 'Hub'])
    expect(endpoints[0]).toMatchObject({
      url: 'https://example.com/power-automate',
      secret: 'whsec_power',
      events: ['ticket.created'],
      active: true,
    })
    expect(endpoints[1]).toMatchObject({ url: HUB_URL, secret: 'whsec_hub', events: HUB_EVENTS, active: true })
  })
})

describe('ensureConfiguredWebhookEndpoints', () => {
  it('cria endpoints configurados por env quando ainda nao existem', async () => {
    await ensureConfiguredWebhookEndpoints()

    expect(prismaMock.webhookEndpoint.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.webhookEndpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Hub',
        url: HUB_URL,
        secret: 'whsec_hub',
        events: HUB_EVENTS,
        active: true,
      }),
    })
  })

  it('atualiza endpoint existente pelo nome para manter infra como fonte de verdade', async () => {
    prismaMock.webhookEndpoint.findFirst.mockResolvedValueOnce({ id: 'existing-power' })
    prismaMock.webhookEndpoint.findFirst.mockResolvedValueOnce({ id: 'existing-hub' })

    await ensureConfiguredWebhookEndpoints()

    expect(prismaMock.webhookEndpoint.create).not.toHaveBeenCalled()
    expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith({
      where: { id: 'existing-hub' },
      data: expect.objectContaining({
        url: HUB_URL,
        secret: 'whsec_hub',
        events: HUB_EVENTS,
        active: true,
      }),
    })
  })
})
