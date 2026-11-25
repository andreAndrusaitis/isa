import { describe, expect, it } from 'vitest'
import { escapeHtml, renderDossierHtml } from './html'
import type { Dossier } from './collect'

const evil = '<script>alert(1)</script>'

function dossier(): Dossier {
  const at = new Date('2026-10-10T15:00:00Z')
  return {
    generatedAt: at, generatedBy: 'Gerente "Teste"', period: { from: null, to: null },
    projects: [{
      id: 'p1', name: `Projeto ${evil}`, description: 'Desc', owner: 'Dono', color: '#123456',
      startDate: null, targetDate: null, archived: false,
      totals: { total: 1, done: 1, open: 0, overdue: 0, deliveredInPeriod: 1, pctDone: 100 },
      weekly: [{ week: '2026-W41', completed: 1 }], burndown: null,
      workload: [{ name: 'Ana', open: 0, activeHours: 2 }],
    }],
    tasks: [{
      id: 't1', projectId: 'p1', key: 'TASK-1', parentKey: null, title: `Tarefa ${evil}`, description: 'x',
      status: 'Concluído', statusCategory: 'done', type: 'Tarefa', list: null, sprint: null, priority: 'normal',
      assignees: ['Ana'], creator: 'Dono', createdAt: at, startDate: null, dueDate: null, completedAt: at,
      activeHours: 2, storyPoints: null, isMilestone: false, overdue: false, tags: [], checklist: [{ text: 'passo', done: true }],
      customFields: [], blockedBy: [], openBlockers: 0, documents: [], attachments: [], tickets: ['INC-1'],
    }],
    activities: [{ projectId: 'p1', taskKey: 'TASK-1', at, actor: 'Ana', type: 'status_changed', from: 'A Fazer', to: 'Concluído' }],
    comments: [{ projectId: 'p1', taskKey: 'TASK-1', at, author: 'Ana', body: `comentário ${evil}` }],
    approvals: [], tickets: [{ projectId: 'p1', taskKey: 'TASK-1', number: 'INC-1', title: 'Chamado', status: 'resolved', org: 'ACME' }],
    sprints: [], members: [{ projectId: 'p1', name: 'Ana', email: 'ana@x.com', role: 'member' }],
  }
}

describe('escapeHtml', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(escapeHtml(null)).toBe('')
  })
})

describe('renderDossierHtml', () => {
  const html = renderDossierHtml(dossier())

  it('é um documento completo e autocontido', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<link[^>]+href="http/)
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('nunca renderiza HTML vindo do usuário', () => {
    expect(html).not.toContain(evil)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('traz projeto, task, histórico, comentário e chamado', () => {
    expect(html).toContain('TASK-1')
    expect(html).toContain('A Fazer')
    expect(html).toContain('INC-1')
    expect(html).toContain('ACME')
    expect(html).toContain('Gerente &quot;Teste&quot;')
  })
})
