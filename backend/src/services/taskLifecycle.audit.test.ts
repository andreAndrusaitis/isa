// Ciclo de vida da task (auditoria de Projetos): recorrência por qualquer caminho
// de conclusão, trava de conclusão no PATCH/lote/automação, aprovação, status
// inativo, arquivar com subtasks e previsão vencida no fuso de SP.
// Prisma real contra o banco local; cleanup restrito aos IDs criados aqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/taskLifecycle.audit.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { SYSTEM_USER_ID } from '../utils/constants'
import { createTask, updateTask, archiveTask } from './tasks'
import { completeTask, applyBulkAction } from './taskCompletion'
import { spawnNextOccurrence, spawnDueOccurrences } from './taskCollab'
import { decideApproval } from './taskApprovals'
import { deleteStatus } from './projectStructure'
import { linkTicketToTask, createTaskFromTicket, alertOverdueForecasts } from './ticketTaskLink'
import { dayKey } from './projectInsights'

const S = `life-${Date.now()}`
const ids = { users: [] as string[], tickets: [] as string[], orgId: '', projectId: '', systemCreated: false }
let owner = { sub: '', role: 'agent' }
let member = { sub: '', role: 'agent' }
const st = { open: '', doing: '', done: '', approval: '' }
let typeId = ''

const DAY = 86_400_000
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString()
const daily = { freq: 'daily' as const, interval: 1, mode: 'on_complete' as const }

const newTask = (title: string, extra: Record<string, unknown> = {}) =>
  createTask(ids.projectId, owner.sub, { title, statusId: st.open, dueDate: inDays(3), ...extra })

async function newTicket() {
  const n = ids.tickets.length
  const id = `TKT-${S}-${n}`
  await prisma.ticket.create({
    data: {
      id, display_number: `ISA-${S}-${n}`, title: 'Chamado do ciclo', description: 'x',
      user_id: owner.sub, org_id: ids.orgId, assigned_to_id: owner.sub, queue: 'geral', status: 'in_progress',
      sla_deadline: new Date(Date.now() + 8 * 3_600_000), first_response_deadline: new Date(Date.now() + 3_600_000),
    },
  })
  ids.tickets.push(id)
  return id
}

const ticket = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } })
const occurrencesOf = (title: string) => prisma.task.count({ where: { project_id: ids.projectId, title } })

beforeAll(async () => {
  if (!(await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } }))) {
    await prisma.user.create({ data: { id: SYSTEM_USER_ID, name: 'Sistema', email: `system-${S}@t.local`, role: 'admin' } })
    ids.systemCreated = true
  }
  const org = await prisma.organization.create({ data: { name: `Org ${S}`, tier: 'bronze' } })
  ids.orgId = org.id
  const o = await prisma.user.create({ data: { name: 'Dono Ciclo', email: `o-${S}@t.local`, role: 'agent', org_id: org.id, module_projects: true } })
  const m = await prisma.user.create({ data: { name: 'Membro Ciclo', email: `m-${S}@t.local`, role: 'agent', org_id: org.id, module_projects: true } })
  ids.users.push(o.id, m.id)
  owner = { sub: o.id, role: 'agent' }
  member = { sub: m.id, role: 'agent' }
  const project = await prisma.project.create({
    data: { name: `Projeto ${S}`, owner_id: o.id, members: { create: [{ user_id: o.id, role: 'owner' }, { user_id: m.id, role: 'member' }] } },
  })
  ids.projectId = project.id
  const status = (name: string, category: 'open' | 'in_progress' | 'done', position: number, requires_approval = false) =>
    prisma.projectStatus.create({ data: { project_id: project.id, name, color: '#999', category, position, requires_approval } }).then((s) => s.id)
  st.open = await status('A Fazer', 'open', 0)
  st.doing = await status('Fazendo', 'in_progress', 1)
  st.done = await status('Concluído', 'done', 2)
  st.approval = await status('Concluído (aprovar)', 'done', 3, true)
  typeId = (await prisma.taskType.create({ data: { project_id: project.id, name: 'Tarefa', prefix: 'TAR', icon: 'Check', color: '#888', position: 0 } })).id
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ids.tickets } } })
  await prisma.notification.deleteMany({ where: { OR: [{ ticket_id: { in: ids.tickets } }, { user_id: { in: ids.users } }] } })
  await prisma.ticket.deleteMany({ where: { id: { in: ids.tickets } } })
  await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids.users } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
  await prisma.organization.deleteMany({ where: { id: ids.orgId } })
  if (ids.systemCreated) await prisma.user.deleteMany({ where: { id: SYSTEM_USER_ID } })
})

