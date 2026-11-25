import type { TaskPriority } from '@/types/projects'

/** Tinta por prioridade: só a mais alta chama atenção; as outras se leem pelos degraus do `PriorityDot`. */
export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: 'var(--danger)',
  high: 'var(--text-1)',
  normal: 'var(--text-2)',
  low: 'var(--text-3)',
  none: 'var(--border-strong)',
}

/** Degrau do `PriorityDot` para cada prioridade de task: três degraus (em vermelho) só para a crítica. */
export const PRIORITY_STEP: Record<TaskPriority, string> = {
  critical: 'high', high: 'medium', normal: 'low', low: 'low', none: 'low',
}
