import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const { moveMessage, autoReply, listAttachments, attachmentMime, getMessageHtml, senderInlineImageSizes } = vi.hoisted(() => ({
  moveMessage: vi.fn(), autoReply: vi.fn(), listAttachments: vi.fn(async (): Promise<any[]> => []), attachmentMime: vi.fn(),
  getMessageHtml: vi.fn(async () => ''), senderInlineImageSizes: vi.fn(async () => ({ messages: 0, sizes: [] as number[] })),
}))
vi.mock('./graph', () => ({
  FILE_ATTACHMENT: '#microsoft.graph.fileAttachment',
  ITEM_ATTACHMENT: '#microsoft.graph.itemAttachment',
  mailboxAddress: () => 'atendimento@example.com',
  listAttachments,
  attachmentMime,
  getMessageHtml,
  senderInlineImageSizes,
  listInboxMessages: vi.fn(async () => []),
  ensureFolder: vi.fn(async (name: string) => `pasta:${name}`),
  moveMessage,
}))
const { emitWebhookEvent } = vi.hoisted(() => ({ emitWebhookEvent: vi.fn() }))
vi.mock('../webhookEvents', async (orig) => ({
  ...(await orig<typeof import('../webhookEvents')>()),
  emitWebhookEvent,
}))
vi.mock('./mailer', async (orig) => ({
  ...(await orig<typeof import('./mailer')>()),
  sendAutoReplyEmail: autoReply,
}))

import prisma from '../../config/prisma'
import { TicketService } from '../tickets'
import { processMessage, PROCESSED_FOLDER, IGNORED_FOLDER } from './inbound'
import { resetBlocklistCache } from './blocklist'

const SUFFIX = `inb${Date.now()}`
const DOMAIN = `${SUFFIX}.com`
const OFF_DOMAIN = `off-${SUFFIX}.com`
let orgId: string, offOrgId: string, reqId: string, offReqId: string, agentId: string
const graphIds: string[] = []
const extraOrgIds: string[] = [] // empresas criadas pelos testes (só estas são apagadas)
let webhookEndpointId: string

const msg = (o: Record<string, any>) => {
  const id = `${SUFFIX}-${graphIds.length}`
  graphIds.push(id)
  return {
    id, receivedDateTime: new Date().toISOString(), internetMessageId: `<${id}@cliente>`,
    from: { emailAddress: { address: `cli@${DOMAIN}`, name: 'Cliente' } },
    subject: 'Assunto', body: { content: 'corpo inteiro' }, uniqueBody: { content: 'texto novo' },
    ...o,
  } as any
}
const replyTo = (internetId: string) => [{ name: 'In-Reply-To', value: internetId }]

async function ticketFor(userId: string, org: string, status?: 'pending' | 'resolved', resolvedHoursAgo = 1) {
  const t = await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: userId, org_id: org })
  if (status) {
    await prisma.ticket.update({
      where: { id: t!.id },
      data: { status, resolved_at: status === 'resolved' ? new Date(Date.now() - resolvedHoursAgo * 3600_000) : null },
    })
  }
  return prisma.ticket.findUniqueOrThrow({ where: { id: t!.id } })
}

async function sentLog(ticketId: string | null, kind = 'ticket_update') {
  const internetId = `<sent-${SUFFIX}-${Math.random().toString(36).slice(2)}@isa>`
  await prisma.emailLog.create({ data: { kind, recipient: `cli@${DOMAIN}`, subject: 's', status: 'SUCCESS', ticket_id: ticketId, internet_message_id: internetId, provider: 'graph' } })
  return internetId
}

