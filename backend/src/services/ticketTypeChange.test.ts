import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  ticketTypeConfig: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))
// 24x7 sem feriados: 1 h útil = 1 h de relógio, o que deixa as contas legíveis.
vi.mock('./businessHours', () => ({
  getBusinessHoursConfig: async () => ({ business_hours_start: '00:00', business_hours_end: '24:00', working_days: [1, 2, 3, 4, 5, 6, 7], timezone: 'UTC' }),
}))
vi.mock('../utils/businessHours', async (orig) => ({ ...(await orig<object>()), holidaysAround: () => [] }))

import { computeTicketTypeChange } from './ticketTypeChange'

const H = 3_600_000
const created = new Date('2026-10-05T10:00:00Z')

describe('computeTicketTypeChange — prazos contam desde a abertura', () => {
  beforeEach(() => {
    prismaMock.ticketTypeConfig.findUnique.mockResolvedValue(null)
    prismaMock.organization.findUnique.mockResolvedValue({
      sla_config: { request_first_response_hours: 24, request_resolution_hours: 96 },
    })
  })

  it('Incidente → Requisição dias depois: prazo do plano contado da abertura, não da troca', async () => {
    const change = await computeTicketTypeChange(
      { type: 'incident', display_number: 'INC-42', org_id: 'org', created_at: created, total_paused_minutes: 0 },
      'request',
    )
    expect(change.display_number).toBe('REQ-42')
    expect(change.first_response_deadline.getTime()).toBe(created.getTime() + 24 * H)
    expect(change.sla_deadline.getTime()).toBe(created.getTime() + 96 * H)
  })

  it('número = só os dígitos finais: dígito do prefixo não vaza para o número', async () => {
    const change = (display_number: string) =>
      computeTicketTypeChange({ type: 'incident', display_number, org_id: 'org', created_at: created }, 'request')
    expect((await change('ISA-1463')).display_number).toBe('REQ-1463')
    expect((await change('INC-11463')).display_number).toBe('REQ-11463')
  })

  it('tempo já pausado (pendente) estende a resolução, como no fim da pausa', async () => {
    const change = await computeTicketTypeChange(
      { type: 'incident', display_number: 'INC-42', org_id: 'org', created_at: created, total_paused_minutes: 120 },
      'request',
    )
    expect(change.sla_deadline.getTime()).toBe(created.getTime() + 98 * H)
    expect(change.first_response_deadline.getTime()).toBe(created.getTime() + 24 * H)
  })
})
