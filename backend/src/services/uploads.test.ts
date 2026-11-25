import { describe, it, expect } from 'vitest'
import { resolveAttachmentMime, storeAttachment } from './uploads'

// Sem AZURE_STORAGE_* nos testes: data URI fica como veio, mas a regra do nome de blob vale igual.
describe('storeAttachment com prefixo', () => {
  it('não guarda nome de blob de outra pasta (a leitura assinaria o arquivo alheio)', async () => {
    expect(await storeAttachment('tickets/2026/11/a.pdf', 'avatars')).toBeNull()
    expect(await storeAttachment('projects/p1/2026/11/a.pdf', 'avatars')).toBeNull()
    expect(await storeAttachment('avatars/../tickets/2026/11/a.pdf', 'avatars')).toBeNull()
    expect(await storeAttachment('avatarsx/2026/11/a.png', 'avatars')).toBeNull()
  })

  it('iniciais reenviadas pelo perfil viram "sem foto", sem erro', async () => {
    expect(await storeAttachment('AS', 'avatars')).toBeNull()
  })

  it('mantém o que já era permitido', async () => {
    expect(await storeAttachment('avatars/2026/11/a.png', 'avatars')).toBe('avatars/2026/11/a.png')
    expect(await storeAttachment('https://cdn.exemplo.com/a.png', 'avatars')).toBe('https://cdn.exemplo.com/a.png')
    const uri = `data:image/png;base64,${Buffer.from('x').toString('base64')}`
    expect(await storeAttachment(uri, 'avatars')).toBe(uri)
  })

  it('sem prefixo segue aceitando nome de blob (reuso interno, ex.: anexo de e-mail já gravado)', async () => {
    expect(await storeAttachment('tickets/2026/11/a.pdf')).toBe('tickets/2026/11/a.pdf')
  })
})

describe('resolveAttachmentMime', () => {
  it('usa o content-type quando permitido', () => {
    expect(resolveAttachmentMime('image.png', 'image/png')).toBe('image/png')
    expect(resolveAttachmentMime('x.bin', 'IMAGE/JPEG; name=x')).toBe('image/jpeg')
  })
  it('deduz pela extensão quando o content-type é genérico ou ausente', () => {
    expect(resolveAttachmentMime('relatorio.pdf', 'application/octet-stream')).toBe('application/pdf')
    expect(resolveAttachmentMime('foto.JPEG')).toBe('image/jpeg')
  })
  it('rejeita tipos não permitidos', () => {
    expect(resolveAttachmentMime('logo.svg', 'image/svg+xml')).toBeUndefined()
    expect(resolveAttachmentMime('setup.exe', 'application/octet-stream')).toBeUndefined()
  })
})
