import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../config/prisma', () => ({ default: { emailLog: { create } } }))
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../config/env', () => ({ env: { PORTAL_URL: 'http://portal', AZURE_COMMUNICATION_CONNECTION_STRING: undefined } }))

import { sendSurveyEmail, sendTicketUpdateEmail, sendWelcomeEmail } from './mailer'

describe('mailer grava email_logs', () => {
  beforeEach(() => create.mockReset().mockResolvedValue({}))

  it('registra tipo, destinatário, status e chamado de cada envio', async () => {
    const r = await sendTicketUpdateEmail({
      to: 'cli@x.com', ticketId: 't1', clientName: 'Cli', ticketNumber: 'INC-1', ticketTitle: 'T',
      status: null, replies: ['oi'],
    } as any)
    expect(r.status).toBe('SKIPPED_ACS_NOT_CONFIGURED')
    expect(create.mock.calls[0][0].data).toMatchObject({
      kind: 'ticket_update', recipient: 'cli@x.com', status: 'SKIPPED_ACS_NOT_CONFIGURED', ticket_id: 't1',
    })
  })

  it('guarda o corpo do e-mail, mas nunca a senha inicial', async () => {
    await sendWelcomeEmail({ to: 'u@x.com', name: 'U', initialPassword: 'S3nh@Secreta' })
    const { html } = create.mock.calls[0][0].data
    expect(html).toContain('U')
    expect(html).not.toContain('S3nh@Secreta')
    expect(html).toContain('••••••••')
  })

  it('guarda o convite da pesquisa com o link mascarado; o cliente recebe o link real', async () => {
    const linkSurvey = 'http://portal/survey/abc123token'
    await sendSurveyEmail({
      to: 'cli@x.com', ticketId: 't1', vars: {} as any, linkSurvey,
      subjectTemplate: 'Pesquisa', bodyTemplate: 'Responda:\n{link_pesquisa}',
    })
    const { html } = create.mock.calls[0][0].data
    expect(html).not.toContain('abc123token')
    expect(html).toContain('http://portal/survey/••••••••')
  })

  it('falha ao gravar o log não derruba o envio', async () => {
    // thenable que falha: o tracking de promise rejeitada do vitest 2 acusa erro mesmo com .catch
    create.mockReturnValue({ catch: (h: (e: Error) => unknown) => Promise.resolve(h(new Error('db down'))) })
    const r = await sendWelcomeEmail({ to: 'u@x.com', name: 'U' })
    expect(r.status).toBe('SKIPPED_ACS_NOT_CONFIGURED')
    expect(create.mock.calls[0][0].data).toMatchObject({ kind: 'welcome', ticket_id: null })
  })
})
