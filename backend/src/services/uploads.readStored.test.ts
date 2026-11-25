import { describe, it, expect } from 'vitest'
import { readStoredAttachment } from './uploads'

// Sem AZURE_STORAGE_* nos testes: só o caminho do data URI (anexo legado) e o que não dá para ler.
describe('readStoredAttachment', () => {
  it('lê o data URI com o tipo e a extensão', async () => {
    const file = await readStoredAttachment(`data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`)
    expect(file).toMatchObject({ mime: 'application/pdf', ext: 'pdf' })
    expect(file!.buffer.toString()).toBe('%PDF-1.4')
  })

  it('link externo ou blob sem storage configurado: null (vai só o nome no e-mail)', async () => {
    expect(await readStoredAttachment('https://exemplo.com/a.png')).toBeNull()
    expect(await readStoredAttachment('tickets/2026/11/a.png')).toBeNull()
  })
})
