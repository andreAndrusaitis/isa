type DateInput = string | number | Date | null | undefined

/** Data e hora completas, no fuso do navegador: "13/10/2026 14:32" ("" se inválida). */
export function formatDateTime(value: DateInput): string {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