describe('recorrência on_complete por qualquer caminho de conclusão', () => {
  it('PATCH para status done gera a próxima ocorrência uma vez só', async () => {
    const task = await newTask('Recorrente PATCH', { recurrence: daily })
    const { recurrenceSpawnedId } = await updateTask(task.id, owner.sub, { statusId: st.done })
    expect(recurrenceSpawnedId).toBeTruthy()
    const next = await prisma.task.findUniqueOrThrow({ where: { id: recurrenceSpawnedId! } })
    expect(next.status_id).toBe(st.open)
    expect(next.due_date!.getTime() - task.due_date!.getTime()).toBe(DAY)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).recurrence).toBeNull()

    // Sair e voltar para done não gera outra.
    await updateTask(task.id, owner.sub, { statusId: st.open })
    await updateTask(task.id, owner.sub, { statusId: st.done })
    expect(await occurrencesOf('Recorrente PATCH')).toBe(2)
  })

  it('lote de status também gera', async () => {
    const task = await newTask('Recorrente lote', { recurrence: daily })
    const res = await applyBulkAction(ids.projectId, owner.sub, { taskIds: [task.id], action: 'status', statusId: st.done })
    expect(res.succeeded).toEqual([task.id])
    expect(await occurrencesOf('Recorrente lote')).toBe(2)
  })

  it('duas gerações simultâneas criam uma ocorrência só', async () => {
    const task = await newTask('Recorrente corrida', { recurrence: daily })
    const results = await Promise.all([spawnNextOccurrence(task.id), spawnNextOccurrence(task.id), spawnNextOccurrence(task.id)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await occurrencesOf('Recorrente corrida')).toBe(2)
  })

  it('modo on_due não gera ao concluir', async () => {
    const task = await newTask('Recorrente on_due concluída', { recurrence: { ...daily, mode: 'on_due' } })
    const { recurrenceSpawnedId } = await updateTask(task.id, owner.sub, { statusId: st.done })
    expect(recurrenceSpawnedId).toBeNull()
  })
})

describe('recorrência on_due (job)', () => {
  it('gera uma vez quando a data prevista chega, já na próxima data futura', async () => {
    const task = await newTask('Recorrente on_due', { recurrence: { ...daily, mode: 'on_due' }, dueDate: new Date(Date.now() - 3 * DAY).toISOString() })
    const future = await newTask('Recorrente on_due futura', { recurrence: { ...daily, mode: 'on_due' }, dueDate: inDays(2) })

    const now = new Date()
    await spawnDueOccurrences(now)
    const spawned = await prisma.task.findMany({ where: { project_id: ids.projectId, title: 'Recorrente on_due', id: { not: task.id } } })
    expect(spawned).toHaveLength(1)
    expect(spawned[0].due_date!.getTime()).toBeGreaterThan(now.getTime())
    expect(spawned[0].due_date!.getTime()).toBeLessThanOrEqual(now.getTime() + DAY)
    expect((spawned[0].recurrence as { mode: string }).mode).toBe('on_due')

    // Idempotente: rodar de novo não duplica; a futura ainda não venceu.
    await spawnDueOccurrences(now)
    expect(await occurrencesOf('Recorrente on_due')).toBe(2)
    expect(await occurrencesOf('Recorrente on_due futura')).toBe(1)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: future.id } })).recurrence).not.toBeNull()
  })
})

