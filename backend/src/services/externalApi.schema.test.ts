import { describe, expect, it } from 'vitest'
import { closureSchema, createTicketSchema } from './externalApi'

describe('external integration schemas', () => {
  it('requires a resolved or closed status for ticket closure', () => {
    expect(closureSchema.parse({ status: 'resolved' })).toEqual({ status: 'resolved' })
    expect(closureSchema.parse({ status: 'closed', note: 'Done' })).toEqual({ status: 'closed', note: 'Done' })
    expect(() => closureSchema.parse({ note: 'Missing status' })).toThrow()
    expect(() => closureSchema.parse({ status: 'pending' })).toThrow()
  })

  it('accepts scalar and array special form values', () => {
    const payload = createTicketSchema.parse({
      requester: { email: 'user@example.com' },
      ticket: { special_data: { ambiente: 'production', ambientes: ['production', 'homologation'] } },
    })

    expect(payload.ticket.special_data).toEqual({ ambiente: 'production', ambientes: ['production', 'homologation'] })
  })
})
