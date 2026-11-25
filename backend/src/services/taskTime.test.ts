import { describe, it, expect } from 'vitest'
import { computeTaskTime, StatusInfo } from './taskTime'

const H = 3_600_000
const t0 = new Date('2026-10-05T12:00:00Z')
const at = (h: number) => new Date(t0.getTime() + h * H)
const statuses = new Map<string, StatusInfo>([
  ['backlog', { id: 'backlog', name: 'Backlog', category: 'backlog' }],
  ['todo', { id: 'todo', name: 'A Fazer', category: 'open' }],
  ['doing', { id: 'doing', name: 'Em Progresso', category: 'in_progress' }],
  ['review', { id: 'review', name: 'Revisão', category: 'in_review' }],
  ['done', { id: 'done', name: 'Concluído', category: 'done' }],
])
// relógio corrido em minutos: deixa as contas do teste legíveis
const wall = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000))

describe('computeTaskTime', () => {
  it('só conta tempo em andamento/revisão; backlog e a fazer pausam; concluída para', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'done', currentAssigneeId: 'ana', now: at(100), statuses, minutesBetween: wall,
      events: [
        { at: at(2), type: 'status', from: 'backlog', to: 'doing' }, // 2h de backlog (pausa)
        { at: at(5), type: 'status', from: 'doing', to: 'todo' },    // 3h ativas
        { at: at(9), type: 'status', from: 'todo', to: 'review' },   // 4h pausadas
        { at: at(10), type: 'status', from: 'review', to: 'done' },  // 1h ativa
      ],
    })
    expect(r.activeMinutes).toBe(4 * 60)
    expect(r.byStatus.backlog).toBe(2 * 60)
    expect(r.byStatus.todo).toBe(4 * 60)
    expect(r.byStatus.done ?? 0).toBe(0) // depois de concluída não conta mais
    expect(r.running).toBe(false)
    expect(r.startedAt).toEqual(at(2))
    expect(r.completedAt).toEqual(at(10))
  })

  it('task em andamento agora conta até o momento atual', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: null, now: at(6), statuses, minutesBetween: wall,
      events: [{ at: at(1), type: 'status', from: 'todo', to: 'doing' }],
    })
    expect(r.activeMinutes).toBe(5 * 60)
    expect(r.running).toBe(true)
    expect(r.completedAt).toBeNull()
  })

  it('sem histórico usa o status atual desde a criação', () => {
    const r = computeTaskTime({ createdAt: t0, currentStatusId: 'doing', currentAssigneeId: 'ana', now: at(3), statuses, minutesBetween: wall, events: [] })
    expect(r.activeMinutes).toBe(3 * 60)
    expect(r.byAssignee.ana).toBe(3 * 60)
  })

  it('atribui as horas a quem era o responsável em cada trecho', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: 'bia', now: at(5), statuses, minutesBetween: wall,
      events: [
        { at: at(0), type: 'status', from: 'todo', to: 'doing' },
        { at: at(2), type: 'assignee', from: 'ana', to: 'bia' },
      ],
    })
    expect(r.byAssignee).toEqual({ ana: 2 * 60, bia: 3 * 60 })
  })

  it('reaberta (concluída → em andamento) volta a contar', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: null, now: at(10), statuses, minutesBetween: wall,
      events: [
        { at: at(0), type: 'status', from: 'todo', to: 'doing' },
        { at: at(2), type: 'status', from: 'doing', to: 'done' },
        { at: at(8), type: 'status', from: 'done', to: 'doing' },
      ],
    })
    expect(r.activeMinutes).toBe(4 * 60)
    expect(r.running).toBe(true)
    expect(r.completedAt).toBeNull()
  })

  it('task criada já em andamento começa a contar na criação', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'done', currentAssigneeId: null, now: at(9), statuses, minutesBetween: wall,
      events: [{ at: at(2), type: 'status', from: 'doing', to: 'done' }],
    })
    expect(r.startedAt).toEqual(t0)
    expect(r.activeMinutes).toBe(2 * 60)
  })

  it('segmentos trazem status, responsável e se contaram', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'done', currentAssigneeId: 'ana', now: at(4), statuses, minutesBetween: wall,
      events: [
        { at: at(1), type: 'status', from: 'todo', to: 'doing' },
        { at: at(3), type: 'status', from: 'doing', to: 'done' },
      ],
    })
    expect(r.segments.map((s) => [s.statusId, s.minutes, s.counted])).toEqual([['todo', 60, false], ['doing', 120, true]])
  })

  it('vários responsáveis: cada um recebe o trecho inteiro, a task não soma em dobro', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: 'ana', currentAssigneeIds: ['ana', 'bia'], now: at(5), statuses, minutesBetween: wall,
      events: [
        { at: at(0), type: 'status', from: 'todo', to: 'doing' },
        { at: at(2), type: 'assignees', from: 'ana', to: 'ana,bia' }, // bia entra às 2h
      ],
    })
    expect(r.activeMinutes).toBe(5 * 60)
    expect(r.byAssignee).toEqual({ ana: 5 * 60, bia: 3 * 60 })
  })

  it('troca do principal (lista/Kanban) mantém os co-responsáveis', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: 'caio', currentAssigneeIds: ['caio', 'bia'], now: at(4), statuses, minutesBetween: wall,
      events: [
        { at: at(0), type: 'status', from: 'todo', to: 'doing' },
        { at: at(0), type: 'assignees', from: 'ana', to: 'ana,bia' },
        { at: at(1), type: 'assignee', from: 'ana', to: 'caio' },
      ],
    })
    expect(r.byAssignee).toEqual({ ana: 60, bia: 4 * 60, caio: 3 * 60 })
  })

  it('co-responsáveis de antes do histórico contam o período todo', () => {
    const r = computeTaskTime({
      createdAt: t0, currentStatusId: 'doing', currentAssigneeId: 'ana', currentAssigneeIds: ['ana', 'bia'], now: at(3), statuses, minutesBetween: wall, events: [],
    })
    expect(r.byAssignee).toEqual({ ana: 3 * 60, bia: 3 * 60 })
  })
})
