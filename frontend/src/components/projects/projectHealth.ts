export type ProjectHealth = 'healthy' | 'warning' | 'risk'

type Input = {
  targetDate?: string | null
  openTasks?: number
  overdueTasks?: number
  totalTasks?: number
  progress?: number
}

/**
 * Saúde do projeto: risco = prazo final vencido com trabalho aberto, ou 20%+ do
 * aberto atrasado; atenção = algum atraso, ou pouco avanço num projeto grande.
 * (Antes, uma única task atrasada já marcava o projeto como "em risco".)
 */
export function projectHealth(p: Input): ProjectHealth {
  const open = p.openTasks ?? 0
  const overdue = p.overdueTasks ?? 0
  if (open > 0 && p.targetDate && new Date(p.targetDate) < new Date()) return 'risk'
  if (open > 0 && overdue / open >= 0.2) return 'risk'
  if (overdue > 0) return 'warning'
  if ((p.progress ?? 0) < 30 && (p.totalTasks ?? 0) > 5) return 'warning'
  return 'healthy'
}
