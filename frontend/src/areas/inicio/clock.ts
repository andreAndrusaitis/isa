/** Tempo em frase curta, para as telas iniciais. */
export function span(ms: number): string {
  const min = Math.max(0, Math.round(Math.abs(ms) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} dias`
}
export const ago = (iso: string, now = Date.now()) => `há ${span(now - new Date(iso).getTime())}`

/** "hoje até 16h", "amanhã até 9h30", "sexta, 27/11, até 14h". */
export function untilPhrase(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  const time = `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`
  if (diff === 0) return `hoje até ${time}`
  if (diff === 1) return `amanhã até ${time}`
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '')
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${weekday}, ${date}, até ${time}`
}

export interface ForecastInput {
  status: string; slaDeadline: string; clientForecastAt?: string | null
  pendingReason?: string | null; project_task?: { due_date?: string | null } | null
}
/**
 * Previsão que o cliente lê. Nunca diz "vencido": com a data passada e sem nova
 * previsão, conta que a equipe está com o pedido e vai informar outra.
 */
export function clientForecast(t: ForecastInput, now = new Date()): { text: string; at: string | null; renewed: boolean } {
  if (t.status === 'pending' && t.pendingReason === 'pending_user') return { text: 'Esperando a sua resposta para continuar.', at: null, renewed: false }
  const due = t.pendingReason === 'pending_project' ? t.project_task?.due_date : null
  if (due) {
    const date = new Date(due)
    if (date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) return { text: `Previsão: ${date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}, junto com um projeto.`, at: due, renewed: false }
  }
  if (t.clientForecastAt && new Date(t.clientForecastAt) > now) return { text: `Nova previsão: ${untilPhrase(t.clientForecastAt, now)}.`, at: t.clientForecastAt, renewed: true }
  if (t.status === 'pending') return { text: 'Aguardando um passo fora da equipe. Avisamos quando andar.', at: null, renewed: false }
  if (!t.clientForecastAt && new Date(t.slaDeadline) > now) return { text: `Previsão: ${untilPhrase(t.slaDeadline, now)}.`, at: t.slaDeadline, renewed: false }
  return { text: 'Vamos informar uma nova previsão.', at: null, renewed: false }
}
