import { describe, expect, it } from 'vitest'
import { DOMAIN_REGEX, sanitizeDomain, isValidDomain } from './domainValidation'
import { orgSchema } from '../services/organizations'
import { routingRuleSchema } from '../services/routing'

describe('domainValidation (Backend)', () => {
  describe('DOMAIN_REGEX', () => {
    it('valida domínios válidos', () => {
      expect(DOMAIN_REGEX.test('empresa.com')).toBe(true)
      expect(DOMAIN_REGEX.test('empresa.com.br')).toBe(true)
      expect(DOMAIN_REGEX.test('portal.sub.empresa.org')).toBe(true)
      expect(DOMAIN_REGEX.test('tech-solution.io')).toBe(true)
    })

    it('rejeita domínios sem ponto, com caracteres inválidos ou TLD curto', () => {
      expect(DOMAIN_REGEX.test('empresa')).toBe(false)
      expect(DOMAIN_REGEX.test('fiorde')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa.')).toBe(false)
      expect(DOMAIN_REGEX.test('.empresa.com')).toBe(false)
      expect(DOMAIN_REGEX.test('empresa.c')).toBe(false)
      expect(DOMAIN_REGEX.test('user@empresa.com')).toBe(false)
    })
  })

  describe('sanitizeDomain', () => {
    it('extrai domínio de e-mails completos e com @', () => {
      expect(sanitizeDomain('atendimento@empresa.com')).toBe('empresa.com')
      expect(sanitizeDomain('@empresa.com.br')).toBe('empresa.com.br')
      expect(sanitizeDomain('  https://empresa.com.br/path  ')).toBe('empresa.com.br')
    })
  })

  describe('isValidDomain', () => {
    it('valida se a entrada sanitizada corresponde a um domínio válido', () => {
      expect(isValidDomain('empresa.com')).toBe(true)
      expect(isValidDomain('contato@empresa.com.br')).toBe(true)
      expect(isValidDomain('qualquercoisa')).toBe(false)
    })
  })

  describe('orgSchema validation', () => {
    it('aceita e sanitiza lista de domínios válidos', () => {
      const parsed = orgSchema.parse({
        name: 'Minha Empresa',
        domains: ['@empresa.com', 'user@filial.com.br', 'EMPRESA.COM']
      })
      expect(parsed.domains).toEqual(['empresa.com', 'filial.com.br'])
    })

    it('rejeita domínios inválidos', () => {
      expect(() => {
        orgSchema.parse({
          name: 'Empresa Teste',
          domains: ['invalido_sem_ponto']
        })
      }).toThrow(/Domínio de e-mail inválido/)
    })

    it('rejeita lista vazia de domínios', () => {
      expect(() => {
        orgSchema.parse({
          name: 'Empresa Teste',
          domains: []
        })
      }).toThrow()
    })
  })

  describe('routingRuleSchema validation', () => {
    it('aceita e sanitiza condição de domínio de e-mail', () => {
      const parsed = routingRuleSchema.parse({
        name: 'Regra de Roteamento',
        enabled: true,
        priority: 1,
        conditions: [{ field: 'email_domain', operator: 'equals', value: 'user@empresa.com' }],
        actions: [{ type: 'set_queue', value: 'queue-1' }]
      })
      expect(parsed.conditions[0].value).toBe('empresa.com')
    })

    it('rejeita regra com domínio de e-mail inválido', () => {
      expect(() => {
        routingRuleSchema.parse({
          name: 'Regra Inválida',
          enabled: true,
          priority: 1,
          conditions: [{ field: 'email_domain', operator: 'equals', value: 'invalido' }],
          actions: [{ type: 'set_queue', value: 'queue-1' }]
        })
      }).toThrow(/Domínio de e-mail inválido/)
    })
  })
})