describe('trava de conclusão fora do /complete', () => {
  it('PATCH para done com checklist aberto devolve 409 TASK_COMPLETION_BLOCKED e não move', async () => {
    const task = await newTask('Checklist aberto')
    await prisma.checklistItem.create({ data: { task_id: task.id, text: 'Falta', done: false, position: 0 } })
    await expect(updateTask(task.id, owner.sub, { statusId: st.done })).rejects.toMatchObject({ statusCode: 409, code: 'TASK_COMPLETION_BLOCKED' })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status_id).toBe(st.open)
    // Status que não é de conclusão continua livre.
    await expect(updateTask(task.id, owner.sub, { statusId: st.doing })).resolves.toBeTruthy()
  })

  it('lote reporta a task bloqueada e aplica as demais', async () => {
    const blocked = await newTask('Lote bloqueada')
    const free = await newTask('Lote livre')
    await newTask('Sub pendente', { parentId: blocked.id })
    const res = await applyBulkAction(ids.projectId, owner.sub, { taskIds: [blocked.id, free.id], action: 'status', statusId: st.done })
    expect(res.succeeded).toEqual([free.id])
    expect(res.failed[0]).toMatchObject({ taskId: blocked.id, reason: expect.stringContaining('subtask') })
  })

  it('automação change_status para done com bloqueio é registrada como erro, sem derrubar a edição', async () => {
    const automation = await prisma.automation.create({
      data: { project_id: ids.projectId, name: `Auto ${S}`, trigger: 'priority_changed', actions: [{ type: 'change_status', statusId: st.done }], created_by: owner.sub },
    })
    const task = await newTask('Automação bloqueada')
    await prisma.checklistItem.create({ data: { task_id: task.id, text: 'Falta', done: false, position: 0 } })
    await updateTask(task.id, owner.sub, { priority: 'high' })
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.priority).toBe('high')
    expect(after.status_id).toBe(st.open)
    const run = await prisma.automationRun.findFirstOrThrow({ where: { automation_id: automation.id, task_id: task.id } })
    expect(run.status).toBe('error')
    expect(run.error_message).toContain('checklist')
    await prisma.automation.update({ where: { id: automation.id }, data: { is_active: false } })
  })
})

describe('status com aprovação', () => {
  it('completeTask abre a aprovação; chamados só resolvem quando o aprovador aprova', async () => {
    const task = await newTask('Precisa aprovar', { recurrence: daily })
    const ticketId = await newTicket()
    await linkTicketToTask(ids.projectId, task.id, ticketId, owner)

    const result = await completeTask(task.id, member.sub, { statusId: st.approval })
    expect(result.outcome).toBe('awaiting_approval')
    const approval = await prisma.approval.findUniqueOrThrow({ where: { id: result.approvalId! } })
    expect(approval).toMatchObject({ task_id: task.id, approver_id: owner.sub, status: 'pending' })
    expect((await ticket(ticketId)).status).toBe('pending')
    expect(await occurrencesOf('Precisa aprovar')).toBe(1)
    // Pular a aprovação movendo para o "done" comum também é concluir: barrado.
    await expect(updateTask(task.id, member.sub, { statusId: st.done })).rejects.toMatchObject({ code: 'TASK_COMPLETION_BLOCKED' })

    await decideApproval(approval.id, owner.sub, { status: 'approved' })
    const t = await ticket(ticketId)
    expect(t.status).toBe('resolved')
    expect(await occurrencesOf('Precisa aprovar')).toBe(2)
  })

  it('PATCH direto para o status com aprovação não resolve os chamados', async () => {
    const task = await newTask('PATCH aprovação')
    const ticketId = await newTicket()
    await linkTicketToTask(ids.projectId, task.id, ticketId, owner)
    await updateTask(task.id, owner.sub, { statusId: st.approval })
    expect((await ticket(ticketId)).status).toBe('pending')
  })

  it('só o aprovador decide, e uma vez só', async () => {
    const task = await newTask('Decisão única')
    const approval = await prisma.approval.create({ data: { task_id: task.id, approver_id: owner.sub } })
    await expect(decideApproval(approval.id, member.sub, { status: 'approved' })).rejects.toMatchObject({ statusCode: 403, code: 'APPROVAL_NOT_APPROVER' })
    await decideApproval(approval.id, owner.sub, { status: 'changes_requested', comment: 'Ajustar' })
    await expect(decideApproval(approval.id, owner.sub, { status: 'approved' })).rejects.toMatchObject({ statusCode: 409, code: 'APPROVAL_ALREADY_DECIDED' })
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('changes_requested')
  })
})

