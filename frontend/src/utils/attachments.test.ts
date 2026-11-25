import { describe, it, expect } from 'vitest'
import { validateAttachment, filterValidAttachments, MAX_ATTACHMENT_BYTES, filesFromClipboard, pastedImageName } from './attachments'

function makeFile(name: string, sizeBytes = 1024, type = ''): File {
  const file = new File([new Uint8Array(0)], name, { type })
  // File.size é somente-leitura; sobrescreve para simular tamanhos sem alocar memória.
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

describe('validateAttachment', () => {
  it('aceita extensões permitidas (espelha o allowlist do backend)', () => {
    for (const name of ['print.png', 'foto.JPG', 'doc.pdf', 'planilha.xlsx', 'log.LOG', 'dados.csv', 'pacote.zip']) {
      expect(validateAttachment(makeFile(name))).toBeNull()
    }
  })

  it('rejeita extensões não permitidas (.md) com mensagem clara', () => {
    const err = validateAttachment(makeFile('README.md'))
    expect(err).toBeTruthy()
    expect(err).toContain('.md')
  })

  it('rejeita arquivos sem extensão', () => {
    const err = validateAttachment(makeFile('Dockerfile'))
    expect(err).toBeTruthy()
  })

  it('rejeita arquivos acima do limite de tamanho', () => {
    const err = validateAttachment(makeFile('grande.png', MAX_ATTACHMENT_BYTES + 1))
    expect(err).toBeTruthy()
    expect(err).toMatch(/MB|tamanho|limite/i)
  })
})

describe('filterValidAttachments', () => {
  it('mantém os válidos e chama onReject para cada inválido', () => {
    const rejected: string[] = []
    const input = [makeFile('a.png'), makeFile('b.md'), makeFile('c.pdf'), makeFile('semext')]
    const valid = filterValidAttachments(input, (msg) => rejected.push(msg))
    expect(valid.map(f => f.name)).toEqual(['a.png', 'c.pdf'])
    expect(rejected).toHaveLength(2)
  })
})

describe('filesFromClipboard', () => {
  const clip = (files: File[], items: Array<{ kind: string; getAsFile: () => File | null }> = []) =>
    ({ clipboardData: { files, items } as unknown as DataTransfer })

  it('texto puro não gera arquivo (colar normal segue intacto)', () => {
    expect(filesFromClipboard(clip([], [{ kind: 'string', getAsFile: () => null }]))).toEqual([])
    expect(filesFromClipboard({ clipboardData: null })).toEqual([])
  })

  it('print sem nome recebe print-AAAAMMDD-HHMMSS.png e passa na validação', () => {
    const [f] = filesFromClipboard(clip([new File(['x'], 'image.png', { type: 'image/png' })]))
    expect(f.name).toMatch(/^print-\d{8}-\d{6}\.png$/)
    expect(validateAttachment(f)).toBeNull()
  })

  it('usa items quando files vem vazio e mantém nome de arquivo real', () => {
    const real = new File(['x'], 'relatorio.pdf', { type: 'application/pdf' })
    expect(filesFromClipboard(clip([], [{ kind: 'file', getAsFile: () => real }]))[0].name).toBe('relatorio.pdf')
  })

  it('pastedImageName formata data e extensão', () => {
    expect(pastedImageName('image/jpeg', new Date(2026, 9, 7, 9, 5, 3))).toBe('print-20261007-090503.jpg')
  })
})
