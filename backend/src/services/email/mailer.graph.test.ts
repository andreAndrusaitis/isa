import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create, sendGraphMail, configured } = vi.hoisted(() => ({
  create: vi.fn(), sendGraphMail: vi.fn(), configured: { value: true },
}))
vi.mock('../../config/prisma', () => ({ default: { emailLog: { create } } }))
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../config/env', () => ({ env: { PORTAL_URL: 'http://portal', AZURE_COMMUNICATION_CONNECTION_STRING: undefined } }))
vi.mock('./graph', () => ({ isGraphConfigured: () => configured.value, sendGraphMail }))

import { sendSurveyEmail, sendTicketUpdateEmail, sendWelcomeEmail } from './mailer'

const update = (extra: object = {}) => sendTicketUpdateEmail({
  to: 'cli@x.com', ticketId: 'ISA-1', clientName: 'Cli', ticketNumber: 'INC-1', ticketTitle: 'T',
  status: null, replies: ['oi'], ...extra,
} as any)

describe('envio pela caixa de atendimento', () => {
  beforeEach(() => {
    configured.value = true
    create.mockReset().mockResolvedValue({})
    sendGraphMail.mockReset().mockResolvedValue({ internetMessageId: '<abc@x>', conversationId: 'conv-1' })
  })

  it('empresa com resposta por e-mail: assunto sem prefixo, analista em cópia e Message-ID no log', async () => {
    await update({ replyable: true, cc: ['analista@example.com'] })
    expect(sendGraphMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'cli@x.com', cc: ['analista@example.com'], subject: 'Chamado [INC-1]: nova resposta', ticketNumber: 'INC-1',
    }))
    expect(create.mock.calls[0][0].data).toMatchObject({
      kind: 'ticket_update', status: 'SUCCESS', provider: 'graph', internet_message_id: '<abc@x>', conversation_id: 'conv-1', replyable: true,
    })
  })

  it('anexos da resposta vão para o Graph; o que não coube vai só pelo nome no corpo', async () => {
    await update({ replyable: true, attachments: [
      { name: 'a.pdf', contentType: 'application/pdf', contentBytes: 'JVBERg==', size: 4 },
      { name: 'grande.zip', contentType: 'application/zip', contentBytes: null, size: 30_000_000 },
    ] })
    const sent = sendGraphMail.mock.calls[0][0]
    expect(sent.attachments).toEqual([{ name: 'a.pdf', contentType: 'application/pdf', contentBytes: 'JVBERg==', size: 4 }])
    expect(sent.html).toContain('grande.zip')
    expect(sent.html).toContain('(disponível no chamado)')
  })

  it('empresa sem resposta por e-mail: assunto sem prefixo e ninguém em cópia', async () => {
    await update({ replyable: false, cc: ['analista@example.com'] })
    const sent = sendGraphMail.mock.calls[0][0]
    expect(sent.subject).toBe('Chamado [INC-1]: nova resposta')
    expect(sent.cc).toBeUndefined()
    expect(create.mock.calls[0][0].data.replyable).toBe(false)
  })

  it('boas-vindas e pesquisa não aceitam resposta e o assunto não leva prefixo', async () => {
    await sendWelcomeEmail({ to: 'u@x.com', name: 'U' })
    await sendSurveyEmail({ to: 'u@x.com', ticketId: 'ISA-1', vars: {}, linkSurvey: 'http://s', subjectTemplate: 'Pesquisa', bodyTemplate: 'Oi' } as any)
    expect(sendGraphMail.mock.calls.map(call => call[0].subject)).toEqual(['Bem-vindo ao portal ISA', 'Pesquisa'])
    for (const call of create.mock.calls) expect(call[0].data.replyable).toBe(false)
  })

  it('falha no Graph cai no ACS e registra o erro', async () => {
    sendGraphMail.mockRejectedValue(new Error('Graph token: 401'))
    const r = await update({ replyable: true })
    expect(r.status).toBe('SKIPPED_ACS_NOT_CONFIGURED')
    expect(create.mock.calls[0][0].data.error).toContain('graph: Graph token: 401')
  })

  it('sem Graph configurado segue pelo ACS', async () => {
    configured.value = false
    await update()
    expect(sendGraphMail).not.toHaveBeenCalled()
  })
})
