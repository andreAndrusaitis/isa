/**
 * Rótulos de TaskActivityType em português, compartilhados pelo feed da Minha
 * Área, pelo histórico da Task e pela atividade do projeto — para que o mesmo
 * evento nunca seja descrito de três formas diferentes.
 */
const LABELS: Record<string, string> = {
  created: 'criou',
  status_changed: 'alterou o status',
  priority_changed: 'alterou a prioridade',
  assignee_changed: 'alterou o responsável',
  due_date_changed: 'alterou o prazo',
  title_changed: 'alterou o título',
  description_changed: 'alterou a descrição',
  moved_list: 'moveu de lista',
  commented: 'comentou',
  checklist_changed: 'atualizou o checklist',
  archived: 'arquivou',
  restored: 'restaurou',
  milestone_changed: 'alterou a marcação de ponto de controle',
  watcher_added: 'passou a seguir',
  watcher_removed: 'deixou de seguir',
  relation_added: 'relacionou',
  relation_removed: 'removeu a relação',
  approval_requested: 'solicitou aprovação',
  approval_decided: 'decidiu a aprovação',
}

export function describeActivity(type: string): string {
  return LABELS[type] ?? 'atualizou'
}
