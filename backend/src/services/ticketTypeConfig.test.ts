import { describe, it, expect, afterEach } from 'vitest'
import prisma from '../config/prisma'
import { listTicketTypeConfigs, setTicketTypeEnabled } from './ticketTypeConfig'

afterEach(async () => {
  await prisma.ticketTypeConfig.updateMany({ data: { enabled: true } })
})

describe('TicketTypeConfig', () => {
  it('lista os 4 tipos', async () => {
    const configs = await listTicketTypeConfigs()
    expect(configs.map(c => c.type).sort()).toEqual(['change', 'incident', 'problem', 'request'])
  })

  it('permite desabilitar request', async () => {
    const updated = await setTicketTypeEnabled('request', false)
    expect(updated.enabled).toBe(false)
  })

  it('tipo inexistente responde 404, não 500', async () => {
    await expect(setTicketTypeEnabled('nao-existe', false)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  it('rejeita desabilitar incident', async () => {
    await expect(setTicketTypeEnabled('incident', false)).rejects.toMatchObject({ statusCode: 400 })
  })
})
