/** ID visível da task: o do tipo (BUG-12) ou, em respostas sem chave, o #seq do projeto. */
export function taskLabel(task: { key?: string | null; seq?: number | null } | null | undefined): string {
  if (!task) return ''
  return task.key || (task.seq != null ? `#${task.seq}` : '')
}