const messagesOf = (ticketId: string) => prisma.ticketMessage.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } })
const inbound = (graphId: string) => prisma.inboundEmail.findUniqueOrThrow({ where: { graph_message_id: graphId } })
const movedTo = () => moveMessage.mock.calls.at(-1)?.[1]

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, domains: [DOMAIN], email_reply_enabled: true } })).id
  offOrgId = (await prisma.organization.create({ data: { name: `Off ${SUFFIX}`, domains: [OFF_DOMAIN], email_reply_enabled: false } })).id
  reqId = (await prisma.user.create({ data: { name: 'Cliente', email: `cli@${DOMAIN}`, password: 'x', role: 'user', org_id: orgId } })).id
  offReqId = (await prisma.user.create({ data: { name: 'Cliente Off', email: `cli@${OFF_DOMAIN}`, password: 'x', role: 'user', org_id: offOrgId } })).id
  agentId = (await prisma.user.create({ data: { name: 'Analista', email: `analista-${SUFFIX}@example.com`, password: 'x', role: 'agent' } })).id
  // Os webhooks de e-mail só são montados quando alguém assina.
  webhookEndpointId = (await prisma.webhookEndpoint.create({ data: { name: `wh ${SUFFIX}`, url: 'https://hooks.example.test/in', secret: 'x', events: ['email.ticket_opened', 'email.not_opened'] } })).id
})

afterAll(async () => {
  await prisma.webhookEndpoint.deleteMany({ where: { id: webhookEndpointId } })
  await prisma.inboundEmail.deleteMany({ where: { graph_message_id: { in: graphIds } } })
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map(u => u.id)
  const allUsers = [...new Set([...userIds, reqId, offReqId, agentId])]
  const tickets = await prisma.ticket.findMany({ where: { user_id: { in: allUsers } }, select: { id: true } })
  await prisma.emailLog.deleteMany({ where: { OR: [{ ticket_id: { in: tickets.map(t => t.id) } }, { internet_message_id: { startsWith: `<sent-${SUFFIX}` } }] } })
  await prisma.ticket.deleteMany({ where: { id: { in: tickets.map(t => t.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: allUsers } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, offOrgId, ...extraOrgIds] } } })
  await prisma.$disconnect()
})

beforeEach(() => { moveMessage.mockReset(); emitWebhookEvent.mockReset(); autoReply.mockReset().mockResolvedValue({ status: 'SUCCESS' }) })
const webhook = (event: string) => emitWebhookEvent.mock.calls.filter(c => c[0] === event).map(c => c[1])

