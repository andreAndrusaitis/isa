import { describe, it, expect } from 'vitest'
import { describeRule, ruleAppliesToQueue } from './escalationRules'

const queues = [{ id: 'sec', name: 'Fila de Segurança' }, { id: 'diag', name: 'Diagnóstico' }]
const users = [{ id: 'u1', name: 'Ana Analista' }]
const base = { target_queue_id: 'sec', target_agent_id: null, target_category_id: null, keep_origin: false, target_priority: null } as const

describe('describeRule', () => {
  it('transferência para a fila, sem responsável', () => {
    expect(describeRule({ ...base, type: 'transfer', target_mode: 'queue' }, queues, users))
      .toBe('Transfere para a fila Fila de Segurança, sem responsável. Quem transferiu sai do chamado.')
  })
  it('transferência para analista fixo mantendo a origem e subindo a prioridade', () => {
    expect(describeRule({ ...base, type: 'transfer', target_mode: 'agent_fixed', target_agent_id: 'u1', keep_origin: true, target_priority: 'high' }, queues, users))
      .toBe('Transfere para a fila Fila de Segurança, para Ana Analista. Quem transferiu segue como colaborador. · prioridade alta')
  })
  it('atuação conjunta com analista escolhido e chamado filho', () => {
    expect(describeRule({ ...base, type: 'same_ticket', target_mode: 'agent_pick' }, queues, users))
      .toBe('Move para a fila Fila de Segurança; o responsável continua e analista escolhido na hora atua junto.')
    expect(describeRule({ ...base, type: 'child_ticket', target_mode: 'queue', keep_origin: true }, queues, users))
      .toBe('Abre chamado filho na fila Fila de Segurança. Quem escalonou acompanha o filho.')
  })
})

describe('ruleAppliesToQueue', () => {
  it('sem filas de origem vale para todas; com filas, só para elas', () => {
    expect(ruleAppliesToQueue({ source_queue_ids: [] }, 'diag')).toBe(true)
    expect(ruleAppliesToQueue({ source_queue_ids: ['diag'] }, 'diag')).toBe(true)
    expect(ruleAppliesToQueue({ source_queue_ids: ['diag'] }, 'sec')).toBe(false)
    expect(ruleAppliesToQueue({ source_queue_ids: ['diag'] }, null)).toBe(false)
  })
})
