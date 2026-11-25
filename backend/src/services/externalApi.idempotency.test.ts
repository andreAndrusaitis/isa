// Janela entre gravar o log e marcá-lo "processing": a retentativa que lê o log
// nesse instante não pode executar a operação de novo. A corrida real é intermitente
// (e2e/17 e e2e/22); aqui o estado é injetado, então o resultado é sempre o mesmo.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  apiRequestLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))

import { runIdempotent } from './externalApi'

const owner = { project_api_key_id: 'chave-1' }
const pedido = { external_request_id: 'pedido-1' }
const operacao = () => vi.fn(async () => ({ statusCode: 201, resourceType: 'task', resourceId: 't1', body: {} }))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.apiRequestLog.update.mockResolvedValue({})
})

describe('runIdempotent com pedido repetido', () => {
  it('recusa quando o outro pedido acabou de gravar o log (received)', async () => {
    prismaMock.apiRequestLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'received' })
    const handler = operacao()

    await expect(runIdempotent(owner, 'POST', '/x', pedido, {}, handler)).rejects.toMatchObject({ statusCode: 409 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('recusa enquanto o outro pedido está em processamento', async () => {
    prismaMock.apiRequestLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'processing' })
    const handler = operacao()

    await expect(runIdempotent(owner, 'POST', '/x', pedido, {}, handler)).rejects.toMatchObject({ statusCode: 409 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('devolve duplicate quando o pedido já terminou', async () => {
    prismaMock.apiRequestLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'success', resource_id: 't1' })
    const handler = operacao()

    const r = await runIdempotent(owner, 'POST', '/x', pedido, {}, handler)
    expect(r.statusCode).toBe(200)
    expect(handler).not.toHaveBeenCalled()
  })

  it('executa de novo quando o pedido anterior falhou', async () => {
    prismaMock.apiRequestLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'failed' })
    const handler = operacao()

    await runIdempotent(owner, 'POST', '/x', pedido, {}, handler)
    expect(handler).toHaveBeenCalledOnce()
  })
})
