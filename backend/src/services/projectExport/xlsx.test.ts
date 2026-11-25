import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildDossierWorkbook, safeCell } from './xlsx'
import type { Dossier } from './collect'

const at = new Date('2026-10-10T15:00:00Z')
const d: Dossier = {
  generatedAt: at, generatedBy: 'Gerente', period: { from: null, to: null },
  projects: [{ id: 'p1', name: 'Projeto', description: null, owner: 'Dono', color: null, startDate: null, targetDate: null, archived: false,
    totals: { total: 1, done: 0, open: 1, overdue: 0, deliveredInPeriod: 0, pctDone: 0 }, weekly: [], burndown: null, workload: [] }],
  tasks: [{ id: 't1', projectId: 'p1', key: 'TASK-1', parentKey: null, title: '=HYPERLINK("http://mal")', description: null,
    status: 'A Fazer', statusCategory: 'open', type: 'Tarefa', list: null, sprint: null, priority: 'none', assignees: [], creator: 'Dono',
    createdAt: at, startDate: null, dueDate: at, completedAt: null, activeHours: 0, storyPoints: null, isMilestone: false, overdue: false,
    tags: [], checklist: [], customFields: [], blockedBy: [], openBlockers: 0, documents: [], attachments: [], tickets: [] }],
  activities: [{ projectId: 'p1', taskKey: 'TASK-1', at, actor: 'Dono', type: 'created', from: null, to: null }],
  comments: [], approvals: [], tickets: [], sprints: [], members: [{ projectId: 'p1', name: 'Dono', email: 'd@x.com', role: 'owner' }],
}

describe('safeCell', () => {
  it('neutraliza fórmula e mantém texto comum', () => {
    expect(safeCell('=1+1')).toBe("'=1+1")
    expect(safeCell('+55 11')).toBe("'+55 11")
    expect(safeCell('-x')).toBe("'-x")
    expect(safeCell('@cmd')).toBe("'@cmd")
    expect(safeCell('normal')).toBe('normal')
    expect(safeCell(3)).toBe(3)
  })
})

describe('buildDossierWorkbook', () => {
  it('gera as 8 abas com cabeçalho e datas como data', async () => {
    const buf = await (await buildDossierWorkbook(d)).xlsx.writeBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Projetos', 'Tasks', 'Histórico', 'Comentários', 'Sprints', 'Chamados vinculados', 'Membros'])
    const tasks = wb.getWorksheet('Tasks')!
    expect(tasks.getRow(1).getCell(1).value).toBe('Projeto')
    expect(tasks.getRow(2).getCell(2).value).toBe('TASK-1')
    expect(tasks.getRow(2).getCell(3).value).toBe('\'=HYPERLINK("http://mal")')
    expect(tasks.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    const due = tasks.getRow(2).getCell((tasks.getRow(1).values as unknown[]).indexOf('Prazo')).value
    expect(due).toBeInstanceOf(Date)
  })
})
