import { describe, expect, it } from 'vitest'
import { camelize } from './serialize'

describe('camelize', () => {
  it('converte as chaves de uma task do Prisma para o formato que o frontend lê', () => {
    // O bug que motivou este módulo: a API servia status_id e o Board lia
    // statusId, então nenhuma coluna encontrava suas tasks.
    const fromPrisma = {
      id: 'abc',
      project_id: 'p1',
      status_id: 's1',
      due_date: new Date('2026-09-19T12:00:00Z'),
      is_milestone: true,
      assignee_id: null,
    }

    expect(camelize(fromPrisma)).toEqual({
      id: 'abc',
      projectId: 'p1',
      statusId: 's1',
      dueDate: new Date('2026-09-19T12:00:00Z'),
      isMilestone: true,
      assigneeId: null,
    })
  })

  it('preserva Date em vez de transformá-la num objeto vazio', () => {
    const result = camelize({ created_at: new Date("2026-01-02T03:04:05Z") }) as unknown as { createdAt: Date }
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z')
  })

  it('percorre arrays e objetos aninhados', () => {
    const result = camelize({
      data: [{ task_id: 't1', actor: { user_name: 'Ana' } }],
    })
    expect(result).toEqual({ data: [{ taskId: 't1', actor: { userName: 'Ana' } }] })
  })

  it('não renomeia as chaves dentro de campos JSON opacos', () => {
    // `filters`/`recurrence` guardam JSON definido pelo usuário — renomear as
    // chaves de dentro corromperia o dado que ele salvou.
    const result = camelize({
      saved_filter: { id: 'f1', filters: { due_date: 'today', custom_field_x: 1 } },
      recurrence: { freq: 'weekly', on_complete: true },
    })

    expect(result).toEqual({
      savedFilter: { id: 'f1', filters: { due_date: 'today', custom_field_x: 1 } },
      recurrence: { freq: 'weekly', on_complete: true },
    })
  })

  it('mantém null e valores primitivos', () => {
    expect(camelize(null)).toBeNull()
    expect(camelize({ a_b: null, c_d: 0, e_f: false })).toEqual({ aB: null, cD: 0, eF: false })
  })

  it('mantém o _ inicial de chaves como o _count do Prisma', () => {
    expect(camelize({ _count: { members: 1 }, owner_id: 'u' })).toEqual({ _count: { members: 1 }, ownerId: 'u' })
  })
})
