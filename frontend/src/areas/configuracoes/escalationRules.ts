/**
 * Regras de escalonamento: tipo, destino e opções, com a frase que explica o que a
 * regra faz. O painel de configuração e o modal "Escalonar chamado" usam a mesma
 * descrição para o analista saber exatamente o que vai acontecer.
 */
export type EscalationType = 'transfer' | 'same_ticket' | 'child_ticket' | 'category_change'
export type TargetMode = 'queue' | 'agent_pick' | 'agent_fixed'

export type EscalationRule = {
  id: string
  name: string
  type: EscalationType
  target_queue_id: string | null
  target_category_id: string | null
  auto_description: string | null
  active: boolean
  target_mode: TargetMode
  target_agent_id: string | null
  keep_origin: boolean
  require_note: boolean
  target_priority: 'low' | 'medium' | 'high' | null
  source_queue_ids: string[]
}

export const TYPE_META: Record<EscalationType, { label: string; short: string; badge: 'green' | 'purple' | 'blue' | 'amber' }> = {
  transfer: { label: 'Transferir', short: 'Move para outra fila e quem transferiu sai do chamado.', badge: 'green' },
  same_ticket: { label: 'Atuação conjunta', short: 'Move para outra fila; o responsável fica e outro analista atua junto.', badge: 'purple' },
  child_ticket: { label: 'Chamado filho', short: 'Abre um chamado vinculado em outra fila; este segue com você.', badge: 'blue' },
  category_change: { label: 'Mudar categoria', short: 'Troca a categoria e registra uma nota automática.', badge: 'amber' },
}

export const PRIORITY_LABEL: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }

type Named = { id: string; name: string }

/** Frase do que a regra faz, com os nomes das filas e do analista. */
export function describeRule(rule: Pick<EscalationRule, 'type' | 'target_mode' | 'target_queue_id' | 'target_agent_id' | 'target_category_id' | 'keep_origin' | 'target_priority'>, queues: Named[], users: Named[], categories: Named[] = []): string {
  const q = (id: string | null) => (id ? queues.find(x => x.id === id)?.name ?? id : '—')
  const agent = rule.target_mode === 'agent_fixed'
    ? users.find(u => u.id === rule.target_agent_id)?.name ?? 'analista definido na regra'
    : 'analista escolhido na hora'
  const prio = rule.target_priority ? ` · prioridade ${PRIORITY_LABEL[rule.target_priority].toLowerCase()}` : ''
  switch (rule.type) {
    case 'transfer': {
      const who = rule.target_mode === 'queue' ? 'sem responsável' : `para ${agent}`
      return `Transfere para a fila ${q(rule.target_queue_id)}, ${who}. ${rule.keep_origin ? 'Quem transferiu segue como colaborador.' : 'Quem transferiu sai do chamado.'}${prio}`
    }
    case 'same_ticket': {
      const who = rule.target_mode === 'queue' ? 'qualquer analista da fila atua junto' : `${agent} atua junto`
      return `Move para a fila ${q(rule.target_queue_id)}; o responsável continua e ${who}.${prio}`
    }
    case 'child_ticket':
      return `Abre chamado filho na fila ${q(rule.target_queue_id)}${rule.target_mode === 'queue' ? '' : `, com ${agent}`}. ${rule.keep_origin ? 'Quem escalonou acompanha o filho.' : ''}${prio}`.trim()
    case 'category_change':
      return `Muda a categoria para ${categories.find(c => c.id === rule.target_category_id)?.name ?? '—'}.${prio}`
  }
}

/** A regra aparece para este chamado? (vazio = todas as filas) */
export function ruleAppliesToQueue(rule: Pick<EscalationRule, 'source_queue_ids'>, queue: string | null | undefined) {
  return !rule.source_queue_ids?.length || (!!queue && rule.source_queue_ids.includes(queue))
}
