import ExcelJS from 'exceljs'
import type { Dossier } from './collect'

/** Texto que o Excel leria como fórmula (= + - @, tab, CR) vira texto literal. */
export function safeCell<T>(v: T): T | string {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

// Datas gravadas no horário de São Paulo (o Excel não guarda fuso): desloca -3h e marca como data.
const SP_OFFSET_MS = 3 * 60 * 60 * 1000
const toSp = (d: Date | null) => (d ? new Date(d.getTime() - SP_OFFSET_MS) : null)

type Col = { header: string; width: number; date?: boolean }

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.date ? { numFmt: 'dd/mm/yyyy hh:mm' } : {} }))
  for (const r of rows) ws.addRow(r.map((v, i) => (cols[i].date ? toSp(v as Date | null) : safeCell(v))))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

export async function buildDossierWorkbook(d: Dossier): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = d.generatedBy
  wb.created = d.generatedAt
  const pname = new Map(d.projects.map((p) => [p.id, p.name]))
  const P = (id: string) => pname.get(id) ?? id

  sheet(wb, 'Resumo', [
    { header: 'Projeto', width: 36 }, { header: 'Tasks', width: 10 }, { header: '% concluído', width: 12 }, { header: 'Em aberto', width: 11 },
    { header: 'Atrasadas', width: 11 }, { header: 'Entregas no período', width: 18 },
  ], d.projects.map((p) => [p.name, p.totals.total, p.totals.pctDone / 100, p.totals.open, p.totals.overdue, p.totals.deliveredInPeriod]))
  wb.getWorksheet('Resumo')!.getColumn(3).numFmt = '0%'

  sheet(wb, 'Projetos', [
    { header: 'Projeto', width: 36 }, { header: 'Descrição', width: 50 }, { header: 'Dono', width: 24 },
    { header: 'Início', width: 16, date: true }, { header: 'Meta', width: 16, date: true }, { header: 'Arquivado', width: 10 },
  ], d.projects.map((p) => [p.name, p.description, p.owner, p.startDate, p.targetDate, p.archived ? 'Sim' : 'Não']))

  sheet(wb, 'Tasks', [
    { header: 'Projeto', width: 28 }, { header: 'Chave', width: 12 }, { header: 'Título', width: 50 }, { header: 'Status', width: 16 },
    { header: 'Categoria', width: 13 }, { header: 'Tipo', width: 14 }, { header: 'Lista', width: 18 }, { header: 'Sprint', width: 16 },
    { header: 'Prioridade', width: 11 }, { header: 'Responsáveis', width: 30 }, { header: 'Criador', width: 22 },
    { header: 'Criada', width: 16, date: true }, { header: 'Início', width: 16, date: true }, { header: 'Prazo', width: 16, date: true },
    { header: 'Concluída', width: 16, date: true }, { header: 'Horas ativas', width: 12 }, { header: 'Pontos', width: 8 },
    { header: 'Marco', width: 7 }, { header: 'Atrasada', width: 9 }, { header: 'Task pai', width: 11 }, { header: 'Depende de', width: 16 },
    { header: 'Tags', width: 20 }, { header: 'Checklist', width: 12 }, { header: 'Campos personalizados', width: 30 },
    { header: 'Documentos', width: 24 }, { header: 'Anexos', width: 24 }, { header: 'Chamados', width: 16 }, { header: 'Descrição', width: 60 },
  ], d.tasks.map((t) => [
    P(t.projectId), t.key, t.title, t.status, t.statusCategory, t.type, t.list, t.sprint, t.priority, t.assignees.join(', '), t.creator,
    t.createdAt, t.startDate, t.dueDate, t.completedAt, t.activeHours, t.storyPoints, t.isMilestone ? 'Sim' : '', t.overdue ? 'Sim' : '',
    t.parentKey, t.blockedBy.join(', '), t.tags.join(', '),
    t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : '',
    t.customFields.map((f) => `${f.name}: ${f.value}`).join(' | '), t.documents.join(', '), t.attachments.join(', '), t.tickets.join(', '), t.description,
  ]))

  sheet(wb, 'Histórico', [
    { header: 'Projeto', width: 28 }, { header: 'Chave', width: 12 }, { header: 'Quando', width: 18, date: true },
    { header: 'Quem', width: 24 }, { header: 'Ação', width: 20 }, { header: 'De', width: 30 }, { header: 'Para', width: 30 },
  ], d.activities.map((a) => [P(a.projectId), a.taskKey, a.at, a.actor, a.type, a.from, a.to]))

  sheet(wb, 'Comentários', [
    { header: 'Projeto', width: 28 }, { header: 'Chave', width: 12 }, { header: 'Quando', width: 18, date: true },
    { header: 'Autor', width: 24 }, { header: 'Comentário', width: 80 },
  ], d.comments.map((c) => [P(c.projectId), c.taskKey, c.at, c.author, c.body]))

  sheet(wb, 'Sprints', [
    { header: 'Projeto', width: 28 }, { header: 'Sprint', width: 22 }, { header: 'Status', width: 12 },
    { header: 'Início', width: 16, date: true }, { header: 'Fim', width: 16, date: true }, { header: 'Tasks', width: 8 }, { header: 'Concluídas', width: 11 },
  ], d.sprints.map((s) => [P(s.projectId), s.name, s.status, s.startDate, s.endDate, s.total, s.done]))

  sheet(wb, 'Chamados vinculados', [
    { header: 'Projeto', width: 28 }, { header: 'Task', width: 12 }, { header: 'Chamado', width: 14 },
    { header: 'Título', width: 50 }, { header: 'Status', width: 12 }, { header: 'Empresa', width: 24 },
  ], d.tickets.map((k) => [P(k.projectId), k.taskKey, k.number, k.title, k.status, k.org]))

  sheet(wb, 'Membros', [
    { header: 'Projeto', width: 28 }, { header: 'Nome', width: 28 }, { header: 'E-mail', width: 32 }, { header: 'Papel', width: 12 },
  ], d.members.map((m) => [P(m.projectId), m.name, m.email, m.role]))

  return wb
}
