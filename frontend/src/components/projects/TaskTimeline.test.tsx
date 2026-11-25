import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityLine, activitySentence, buildFeed, dayLabel } from './TaskTimeline'
import type { TaskActivityEvent } from '@/services/drillService'

const actor = { id: 'u1', name: 'André' }
const ev = (over: Partial<TaskActivityEvent>): TaskActivityEvent => ({ id: 'e', type: 'created', createdAt: '2026-11-03T14:32:00', actor, ...over })
const text = (e: TaskActivityEvent) => render(<p>{activitySentence(e)}</p>).container.textContent

describe('frases do histórico', () => {
  it.each([
    [ev({ type: 'status_changed', from: 'Em Andamento', to: 'QA' }), 'moveu de Em Andamento para QA'],
    [ev({ type: 'checklist_changed', action: 'added', to: 'Validar em QA' }), 'adicionou ao checklist Validar em QA'],
    [ev({ type: 'checklist_changed', action: 'done', to: 'Validar em QA' }), 'concluiu no checklist Validar em QA'],
    [ev({ type: 'checklist_changed' }), 'atualizou o checklist'],
    [ev({ type: 'assignee_changed', from: 'Ana', to: 'Bia' }), 'trocou o responsável de Ana para Bia'],
    [ev({ type: 'assignees_changed', added: ['Ana'], removed: [] }), 'adicionou Ana aos responsáveis'],
    [ev({ type: 'priority_changed', from: 'normal', to: 'high' }), 'alterou a prioridade de Normal para Alta'],
    [ev({ type: 'tag_changed', from: 'urgente' }), 'removeu a tag urgente'],
    [ev({ type: 'ticket_changed', to: 'ISA-12' }), 'vinculou o chamado ISA-12'],
    [ev({ type: 'approval_decided', to: 'changes_requested' }), 'pediu alterações'],
    [ev({ type: 'evento_novo' }), 'atualizou a task'],
  ])('%#', (event, expected) => {
    expect(text(event)).toBe(expected)
  })

  it('mostra o prazo como data, não como ISO', () => {
    expect(text(ev({ type: 'due_date_changed', from: null, to: '2026-11-10T12:00:00.000Z' }))).toBe('definiu o prazo como 10/11/2026')
  })

  it('cada linha traz quem fez e a hora', () => {
    render(<ActivityLine event={ev({ type: 'status_changed', from: 'A', to: 'B' })} />)
    expect(screen.getByText('André')).toBeTruthy()
    expect(screen.getByText('14:32')).toBeTruthy()
  })
})

describe('fila de comentários e histórico', () => {
  const now = new Date('2026-11-04T10:00:00')

  it('dia por extenso, com Hoje e Ontem', () => {
    expect(dayLabel('2026-11-04T08:00:00', now)).toBe('Hoje')
    expect(dayLabel('2026-11-03T23:00:00', now)).toBe('Ontem')
    expect(dayLabel('2026-11-01T08:00:00', now)).toBe('Domingo, 1 de novembro de 2026')
  })

  it('intercala por horário, com um divisor por dia, e tira o evento "commented"', () => {
    const feed = buildFeed(
      [{ id: 'c1', createdAt: '2026-11-03T15:00:00' }],
      [
        ev({ id: 'e2', createdAt: '2026-11-04T09:00:00' }),
        ev({ id: 'e1', createdAt: '2026-11-03T14:00:00' }),
        ev({ id: 'e3', type: 'commented', createdAt: '2026-11-03T15:00:00' }),
      ],
      now,
    )
    expect(feed.map((i) => i.key)).toEqual(['d-Ontem', 'e-e1', 'c-c1', 'd-Hoje', 'e-e2'])
  })
})
