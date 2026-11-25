import { describe, it, expect } from 'vitest'
import { maskPII, stripSignature, sanitizeForModel } from './masking'

describe('masking', () => {
  it('mascara e-mail e telefone', () => {
    expect(maskPII('Fale com joao.silva@empresa.com.br ou (11) 98765-4321')).toBe('Fale com [EMAIL] ou [TELEFONE]')
  })

  it('mascara CPF, CNPJ e CEP sem confundir um com o outro', () => {
    expect(maskPII('CPF 123.456.789-09 e CNPJ 12.345.678/0001-90, CEP 04534-004'))
      .toBe('CPF [CPF] e CNPJ [CNPJ], CEP [CEP]')
  })

  it('mascara RG nos formatos com ponto, com hífen e com dígito X', () => {
    expect(maskPII('RG 12.345.678-9')).toBe('RG [RG]')
    expect(maskPII('rg: 12345678-9, outro 1.234.567 e 12.345.678-X')).toBe('rg: [RG], outro [RG] e [RG]')
  })

  it('celular de 11 dígitos sem separador é telefone, não CPF', () => {
    expect(maskPII('ligar 11987654321 ou (11)987654321 ou +55 11 98765-4321'))
      .toBe('ligar [TELEFONE] ou [TELEFONE] ou [TELEFONE]')
  })

  it('CPF sem pontuação continua CPF quando não parece celular', () => {
    expect(maskPII('CPF 12345678909 e 123.456.789-09')).toBe('CPF [CPF] e [CPF]')
  })

  it('mascara CPF e CNPJ separados por espaço ou hífen', () => {
    expect(maskPII('CPF 123 456 789 09, 123 456 789-09, 123.456.789 09 e 123-456-789-09'))
      .toBe('CPF [CPF], [CPF], [CPF] e [CPF]')
    expect(maskPII('CNPJ 12 345 678 0001 90 e 12-345-678-0001-90')).toBe('CNPJ [CNPJ] e [CNPJ]')
  })

  it('não confunde CNPJ, IP ou valor com RG', () => {
    expect(maskPII('CNPJ 12.345.678/0001-90, IP 10.100.200.1, total R$ 1.234.567,89'))
      .toBe('CNPJ [CNPJ], IP 10.100.200.1, total R$ 1.234.567,89')
  })

  it('mascara senha informada no texto', () => {
    expect(maskPII('Usuário criado. Senha: Abc@1234 provisória')).toBe('Usuário criado. Senha: [SENHA] provisória')
  })

  it('mascara senha dita em frase, não só depois de dois-pontos', () => {
    expect(maskPII('minha senha é Abc@1234 e não entra')).toBe('minha senha: [SENHA] e não entra')
    expect(maskPII('a senha antiga é Xyz987')).toBe('a senha: [SENHA]')
    expect(maskPII('senha temporária: Xy9#')).toBe('senha: [SENHA]')
    expect(maskPII('my password is hunter2')).toBe('my password: [SENHA]')
  })

  it('não mascara quem só fala de senha', () => {
    for (const t of ['esqueci a senha e o login', 'preciso trocar a senha', 'senha expirada desde ontem']) expect(maskPII(t)).toBe(t)
  })

  it('não mascara números comuns de chamado', () => {
    expect(maskPII('Erro no chamado 100-17649 desde 02/10/2026')).toBe('Erro no chamado 100-17649 desde 02/10/2026')
  })

  it('corta a assinatura a partir da despedida', () => {
    expect(stripSignature('O Outlook não abre.\nAtenciosamente,\nFulano\nRua X, 960')).toBe('O Outlook não abre.')
  })

  it('corta o aviso legal de e-mail', () => {
    expect(stripSignature('Erro no e-mail. As informações contidas nesta mensagem são confidenciais')).toBe('Erro no e-mail.')
  })

  it('não apaga tudo quando o texto começa com a despedida', () => {
    expect(stripSignature('Atenciosamente, preciso de acesso')).toBe('Atenciosamente, preciso de acesso')
  })

  it('sanitizeForModel aceita nulo e limita o tamanho', () => {
    expect(sanitizeForModel(null)).toBe('')
    expect(sanitizeForModel('x'.repeat(5000))).toHaveLength(4000)
  })

  // Texto longo sem espaço (log, base64) travava o event loop ~10 s com 100 KB (ReDoS na regex de e-mail).
  it('texto gigante sem espaço não trava (tempo linear)', () => {
    for (const s of ['A'.repeat(100_000), 'a1'.repeat(50_000), '1'.repeat(100_000), 'a.'.repeat(50_000)]) {
      const t = Date.now()
      maskPII(s)
      sanitizeForModel(s)
      expect(Date.now() - t).toBeLessThan(300)
    }
  })

  it('e-mail longo ainda é mascarado', () => {
    expect(maskPII(`contato: ${'a'.repeat(50)}.silva@empresa-grande.com.br`)).toBe('contato: [EMAIL]')
  })
})
