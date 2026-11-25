import { describe, expect, it } from 'vitest'
import {
  DOMAIN_REGEX,
  sanitizeDomain,
  isValidDomain,
  validateDomainList,
  validateSingleDomain,
} from './domainValidation'

describe('domainValidation (Frontend)', () => {
  describe('DOMAIN_REGEX', () => {
    it('aceita domínios válidos comuns e com múltiplos TLDs', () => {
      expect(DOMAIN_REGEX.test('empresa.com')).toBe(true)
      expect(DOMAIN_REGEX.test('empresa.com.br')).toBe(true)
      expect(DOMAIN_REGEX.test('sub.dominio.org')).toBe(true)
      expect(DOMAIN_REGEX.test('empresa-tech.com.br')).toBe(true)
      expect(DOMAIN_REGEX.test('minhaempresa.io')).toBe(true)
      expect(DOMAIN_REGEX.test('servico.gov.br')).toBe(true)
    })

    it('rejeita domínios sem ponto, sem TLD ou mal formatados', () => {
      expect(DOMAIN_REGEX.test('empresa')).toBe(false)
      expect(DOMAIN_REGEX.test('qualquercoisa')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa.')).toBe(false)
      expect(DOMAIN_REGEX.test('.empresa.com')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa..com')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa.c')).toBe(false) // TLD com apenas 1 caractere
      expect(DOMAIN_REGEX.test('-empresa.com')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa-.com')).toBe(false)
      expect(DOMAIN_REGEX.test('user@empresa.com')).toBe(false)
      expect(DOMAIN_REGEX.test('@empresa.com')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa.com/path')).toBe(false)
    })
  })

  describe('sanitizeDomain', () => {
    it('extrai apenas o domínio quando informado e-mail completo', () => {
      expect(sanitizeDomain('contato@empresa.com')).toBe('empresa.com')
      expect(sanitizeDomain('fulano.silva@empresa.com.br')).toBe('empresa.com.br')
    })

    it('remove @ no início', () => {
      expect(sanitizeDomain('@empresa.com')).toBe('empresa.com')
      expect(sanitizeDomain('  @empresa.com.br  ')).toBe('empresa.com.br')
    })

    it('remove protocolo http/https e barras', () => {
      expect(sanitizeDomain('https://empresa.com/')).toBe('empresa.com')
      expect(sanitizeDomain('http://portal.empresa.com.br/login')).toBe('portal.empresa.com.br')
    })

    it('converte para minúsculas e remove espaços', () => {
      expect(sanitizeDomain('  EMPRESA.COM.BR  ')).toBe('empresa.com.br')
    })
  })

  describe('isValidDomain', () => {
    it('valida domínios puros e sanitizáveis', () => {
      expect(isValidDomain('empresa.com')).toBe(true)
      expect(isValidDomain('@empresa.com.br')).toBe(true)
      expect(isValidDomain('user@empresa.com.br')).toBe(true)
      expect(isValidDomain('texto_invalido')).toBe(false)
      expect(isValidDomain('')).toBe(false)
      expect(isValidDomain(null)).toBe(false)
    })
  })

  describe('validateDomainList', () => {
    it('valida e sanitiza múltiplos domínios separados por vírgula', () => {
      const result = validateDomainList('empresa.com, @outraempresa.com.br, user@filial.org')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.domains).toEqual(['empresa.com', 'outraempresa.com.br', 'filial.org'])
        expect(result.rawNormalized).toBe('empresa.com, outraempresa.com.br, filial.org')
      }
    })

    it('remove duplicatas na lista de domínios', () => {
      const result = validateDomainList('empresa.com, @empresa.com, EMPRESA.COM')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.domains).toEqual(['empresa.com'])
      }
    })

    it('retorna erro se algum domínio da lista for inválido', () => {
      const result = validateDomainList('empresa.com, texto-invalido, empresa.com.br')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('texto-invalido')
        expect(result.error).toContain('Domínio de e-mail inválido')
      }
    })

    it('retorna erro quando o campo obrigatório for vazio', () => {
      const result = validateDomainList('', { required: true })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('obrigatório')
      }
    })
  })

  describe('validateSingleDomain', () => {
    it('valida e sanitiza um único domínio', () => {
      const result = validateSingleDomain('contato@empresa.com')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.domain).toBe('empresa.com')
      }
    })

    it('rejeita valor sem TLD / formato inválido', () => {
      const result = validateSingleDomain('empresa')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('O domínio "empresa" é inválido')
      }
    })
  })
})
