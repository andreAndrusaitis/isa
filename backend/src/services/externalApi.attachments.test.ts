import { describe, it, expect, vi } from 'vitest'

// Isola do envio de e-mail (não usado aqui).
vi.mock('./email/mailer', () => ({}))
import { createTicketSchema, prepareAttachment } from './externalApi'

// Item como o gatilho "When a new email arrives (V3)" do Outlook entrega.
const outlookItem = {
  '@odata.type': '#microsoft.graph.fileAttachment',
  id: 'AAMk...',
  name: 'image.png',
  contentType: 'image/png',
  size: 3,
  isInline: true,
  contentId: '1eeb5932',
  contentBytes: 'iVBO',
}

describe('anexos no POST /tickets', () => {
  it('aceita body/attachments do Outlook repassado direto', () => {
    const data = createTicketSchema.parse({
      requester: { email: 'a@b.com' },
      ticket: { title: 't', description: 'd', attachments: [outlookItem] },
    })
    expect(prepareAttachment(data.ticket.attachments![0])).toEqual({ name: 'image.png', mime: 'image/png', base64: 'iVBO', bytes: 3 })
  })
  it('aceita a lista serializada como texto (interpolação @{...} do Power Automate)', () => {
    const data = createTicketSchema.parse({
      requester: { email: 'a@b.com' },
      ticket: { title: 't', description: 'd', attachments: JSON.stringify([outlookItem]) },
    })
    expect(data.ticket.attachments).toHaveLength(1)
    expect(prepareAttachment(data.ticket.attachments![0]).mime).toBe('image/png')
  })
  it('string vazia = sem anexos', () => {
    const data = createTicketSchema.parse({ requester: { email: 'a@b.com' }, ticket: { title: 't', description: 'd', attachments: '' } })
    expect(data.ticket.attachments).toEqual([])
  })
  it('aceita snake_case', () => {
    expect(prepareAttachment({ name: 'a.pdf', content_bytes: 'JVBE' }).mime).toBe('application/pdf')
  })
  it('recusa anexo sem conteúdo (Include Attachments desligado)', () => {
    expect(() => prepareAttachment({ name: 'image.png', contentType: 'image/png' })).toThrow(/sem conteúdo/)
  })
  it('recusa anexo acima de 10 MB antes de qualquer upload', () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')
    expect(() => prepareAttachment({ name: 'a.pdf', content_bytes: big })).toThrow(/tamanho máximo/)
  })
})
