import { describe, expect, it } from 'vitest'
import { groupAttachmentMessages } from './groupAttachmentMessages'

const at = (s: number) => new Date(Date.UTC(2026, 9, 9, 12, 0, s)).toISOString()
const msg = (id: string, s: number, text: string, extra: Partial<{ userId: string; type: string; attachmentUrl: string | null }> = {}) => ({
  id, createdAt: at(s), text, userId: 'u1', type: 'agent', attachmentUrl: null as string | null, ...extra,
})

describe('groupAttachmentMessages', () => {
  it('junta os "Anexo adicional" na mensagem principal do mesmo autor', () => {
    const { messages } = groupAttachmentMessages([
      msg('m1', 0, 'Segue o print', { attachmentUrl: 'a.png' }),
      msg('m2', 2, 'Anexo adicional: b.png', { attachmentUrl: 'b.png' }),
      msg('m3', 4, 'Anexo adicional: c.pdf', { attachmentUrl: 'c.pdf' }),
    ])
    expect(messages.map((m) => m.id)).toEqual(['m1'])
    expect(messages[0].extraAttachments).toEqual([
      { id: 'm2', url: 'b.png', name: 'b.png' },
      { id: 'm3', url: 'c.pdf', name: 'c.pdf' },
    ])
  })

  it('não junta com outro autor, outro tipo ou depois da janela', () => {
    const { messages } = groupAttachmentMessages([
      msg('m1', 0, 'Oi', { attachmentUrl: 'a.png' }),
      msg('m2', 1, 'Anexo adicional: x.png', { attachmentUrl: 'x.png', userId: 'u2' }),
      msg('m3', 2, 'Anexo adicional: y.png', { attachmentUrl: 'y.png', type: 'internal' }),
      msg('m4', 600, 'Anexo adicional: z.png', { attachmentUrl: 'z.png' }),
    ])
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('extras do solicitante logo após abrir o chamado vão para a abertura', () => {
    const { messages, openingExtras } = groupAttachmentMessages(
      [msg('m1', 3, 'Anexo adicional: b.png', { attachmentUrl: 'b.png', userId: 'req', type: 'user' })],
      { userId: 'req', createdAt: at(0) },
    )
    expect(messages).toEqual([])
    expect(openingExtras).toEqual([{ id: 'm1', url: 'b.png', name: 'b.png' }])
  })
})
