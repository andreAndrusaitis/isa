/**
 * Utilitários para validação e sanitização de domínios de e-mail/empresa.
 * Usado no cadastro de Organizações (OrgsPanel) e Regras de Roteamento (RoutingPanel).
 */

/**
 * Regex para validar nome de domínio de internet (RFC 1035 / FQDN).
 * - Exige pelo menos um ponto (.)
 * - Permite letras, números e hífens em cada subdomínio/rótulo (sem começar ou terminar em hífen)
 * - TLD final deve ter pelo menos 2 caracteres alfabéticos (ex: .com, .br, .org, .tech, .com.br, etc.)
 * - Não aceita '@', espaços, barras ou outros caracteres especiais
 */
export const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

/**
 * Sanitiza um valor de domínio:
 * - Remove espaços no início/fim e converte para minúsculas
 * - Se contiver '@', extrai apenas a parte após o último '@' (ex: user@empresa.com -> empresa.com, @empresa.com -> empresa.com)
 * - Remove protocolos (http://, https://) e caminhos após a barra (ex: https://empresa.com/abc -> empresa.com)
 * - Remove pontuações/barras extras no início ou fim
 */
export function sanitizeDomain(value: string | undefined | null): string {
  if (!value) return ''
  let d = String(value).trim().toLowerCase()
  // Se contiver @, pega o que vem depois do último @
  if (d.includes('@')) {
    d = d.split('@').pop() || ''
  }
  // Remove protocolo http/https
  d = d.replace(/^https?:\/\//, '')
  // Remove path / query params
  d = d.replace(/[/?#].*$/, '')
  // Remove pontos ou barras residuais no início ou fim
  d = d.replace(/^[./\\]+|[./\\]+$/g, '')
  return d.trim()
}

/**
 * Verifica se uma string representa um domínio válido após sanitização ou diretamente.
 */
export function isValidDomain(value: string | undefined | null): boolean {
  if (!value) return false
  const sanitized = sanitizeDomain(value)
  return DOMAIN_REGEX.test(sanitized)
}

export type DomainValidationResult =
  | { ok: true; domains: string[]; rawNormalized: string }
  | { ok: false; error: string }

/**
 * Valida uma lista de domínios (string separada por vírgulas ou array de strings).
 * Usado no cadastro de organizações (onde uma empresa pode ter múltiplos domínios).
 */
export function validateDomainList(
  input: string | string[] | undefined | null,
  options?: { required?: boolean }
): DomainValidationResult {
  const isRequired = options?.required ?? true

  if (!input) {
    if (isRequired) {
      return { ok: false, error: 'Domínio de e-mail é obrigatório.' }
    }
    return { ok: true, domains: [], rawNormalized: '' }
  }

  const rawList = Array.isArray(input)
    ? input
    : String(input)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

  if (rawList.length === 0) {
    if (isRequired) {
      return { ok: false, error: 'Domínio de e-mail é obrigatório. Informe ao menos um domínio válido (ex: suaempresa.com.br).' }
    }
    return { ok: true, domains: [], rawNormalized: '' }
  }

  const sanitizedDomains: string[] = []
  const invalidEntries: string[] = []

  for (const item of rawList) {
    const trimmed = String(item).trim()
    if (!trimmed) continue
    const sanitized = sanitizeDomain(trimmed)
    if (!sanitized || !DOMAIN_REGEX.test(sanitized)) {
      invalidEntries.push(trimmed)
    } else {
      if (!sanitizedDomains.includes(sanitized)) {
        sanitizedDomains.push(sanitized)
      }
    }
  }

  if (invalidEntries.length > 0) {
    const invalidStr = invalidEntries.join(', ')
    return {
      ok: false,
      error: `Domínio de e-mail inválido: "${invalidStr}". Digite apenas o domínio de e-mail com ponto e TLD válido (ex: suaempresa.com.br), sem o "@" ou e-mail completo.`
    }
  }

  if (sanitizedDomains.length === 0 && isRequired) {
    return { ok: false, error: 'Informe ao menos um domínio de e-mail válido (ex: suaempresa.com).' }
  }

  return {
    ok: true,
    domains: sanitizedDomains,
    rawNormalized: sanitizedDomains.join(', ')
  }
}

/**
 * Valida um único domínio (ex: em condições de regras de roteamento).
 */
export function validateSingleDomain(
  input: string | undefined | null,
  options?: { required?: boolean }
): { ok: true; domain: string } | { ok: false; error: string } {
  const isRequired = options?.required ?? true
  if (!input || !String(input).trim()) {
    if (isRequired) {
      return { ok: false, error: 'O domínio do e-mail é obrigatório.' }
    }
    return { ok: true, domain: '' }
  }

  const raw = String(input).trim()
  const sanitized = sanitizeDomain(raw)

  if (!sanitized || !DOMAIN_REGEX.test(sanitized)) {
    return {
      ok: false,
      error: `O domínio "${raw}" é inválido. Digite apenas o domínio com ponto e TLD válido (ex: suaempresa.com.br), sem o "@".`
    }
  }

  return { ok: true, domain: sanitized }
}
