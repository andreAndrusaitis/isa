import { describe, it, expect } from 'vitest'
import { buildEvidence, evidenceContent, readAttachment } from './ticketEvidence'

const png = Buffer.from('fake-png')
const blobs: Record<string, Buffer> = {
  'tickets/2026/10/a.png': png, 'tickets/2026/10/b.png': png, 'tickets/2026/10/c.png': png, 'tickets/2026/10/d.png': png,
  'tickets/2026/10/log.txt': Buffer.from('Falha ao logar. CPF do usuário 123.456.789-09'),
  'tickets/2026/10/rel.xlsx': Buffer.from('binário'),
}
const readBlob = async (url: string) => blobs[url] ?? null

describe('buildEvidence', () => {
  it('mascara o texto, corta assinatura, lê anexos de texto e até 3 imagens', async () => {
    const e = await buildEvidence({
      title: 'Outlook parou para fulano@empresa.com',
      description: 'Não envia e-mails.\nAtenciosamente,\nFulano (11) 98765-4321',
      special_data: null,
      category: { name: 'Outlook Geral' },
      subcategory: null,
      attachments: [
        { name: 'print1.PNG', url: 'tickets/2026/10/a.png' },
        { name: 'print2.png', url: 'tickets/2026/10/b.png' },
        { name: 'print3.png', url: 'tickets/2026/10/c.png' },
        { name: 'print4.png', url: 'tickets/2026/10/d.png' },
        { name: 'log.txt', url: 'tickets/2026/10/log.txt' },
        { name: 'relatorio.xlsx', url: 'tickets/2026/10/rel.xlsx' },
      ],
    }, readBlob)

    expect(e.text).toContain('Título: Outlook parou para [EMAIL]')
    expect(e.text).toContain('Descrição: Não envia e-mails.')
    expect(e.text).not.toContain('98765')
    expect(e.text).toContain('Trecho do anexo log.txt: Falha ao logar. CPF do usuário [CPF]')
    expect(e.text).not.toContain('binário')
    expect(e.images).toHaveLength(3)
    expect(e.images[0]).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(e.fileNames).toEqual(['print1.PNG', 'print2.png', 'print3.png', 'print4.png', 'log.txt', 'relatorio.xlsx'])
    expect(e.userCategory).toBe('Outlook Geral')
  })

  it('chamado especial usa os campos do formulário como descrição', async () => {
    const e = await buildEvidence({
      title: 'Desligamento de usuário', description: null,
      special_data: { colaborador: 'Maria', sistemas: ['Teams', 'VPN'] },
      category: { name: 'Criação / Exclusão de usuarios' }, subcategory: { name: 'Desligamento de usuario' },
      attachments: [],
    }, readBlob)
    expect(e.text).toContain('colaborador: Maria')
    expect(e.text).toContain('sistemas: Teams, VPN')
    expect(e.userCategory).toBe('Criação / Exclusão de usuarios > Desligamento de usuario')
  })

  it('anexo ilegível é ignorado, sem derrubar a triagem', async () => {
    const e = await buildEvidence({
      title: 't', description: 'd', special_data: null, category: null, subcategory: null,
      attachments: [{ name: 'x.png', url: 'tickets/sumiu.png' }],
    }, async () => { throw new Error('404') })
    expect(e.images).toEqual([])
  })

  it('considera o print do wizard em attachment_url (blob ou data URI) sem duplicar', async () => {
    const base = { title: 't', description: 'd', special_data: null, category: null, subcategory: null }
    const blob = await buildEvidence({ ...base, attachment_url: 'tickets/2026/10/a.png', attachments: [] }, readBlob)
    expect(blob.fileNames).toEqual(['a.png'])
    expect(blob.images).toHaveLength(1)

    const dataUri = `data:image/jpeg;base64,${png.toString('base64')}`
    const inline = await buildEvidence({ ...base, attachment_url: dataUri, attachments: [] }, readAttachment)
    expect(inline.fileNames).toEqual(['anexo.jpg'])
    expect(inline.images).toEqual([`data:image/jpeg;base64,${png.toString('base64')}`])

    const dup = await buildEvidence({
      ...base, attachment_url: 'tickets/2026/10/a.png', attachments: [{ name: 'print.png', url: 'tickets/2026/10/a.png' }],
    }, readBlob)
    expect(dup.fileNames).toEqual(['print.png'])
    expect(dup.images).toHaveLength(1)
  })

  it('evidenceContent mostra a categoria do cliente só quando pedido', () => {
    const e = { text: 'Título: Teams caiu', userCategory: 'Teams Geral', fileNames: ['erro.png'], images: ['data:image/png;base64,AAA'] }
    const c = evidenceContent(e, true) as any[]
    expect(c[0].text).toContain('Categoria escolhida pelo cliente: Teams Geral')
    expect(c[0].text).toContain('Arquivos anexados: erro.png')
    expect(c[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA', detail: 'low' } })
    expect((evidenceContent(e, false) as any[])[0].text).not.toContain('Teams Geral')
  })
})