describe('status inativo (excluído) não recebe tasks', () => {
  it('PATCH, /complete e destino da exclusão recusam status inativo', async () => {
    const gone = await prisma.projectStatus.create({ data: { project_id: ids.projectId, name: 'Velho', color: '#000', category: 'done', position: 9, is_active: false } })
    const task = await newTask('Alvo inativo')
    await expect(updateTask(task.id, owner.sub, { statusId: gone.id })).rejects.toMatchObject({ statusCode: 400, code: 'STATUS_INACTIVE' })
    await expect(completeTask(task.id, owner.sub, { statusId: gone.id })).rejects.toMatchObject({ code: 'STATUS_INVALID' })

    const temp = await prisma.projectStatus.create({ data: { project_id: ids.projectId, name: 'Temporário', color: '#000', category: 'open', position: 8 } })
    await expect(deleteStatus(ids.projectId, temp.id, owner.sub, { reassignToId: gone.id })).rejects.toMatchObject({ code: 'STATUS_DELETE_INVALID_TARGET' })
    expect((await prisma.projectStatus.findUniqueOrThrow({ where: { id: temp.id } })).is_active).toBe(true)
  })

  it('task criada do chamado não cai num status "open" inativo', async () => {
    const gone = await prisma.projectStatus.create({ data: { project_id: ids.projectId, name: 'Aberto antigo', color: '#000', category: 'open', position: -1, is_active: false } })
    const ticketId = await newTicket()
    const { task } = await createTaskFromTicket(ids.projectId, owner, { ticket: ticketId, taskTypeId: typeId, dueDate: inDays(4) })
    expect(task.status_id).not.toBe(gone.id)
    expect(task.status_id).toBe(st.open)
  })
})

describe('arquivar task-pai', () => {
  it('arquiva as subtasks (todos os níveis) e devolve os chamados delas ao atendimento', async () => {
    const parent = await newTask('Pai')
    const child = await newTask('Filha', { parentId: parent.id })
    const grandchild = await newTask('Neta', { parentId: child.id })
    const ticketId = await newTicket()
    await linkTicketToTask(ids.projectId, child.id, ticketId, owner)

    await archiveTask(parent.id, owner.sub)
    for (const id of [child.id, grandchild.id]) {
      expect((await prisma.task.findUniqueOrThrow({ where: { id } })).archived_at).not.toBeNull()
      expect(await prisma.taskActivity.count({ where: { task_id: id, type: 'archived' } })).toBe(1)
    }
    const t = await ticket(ticketId)
    expect(t.status).toBe('in_progress')
    expect(t.project_task_id).toBeNull()
  })
})

describe('previsão vencida no fuso de São Paulo', () => {
  it('não avisa no próprio dia do prazo; avisa quando o dia acabou', async () => {
    const now = new Date()
    const today = dayKey(now)
    const yesterday = dayKey(new Date(now.getTime() - DAY))
    const dueToday = await newTask('Vence hoje', { dueDate: inDays(1) })
    const dueYesterday = await newTask('Venceu ontem', { dueDate: inDays(1) })
    const tToday = await newTicket()
    const tYesterday = await newTicket()
    await linkTicketToTask(ids.projectId, dueToday.id, tToday, owner)
    await linkTicketToTask(ids.projectId, dueYesterday.id, tYesterday, owner)
    // Como o frontend grava: a data às 12:00Z.
    await prisma.task.update({ where: { id: dueToday.id }, data: { due_date: new Date(`${today}T12:00:00.000Z`) } })
    await prisma.task.update({ where: { id: dueYesterday.id }, data: { due_date: new Date(`${yesterday}T12:00:00.000Z`) } })

    await alertOverdueForecasts(now)
    expect((await ticket(tToday)).project_forecast_alerted_at).toBeNull()
    expect((await ticket(tYesterday)).project_forecast_alerted_at).not.toBeNull()
  })
})
