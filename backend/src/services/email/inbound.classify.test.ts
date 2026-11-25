import { describe, it, expect, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ default: {} }))
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../tickets', () => ({ TicketService: {} }))
vi.mock('../externalApi', () => ({}))
vi.mock('./mailer', () => ({}))

vi.mock('./graph', () => ({ FILE_ATTACHMENT: '#microsoft.graph.fileAttachment', ITEM_ATTACHMENT: '#microsoft.graph.itemAttachment' }))

import { automatedReason, imageSize, isAutoSubmitted, messageText, referencedMessageIds, signatureCids, sortAttachments, ticketNumberFromSubject } from './inbound'

// Cabeçalho PNG mínimo (assinatura + IHDR) com as dimensões pedidas.
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b.toString('base64')
}


const msg = (o: object = {}) => ({ id: 'm1', receivedDateTime: '2026-10-29T12:00:00Z', from: { emailAddress: { address: 'cli@empresa.com' } }, ...o }) as any
const MAILBOX = 'atendimento@example.com'

describe('classificação dos e-mails da caixa de atendimento', () => {
  it('descarta o que não é de gente: própria caixa, devolução e resposta automática', () => {
    expect(automatedReason(msg({ from: { emailAddress: { address: 'Atendimento@EXAMPLE.com' } } }), MAILBOX)).toMatch(/própria caixa/)
    expect(automatedReason(msg({ from: { emailAddress: { address: 'MAILER-DAEMON@x.com' } } }), MAILBOX)).toMatch(/não entrega/)
    expect(automatedReason(msg({ internetMessageHeaders: [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }] }), MAILBOX)).toMatch(/não entrega/)
    expect(automatedReason(msg({ subject: 'Resposta automática: Chamado [INC-1]: Pendente' }), MAILBOX)).toMatch(/automática/)
    expect(automatedReason(msg({ subject: 'Automatic reply: Chamado [INC-1]' }), MAILBOX)).toMatch(/automática/)
    expect(automatedReason(msg({ subject: 'Undeliverable: Chamado [INC-1]' }), MAILBOX)).toMatch(/automática/)
    expect(automatedReason(msg({ subject: 'RE: Chamado [INC-1]: nova resposta' }), MAILBOX)).toBeNull()
    expect(automatedReason(msg({ subject: 'Impressora parou' }), MAILBOX)).toBeNull()
  })

  it('Auto-Submitted marca resposta automática (exceto "no")', () => {
    expect(isAutoSubmitted(msg({ internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-replied' }] }))).toBe(true)
    expect(isAutoSubmitted(msg({ internetMessageHeaders: [{ name: 'auto-submitted', value: 'no' }] }))).toBe(false)
    expect(isAutoSubmitted(msg())).toBe(false)
  })

  it('acha o número do chamado no assunto novo ([INC-1]) e no antigo do ACS (Chamado INC-1)', () => {
    expect(ticketNumberFromSubject('RE: [Não responda] Chamado [INC-11180]: Pendente')).toBe('INC-11180')
    expect(ticketNumberFromSubject('RES: Chamado INC-11011: nova resposta')).toBe('INC-11011')
    expect(ticketNumberFromSubject('Como foi o seu atendimento? — Chamado #REQ-11078')).toBe('REQ-11078')
    expect(ticketNumberFromSubject('Impressora parou de novo')).toBeNull()
  })

  it('junta os Message-IDs de In-Reply-To e References', () => {
    const m = msg({ internetMessageHeaders: [
      { name: 'In-Reply-To', value: '<b@x>' },
      { name: 'References', value: '<a@x> <b@x>' },
    ] })
    expect(referencedMessageIds(m)).toEqual(['<b@x>', '<a@x>'])
  })

  it('na resposta usa só o texto novo; no e-mail novo, o corpo inteiro', () => {
    const m = msg({ uniqueBody: { content: 'Funcionou, obrigado!' }, body: { content: 'Funcionou, obrigado!\r\n\r\n\r\n\r\nDe: Atendimento...' } })
    expect(messageText(m, true)).toBe('Funcionou, obrigado!')
    expect(messageText(m, false)).toBe('Funcionou, obrigado!\n\nDe: Atendimento...')
  })

  it('tira do texto as imagens embutidas ([cid:...]) da assinatura', () => {
    const m = msg({ uniqueBody: { content: 'Compreendo\r\n\r\n[cid:11111111-2222-4333-8444-555555555555]\r\n' } })
    expect(messageText(m, true)).toBe('Compreendo')
    const m2 = msg({ body: { content: 'Bom dia\r\n[cid:image001.png@01DA]  André\r\n[cid:image002.png@01DA]' } })
    expect(messageText(m2, false)).toBe('Bom dia\n  André')
  })

  it('separa anexos: arquivo, e-mail anexado, embutido (marcado ou citado no corpo) e não suportado', () => {
    const F = '#microsoft.graph.fileAttachment'
    const m = msg({ body: { content: 'oi [cid:logo@01DA]' } })
    const r = sortAttachments(m, [
      { '@odata.type': F, name: 'a.pdf', contentBytes: 'eA==' },
      { '@odata.type': F, name: 'sig.png', contentBytes: 'eA==', isInline: true },
      { '@odata.type': F, name: 'logo.png', contentBytes: 'eA==', contentId: '<LOGO@01DA>' },
      { '@odata.type': F, name: 'vazio.bin' },
      { '@odata.type': '#microsoft.graph.itemAttachment', id: 'i1', name: 'ENC: x' },
      { '@odata.type': '#microsoft.graph.referenceAttachment', name: 'OneDrive' },
    ])
    expect(r.files.map(a => a.name)).toEqual(['a.pdf'])
    expect(r.emails.map(a => a.name)).toEqual(['ENC: x'])
    expect(r.unsupported).toEqual(['vazio.bin', 'OneDrive'])
  })

  it('lê largura × altura de PNG, JPEG e GIF pelo cabeçalho', () => {
    expect(imageSize(Buffer.from(png(884, 480), 'base64'))).toEqual({ width: 884, height: 480 })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x03, 0x74, 0x03])
    expect(imageSize(jpeg)).toEqual({ width: 884, height: 480 })
    const gif = Buffer.from('GIF89a', 'latin1'); const g = Buffer.alloc(12); gif.copy(g); g.writeUInt16LE(262, 6); g.writeUInt16LE(92, 8)
    expect(imageSize(g)).toEqual({ width: 262, height: 92 })
    expect(imageSize(Buffer.from('não é imagem'))).toBeNull()
  })

  it('imagem embutida com tamanho de print vai para a checagem; logo e ícone pequenos, não', () => {
    const F = '#microsoft.graph.fileAttachment'
    const m = msg({ body: { content: 'veja o erro [cid:print@1] abraço [cid:assin@1] [cid:logo@1]' } })
    const r = sortAttachments(m, [
      { '@odata.type': F, name: 'image001.png', contentType: 'image/png', contentBytes: png(979, 574), isInline: true, contentId: 'print@1' },
      { '@odata.type': F, name: 'image002.png', contentType: 'image/png', contentBytes: png(703, 203), isInline: true, contentId: 'assin@1' },
      { '@odata.type': F, name: 'image003.png', contentType: 'image/png', contentBytes: png(180, 71), isInline: true, contentId: 'logo@1' },
    ])
    expect(r.files).toEqual([])
    expect(r.inlineImages.map(a => a.name)).toEqual(['image001.png'])
  })

  it('na resposta, só entra a imagem colada no texto novo (não as do histórico)', () => {
    const F = '#microsoft.graph.fileAttachment'
    const m = msg({ uniqueBody: { content: 'segue o novo print [cid:novo@1]' }, body: { content: 'segue o novo print [cid:novo@1]\n\nDe: ...\n[cid:antigo@1]' } })
    const r = sortAttachments(m, [
      { '@odata.type': F, name: 'novo.png', contentType: 'image/png', contentBytes: png(1200, 700), isInline: true, contentId: 'novo@1' },
      { '@odata.type': F, name: 'antigo.png', contentType: 'image/png', contentBytes: png(1200, 700), isInline: true, contentId: 'antigo@1' },
    ], true)
    expect(r.inlineImages.map(a => a.name)).toEqual(['novo.png'])
  })

  it('acha as imagens do bloco de assinatura (Outlook novo, desktop e Gmail)', () => {
    // Outlook novo: <div id="Signature"> com divs aninhadas; o print colado acima fica fora.
    const novo = '<body><div>Veja <img src="cid:print-1"></div><div id="Signature" data-signature-name="x"><div><br></div><div><img src="cid:assin-1"></div></div><div id="appendonsend"></div><img src="cid:hist-1"></body>'
    expect([...signatureCids(novo)]).toEqual(['assin-1'])
    // Outlook desktop: só marca o início (_MailAutoSig) — vai até o histórico citado.
    const desktop = '<body><p>Oi <img src="cid:image001.png@01DA"></p><p><a name="_MailAutoSig"><img src="cid:image002.png@01DA"></a></p><p><img src="cid:image003.png@01DA"></p><div id="divRplyFwdMsg">De: ... <img src="cid:image004.png@01DA"></div></body>'
    expect([...signatureCids(desktop)].sort()).toEqual(['image002.png@01da', 'image003.png@01da'])
    const gmail = '<div>texto</div><div class="gmail_signature" data-smartmail="gmail_signature"><img src="cid:ii_abc"></div>'
    expect([...signatureCids(gmail)]).toEqual(['ii_abc'])
    expect(signatureCids('<p>sem assinatura <img src="cid:x"></p>').size).toBe(0)
  })
})