describe('caixa de atendimento → ISA', () => {
  it('e-mail novo de empresa cadastrada abre chamado (mesmas regras da API)', async () => {
    const m = msg({ subject: 'Impressora parou', body: { content: 'A impressora do 2º andar parou.' } })
    await processMessage(m)
    const row = await inbound(m.id)
    expect(row.status).toBe('ticket_created')
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: row.ticket_id! } })
    expect(ticket).toMatchObject({ title: 'Impressora parou', description: 'A impressora do 2º andar parou.', user_id: reqId, org_id: orgId })
    expect(movedTo()).toBe(`pasta:${PROCESSED_FOLDER}`)
  })

  it('anexos do e-mail novo: arquivo e e-mail anexado (.eml) entram; assinatura não; link de nuvem fica listado', async () => {
    const pdf = Buffer.from('%PDF-1.4 teste').toString('base64')
    const png = Buffer.from('png').toString('base64')
    listAttachments.mockResolvedValueOnce([
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'orcamento.pdf', contentType: 'application/pdf', contentBytes: pdf, isInline: false },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'a2', name: 'image001.png', contentType: 'image/png', contentBytes: png, isInline: true, contentId: 'image001.png@01DA' },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'a3', name: 'logo.png', contentType: 'image/png', contentBytes: png, isInline: false, contentId: '<logo@01DA>' },
      { '@odata.type': '#microsoft.graph.itemAttachment', id: 'a4', name: 'ENC: Caixa quase cheia', isInline: false },
      { '@odata.type': '#microsoft.graph.referenceAttachment', id: 'a5', name: 'Planilha no OneDrive', isInline: false },
    ])
    attachmentMime.mockResolvedValueOnce(Buffer.from('From: x@y\r\nSubject: ENC\r\n\r\ncorpo'))
    const m = msg({ subject: 'Com anexos', hasAttachments: true, body: { content: 'Segue o orçamento.\r\n\r\n[cid:image001.png@01DA]\r\n[cid:logo@01DA]' } })
    await processMessage(m)
    const row = await inbound(m.id)
    expect(row.status).toBe('ticket_created')
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: row.ticket_id! }, include: { attachments: true } })
    expect(ticket.description).not.toMatch(/cid:/)
    expect(ticket.description).toMatch(/^Segue o orçamento\./)
    expect(ticket.description).toMatch(/Anexos não importados.*Planilha no OneDrive/)
    expect(ticket.attachments.map(a => a.name).sort()).toEqual(['ENC_ Caixa quase cheia.eml', 'orcamento.pdf'])
    const att = (webhook('email.ticket_opened').at(-1) as any).email.attachments
    expect(att.map((a: any) => [a.filename, a.content_type]).sort()).toEqual([['ENC_ Caixa quase cheia.eml', 'message/rfc822'], ['orcamento.pdf', 'application/pdf']])
    expect(att.every((a: any) => a.id && a.url)).toBe(true)
    expect(attachmentMime).toHaveBeenCalledWith(m.id, 'a4')
  })

  it('print colado no corpo (sem anexo "de verdade") entra no chamado', async () => {
    const b = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(530, 16); b.writeUInt32BE(640, 20)
    listAttachments.mockResolvedValueOnce([
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'c1', name: 'image001.png', contentType: 'image/png', contentBytes: b.toString('base64'), isInline: true, contentId: 'image001.png@01DC' },
    ])
    // Graph diz hasAttachments=false quando só há imagem embutida.
    const m = msg({ subject: 'Print colado', hasAttachments: false, body: { content: 'Veja o fluxo:\r\n[cid:image001.png@01DC]' } })
    await processMessage(m)
    const row = await inbound(m.id)
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: row.ticket_id! }, include: { attachments: true } })
    expect(ticket.description).toBe('Veja o fluxo:')
    expect(ticket.attachments.map(a => a.name)).toEqual(['image001.png'])
  })

  it('imagem na área da assinatura: entra se é nova; fica de fora se já veio nos e-mails anteriores', async () => {
    const b = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(2013, 16); b.writeUInt32BE(626, 20)
    const img = (cid: string, size: number) => ({ '@odata.type': '#microsoft.graph.fileAttachment', id: cid, name: 'image.png', contentType: 'image/png', contentBytes: b.toString('base64'), isInline: true, contentId: cid, size })
    const html = (cid: string) => `<body><div>texto</div><div id="Signature"><div><img src="cid:${cid}"></div></div></body>`

    // Assinatura: a mesma imagem (74.872 bytes, folga de 1%) já veio antes.
    listAttachments.mockResolvedValueOnce([img('assin-1', 74872)])
    getMessageHtml.mockResolvedValueOnce(html('assin-1'))
    senderInlineImageSizes.mockResolvedValueOnce({ messages: 4, sizes: [74900, 74872] })
    const m1 = msg({ subject: 'Com assinatura', hasAttachments: false, body: { content: 'texto\r\n[cid:assin-1]' } })
    await processMessage(m1)
    const t1 = await prisma.ticket.findUniqueOrThrow({ where: { id: (await inbound(m1.id)).ticket_id! }, include: { attachments: true } })
    expect(t1.attachments).toEqual([])

    // Print colado na área da assinatura: tamanho que nunca veio antes.
    listAttachments.mockResolvedValueOnce([img('print-1', 94769)])
    getMessageHtml.mockResolvedValueOnce(html('print-1'))
    senderInlineImageSizes.mockResolvedValueOnce({ messages: 5, sizes: [71443, 71435] })
    const m2 = msg({ subject: 'Print na assinatura', hasAttachments: false, body: { content: 'texto\r\n[cid:print-1]' } })
    await processMessage(m2)
    const t2 = await prisma.ticket.findUniqueOrThrow({ where: { id: (await inbound(m2.id)).ticket_id! }, include: { attachments: true } })
    expect(t2.attachments.map(a => a.name)).toEqual(['image.png'])
  })

  it('anexo na resposta do cliente vai junto da mensagem, sem o [cid:] da assinatura no texto', async () => {
    const t = await ticketFor(reqId, orgId, 'pending')
    listAttachments.mockResolvedValueOnce([
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'b1', name: 'print.png', contentType: 'image/png', contentBytes: Buffer.from('png').toString('base64'), isInline: false },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'b2', name: 'image001.png', contentType: 'image/png', contentBytes: 'eA==', isInline: true },
    ])
    const m = msg({ hasAttachments: true, uniqueBody: { content: 'Compreendo\r\n\r\n[cid:11111111-2222-4333-8444-555555555555]' }, internetMessageHeaders: replyTo(await sentLog(t.id)) })
    await processMessage(m)
    const last = (await messagesOf(t.id)).filter(x => x.type === 'user').at(-1)
    expect(last?.text).toBe('Compreendo')
    expect(last?.attachment_url).toBeTruthy()
  })

  it('remetente bloqueado (Admin → E-mail → Bloqueios) não abre chamado', async () => {
    const blk = await prisma.emailBlock.create({ data: { kind: 'email', value: `spam@${DOMAIN}` } })
    resetBlocklistCache()
    try {
      const m = msg({ from: { emailAddress: { address: `Spam@${DOMAIN}` } }, subject: 'Oferta imperdível' })
      await processMessage(m)
      const row = await inbound(m.id)
      expect(row).toMatchObject({ status: 'ignored', ticket_id: null })
      expect(row.detail).toMatch(/bloqueado/)
      expect(movedTo()).toBe(`pasta:${IGNORED_FOLDER}`)
      expect(await prisma.user.count({ where: { email: `spam@${DOMAIN}` } })).toBe(0)
      expect(webhook('email.not_opened')).toEqual([expect.objectContaining({ reason: 'sender_blocked' })])
    } finally {
      await prisma.emailBlock.delete({ where: { id: blk.id } })
      resetBlocklistCache()
    }
  })

  it('domínio bloqueado também não entra como resposta num chamado', async () => {
    const t = await ticketFor(reqId, orgId, 'pending')
    const before = (await messagesOf(t.id)).length
    const blk = await prisma.emailBlock.create({ data: { kind: 'domain', value: DOMAIN } })
    resetBlocklistCache()
    try {
      const m = msg({ internetMessageHeaders: replyTo(await sentLog(t.id)) })
      await processMessage(m)
      expect((await inbound(m.id)).status).toBe('ignored')
      expect((await messagesOf(t.id)).length).toBe(before)
    } finally {
      await prisma.emailBlock.delete({ where: { id: blk.id } })
      resetBlocklistCache()
    }
  })

  it('domínio sem empresa: cria empresa e usuário, abre o chamado e avisa no webhook', async () => {
    const domain = `novo-${SUFFIX}.com`
    const m = msg({ from: { emailAddress: { address: `Joao@${domain}`, name: 'João' } }, subject: 'Primeiro contato' })
    await processMessage(m)
    const row = await inbound(m.id)
    expect(row.status).toBe('ticket_created')
    expect(row.detail).toMatch(/empresa .* criada, usuário criado/)
    const org = await prisma.organization.findFirstOrThrow({ where: { domains: { has: domain } } })
    extraOrgIds.push(org.id)
    expect(org).toMatchObject({ name: domain, active: true, tier: 'bronze', email_reply_enabled: false })
    expect(org.notes).toMatch(/Criada automaticamente pelo e-mail de joao@/)
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: row.ticket_id! }, include: { user: true } })
    expect(ticket).toMatchObject({ org_id: org.id, title: 'Primeiro contato' })
    expect(ticket.user).toMatchObject({ email: `joao@${domain}`, name: 'João', role: 'user', org_id: org.id })
    expect(movedTo()).toBe(`pasta:${PROCESSED_FOLDER}`)
    const [ev] = webhook('email.ticket_opened')
    expect(ev).toMatchObject({ email: { from_email: `joao@${domain}`, subject: 'Primeiro contato' }, created_organization: true, created_user: true, organization: { id: org.id } })
    expect((ev as any).ticket).toMatchObject({ id: ticket.id, title: 'Primeiro contato', status: 'open' })
    expect((ev as any).email).toMatchObject({ from_name: 'João', body_text: 'corpo inteiro', attachments: [] })

    // O próximo e-mail do mesmo domínio reaproveita a empresa criada.
    const m2 = msg({ from: { emailAddress: { address: `maria@${domain}` } }, subject: 'Segundo contato' })
    await processMessage(m2)
    expect(await prisma.organization.count({ where: { domains: { has: domain } } })).toBe(1)
    expect((await inbound(m2.id)).status).toBe('ticket_created')
    expect(webhook('email.ticket_opened').at(-1)).toMatchObject({ created_organization: false, created_user: true })
  })

  it('empresa inativa com o domínio não é recriada: o e-mail não abre chamado', async () => {
    const domain = `inativa-${SUFFIX}.com`
    const org = await prisma.organization.create({ data: { name: `Inativa ${SUFFIX}`, domains: [domain], active: false } })
    extraOrgIds.push(org.id)
    const m = msg({ from: { emailAddress: { address: `ana@${domain}` } } })
    await processMessage(m)
    expect(await inbound(m.id)).toMatchObject({ status: 'ignored', ticket_id: null })
    expect(await prisma.organization.count({ where: { domains: { has: domain } } })).toBe(1)
    expect(movedTo()).toBe(`pasta:${IGNORED_FOLDER}`)
    expect(webhook('email.not_opened')).toEqual([expect.objectContaining({ reason: 'organization_inactive', email: expect.objectContaining({ from_email: `ana@${domain}` }) })])
  })

  it('e-mail que não abre chamado vai no webhook email.not_opened com o motivo', async () => {
    const m = msg({ subject: 'Resposta automática: Fora do escritório' })
    await processMessage(m)
    expect(webhook('email.not_opened')).toEqual([expect.objectContaining({ status: 'ignored', reason: 'auto_reply', detail: 'resposta automática' })])
    expect((webhook('email.not_opened')[0] as any).email).toMatchObject({ subject: 'Resposta automática: Fora do escritório', body_text: 'corpo inteiro', attachments: [] })
    expect(webhook('email.ticket_opened')).toEqual([])
  })

  it('resposta do cliente (empresa liberada) entra no chamado e tira de Pendente', async () => {
    const t = await ticketFor(reqId, orgId, 'pending')
    const m = msg({ subject: 'RE: Chamado [x]: Pendente', internetMessageHeaders: replyTo(await sentLog(t.id)) })
    await processMessage(m)
    expect((await inbound(m.id)).status).toBe('message_added')
    const last = (await messagesOf(t.id)).filter(x => x.type === 'user').at(-1)
    expect(last).toMatchObject({ text: 'texto novo', user_id: reqId })
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('in_progress')
  })

  it('pelo número no assunto também acha o chamado (sem cabeçalhos)', async () => {
    const t = await ticketFor(reqId, orgId)
    const m = msg({ subject: `RES: Chamado [${t.display_number}]: nova resposta` })
    await processMessage(m)
    expect((await inbound(m.id)).ticket_id).toBe(t.id)
    expect((await messagesOf(t.id)).some(x => x.type === 'user' && x.text === 'texto novo')).toBe(true)
  })

  it('empresa sem resposta por e-mail: só nota interna + resposta automática com o link', async () => {
    const t = await ticketFor(offReqId, offOrgId, 'pending')
    const m = msg({ from: { emailAddress: { address: `cli@${OFF_DOMAIN}`, name: 'Off' } }, internetMessageHeaders: replyTo(await sentLog(t.id)) })
    await processMessage(m)
    expect((await inbound(m.id)).status).toBe('note_added')
    const msgs = await messagesOf(t.id)
    expect(msgs.some(x => x.type === 'user')).toBe(false)
    expect(msgs.some(x => x.type === 'internal' && x.text.includes('resposta por e-mail desabilitada'))).toBe(true)
    expect(autoReply).toHaveBeenCalledWith(expect.objectContaining({ to: `cli@${OFF_DOMAIN}`, reason: 'reply_disabled', ticketId: t.id }))
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('pending')
  })

  it('resolvido fora do prazo de reabertura: não reabre, avisa o cliente', async () => {
    const t = await ticketFor(reqId, orgId, 'resolved', 24 * 30)
    await prisma.ticket.update({ where: { id: t.id }, data: { reopen_sla_enabled: true, reopen_sla_limit_hours: 24 } })
    const m = msg({ internetMessageHeaders: replyTo(await sentLog(t.id)) })
    await processMessage(m)
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('resolved')
    expect((await messagesOf(t.id)).some(x => x.type === 'user')).toBe(false)
    expect(autoReply).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ticket_closed' }))
  })

  it('resolvido dentro do prazo: a resposta reabre o chamado', async () => {
    const t = await ticketFor(reqId, orgId, 'resolved', 1)
    await prisma.ticket.update({ where: { id: t.id }, data: { reopen_sla_enabled: true, reopen_sla_limit_hours: 24 } })
    await processMessage(msg({ internetMessageHeaders: replyTo(await sentLog(t.id)) }))
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('in_progress')
  })

  it('resposta a e-mail de boas-vindas ou "[Não responda]" nunca abre chamado', async () => {
    const welcome = msg({ internetMessageHeaders: replyTo(await sentLog(null, 'welcome')) })
    await processMessage(welcome)
    expect((await inbound(welcome.id)).status).toBe('ignored')

    const noReply = msg({ subject: 'RE: [Não responda] Bem-vindo ao ISA' })
    await processMessage(noReply)
    const row = await inbound(noReply.id)
    expect(row.status).toBe('ignored')
    expect(row.ticket_id).toBeNull()

    // O assunto não leva mais o prefixo: sem cabeçalhos da conversa, o boas-vindas vale pelo assunto.
    const semCabecalho = msg({ subject: 'RE: Bem-vindo ao portal ISA' })
    await processMessage(semCabecalho)
    const semRef = await inbound(semCabecalho.id)
    expect(semRef.status).toBe('ignored')
    expect(semRef.ticket_id).toBeNull()
  })

  it('resposta à pesquisa sem cabeçalhos da conversa acha o chamado pelo assunto e não abre outro', async () => {
    const t = await ticketFor(reqId, orgId)
    const number = (await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).display_number
    const m = msg({ subject: `RE: Como foi o seu atendimento? — Chamado #${number}` })
    await processMessage(m)
    expect((await inbound(m.id)).status).not.toBe('ticket_created')
  })

  it('resposta automática (ausência) ao e-mail do chamado é ignorada', async () => {
    const t = await ticketFor(reqId, orgId)
    const m = msg({ internetMessageHeaders: [...replyTo(await sentLog(t.id)), { name: 'Auto-Submitted', value: 'auto-replied' }] })
    await processMessage(m)
    expect((await inbound(m.id)).status).toBe('ignored')
    expect((await messagesOf(t.id)).some(x => x.type === 'user')).toBe(false)
  })

  it('analista respondendo pelo Outlook com o cliente em cópia vira resposta do analista', async () => {
    const t = await ticketFor(reqId, orgId)
    await prisma.ticket.update({ where: { id: t.id }, data: { assigned_to_id: agentId } })
    const m = msg({
      from: { emailAddress: { address: `analista-${SUFFIX}@example.com`, name: 'Analista' } },
      toRecipients: [{ emailAddress: { address: `cli@${DOMAIN}` } }],
      internetMessageHeaders: replyTo(await sentLog(t.id)),
    })
    await processMessage(m)
    expect((await messagesOf(t.id)).some(x => x.type === 'agent' && x.user_id === agentId)).toBe(true)
  })

  describe('remetente conhecido sem acesso ao chamado (mesma regra do portal)', () => {
    let foraId: string, adminId: string, colegaId: string, carteiraOrgId: string
    const of = (email: string) => ({ from: { emailAddress: { address: email, name: 'X' } } })

    beforeAll(async () => {
      carteiraOrgId = (await prisma.organization.create({ data: { name: `Carteira ${SUFFIX}` } })).id
      extraOrgIds.push(carteiraOrgId)
      foraId = (await prisma.user.create({
        data: { name: 'Fora', email: `fora-${SUFFIX}@example.com`, password: 'x', role: 'agent', queues: [`fila-${SUFFIX}`], org_scopes: { create: { org_id: carteiraOrgId } } },
      })).id
      adminId = (await prisma.user.create({ data: { name: 'Adm', email: `adm-${SUFFIX}@example.com`, password: 'x', role: 'admin' } })).id
      colegaId = (await prisma.user.create({ data: { name: 'Colega', email: `colega@${DOMAIN}`, password: 'x', role: 'user', org_id: orgId } })).id
    })
    afterAll(async () => {
      const proprios = await prisma.ticket.findMany({ where: { user_id: foraId }, select: { id: true } })
      await prisma.emailLog.deleteMany({ where: { ticket_id: { in: proprios.map(t => t.id) } } })
      await prisma.ticket.deleteMany({ where: { id: { in: proprios.map(t => t.id) } } })
      await prisma.ticketMessage.deleteMany({ where: { user_id: { in: [foraId, adminId, colegaId] } } })
      await prisma.user.deleteMany({ where: { id: { in: [foraId, adminId] } } })
    })

    it('analista fora da carteira: vira nota interna, não resposta pública', async () => {
      const t = await ticketFor(reqId, orgId)
      await processMessage(msg({ ...of(`fora-${SUFFIX}@example.com`), internetMessageHeaders: replyTo(await sentLog(t.id)) }))
      const msgs = await messagesOf(t.id)
      expect(msgs.some(x => x.user_id === foraId)).toBe(false)
      expect(msgs.some(x => x.type === 'internal' && x.text.includes('sem acesso'))).toBe(true)
    })

    it('admin é só leitura: o e-mail dele não vira resposta', async () => {
      const t = await ticketFor(reqId, orgId)
      await processMessage(msg({ ...of(`adm-${SUFFIX}@example.com`), internetMessageHeaders: replyTo(await sentLog(t.id)) }))
      const msgs = await messagesOf(t.id)
      expect(msgs.some(x => x.user_id === adminId)).toBe(false)
      expect(msgs.some(x => x.type === 'internal')).toBe(true)
    })

    it('analista que abriu o chamado fora da carteira responde como solicitante', async () => {
      const t = await ticketFor(foraId, orgId)
      await processMessage(msg({ ...of(`fora-${SUFFIX}@example.com`), internetMessageHeaders: replyTo(await sentLog(t.id)) }))
      expect((await messagesOf(t.id)).some(x => x.type === 'user' && x.user_id === foraId)).toBe(true)
    })

    it('colega da empresa só com o número no assunto: não vira resposta nem recebe o título', async () => {
      const t = await ticketFor(reqId, orgId)
      await processMessage(msg({ ...of(`colega@${DOMAIN}`), subject: `RE: [${t.display_number}]` }))
      expect((await messagesOf(t.id)).some(x => x.user_id === colegaId)).toBe(false)
      expect(autoReply).not.toHaveBeenCalled()
    })

    it('colega copiado na conversa continua respondendo', async () => {
      const t = await ticketFor(reqId, orgId)
      await processMessage(msg({ ...of(`colega@${DOMAIN}`), internetMessageHeaders: replyTo(await sentLog(t.id)) }))
      expect((await messagesOf(t.id)).some(x => x.type === 'user' && x.user_id === colegaId)).toBe(true)
    })
  })

  it('a mesma mensagem processada de novo não duplica (só move)', async () => {
    const t = await ticketFor(reqId, orgId)
    const m = msg({ internetMessageHeaders: replyTo(await sentLog(t.id)) })
    await processMessage(m)
    await processMessage(m)
    expect((await messagesOf(t.id)).filter(x => x.type === 'user')).toHaveLength(1)
    expect(moveMessage).toHaveBeenCalledTimes(2)
  })
})
