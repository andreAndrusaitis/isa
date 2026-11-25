/**
 * Utilitários para validação e sanitização de domínios de e-mail e empresa.
 * Usado na validação Zod e serviços de Organizações e Roteamento.
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
 * - Remove pontos ou barras residuais no início ou fim
 */
export function sanitizeDomain(value: string | undefined | null): string {
  if (!value) return ''
  let d = String(value).trim().toLowerCase()
  if (d.includes('@')) {
    d = d.split('@').pop() || ''
  }
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/[/?#].*$/, '')
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
