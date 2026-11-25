/** Saída de relatórios montados à mão: o conteúdo vem de usuário e de e-mail, nunca é confiável. */

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Texto para interpolar em HTML escrito com document.write. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ENTITIES[c])
}

// Espaço antes do sinal não salva: a planilha ignora e lê a fórmula do mesmo jeito.
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/
const PLAIN_NUMBER = /^[+-]?\d[\d.,]*$/

/**
 * Célula de CSV já entre aspas. Aspas são sintaxe do CSV e não impedem a fórmula:
 * o Excel avalia "=..." mesmo assim, por isso o apóstrofo. Número continua número.
 */
export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const isFormula = typeof value !== 'number' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)
  return `"${(isFormula ? `'${text}` : text).replace(/"/g, '""')}"`
}
