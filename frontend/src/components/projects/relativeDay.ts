/** Diferença em dias de calendário (fuso local) entre a data e hoje: 0 = hoje, 1 = amanhã, -1 = ontem. */
export function daysFromToday(iso: string, now = new Date()): number {
  const d = new Date(iso)
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((day - today) / 86_400_000)
}

/**
 * Data de task como a pessoa fala: "Hoje", "Amanhã", "em 3 dias", "há 2 dias";
 * a partir de uma semana de distância volta a ser a data ("21 de out.").
 */
export function relativeDay(iso: string, now = new Date()): string {
  const diff = daysFromToday(iso, now)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  if (diff === -1) return 'Ontem'
  if (diff > 1 && diff < 7) return `em ${diff} dias`
  if (diff < -1 && diff > -7) return `há ${-diff} dias`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
