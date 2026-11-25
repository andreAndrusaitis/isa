// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui —
// nunca deleteMany amplo em user/organization.
//   cd backend && npx vitest run --fileParallelism=false src/services/taskCompletion.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createTask } from './tasks'
import { checkCompletionBlockers, completeTask, applyBulkAction } from './taskCompletion'
import { createRelation, listRelations, nextOccurrence, spawnNextOccurrence } from './taskCollab'
import { requestApproval } from './taskApprovals'
import { AppError } from '../middlewares/errorHandler'

describe('conclusão de task', () => {
  let projectId: string
  let openStatusId: string
  let doneStatusId: string
  let userId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste Conclusão', email: `completion-${Date.now()}-${Math.random()}@test.com`, role: 'manager' },
    })
    userId = user.id
    const project = await prisma.project.create({
      data: { name: `Projeto Conclusão ${Date.now()}`, owner_id: userId },
    })
    projectId = project.id
    openStatusId = (await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'A Fazer', color: '#888', category: 'open', position: 0 },
    })).id
    doneStatusId = (await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'Concluído', color: '#0a0', category: 'done', position: 1 },
    })).id
  })

  afterEach(async () => {
    await prisma.taskRelation.deleteMany({ where: { from_task: { project_id: projectId } } })
    await prisma.taskDependency.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.checklistItem.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.notification.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.customFieldValue.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.customField.deleteMany({ where: { project_id: projectId } })
    await prisma.task.deleteMany({ where: { project_id: projectId, parent_id: { not: null } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('conclui uma task sem impedimentos e a move para o status done', async () => {
    const task = await createTask(projectId, userId, { title: 'Simples', statusId: openStatusId })

    expect(await checkCompletionBlockers(task.id)).toEqual([])

    const result = await completeTask(task.id, userId)
    expect(result.outcome).toBe('completed')

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status_id).toBe(doneStatusId)
  })

  it('bloqueia a conclusão quando há subtask pendente', async () => {
    const parent = await createTask(projectId, userId, { title: 'Pai', statusId: openStatusId })
    await createTask(projectId, userId, { title: 'Filha', statusId: openStatusId, parentId: parent.id })

    const blockers = await checkCompletionBlockers(parent.id)
    expect(blockers.map((b) => b.code)).toContain('SUBTASKS_PENDING')

    await expect(completeTask(parent.id, userId)).rejects.toThrow(AppError)

    // A task não pode ter mudado de status depois de um bloqueio.
    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })
    expect(unchanged.status_id).toBe(openStatusId)
  })

  it('bloqueia quando há checklist em aberto e libera ao concluir os itens', async () => {
    const task = await createTask(projectId, userId, { title: 'Com checklist', statusId: openStatusId })
    const item = await prisma.checklistItem.create({
      data: { task_id: task.id, text: 'Validar no Edge', done: false, position: 0 },
    })

    expect((await checkCompletionBlockers(task.id)).map((b) => b.code)).toContain('CHECKLIST_PENDING')

    await prisma.checklistItem.update({ where: { id: item.id }, data: { done: true } })
    expect(await checkCompletionBlockers(task.id)).toEqual([])
  })

  it('bloqueia quando uma dependência ainda não foi concluída', async () => {
    const blocker = await createTask(projectId, userId, { title: 'Bloqueadora', statusId: openStatusId })
    const dependent = await createTask(projectId, userId, { title: 'Dependente', statusId: openStatusId })
    await prisma.taskDependency.create({ data: { task_id: dependent.id, depends_on_id: blocker.id } })

    expect((await checkCompletionBlockers(dependent.id)).map((b) => b.code)).toContain('DEPENDENCIES_BLOCKING')

    await completeTask(blocker.id, userId)
    expect(await checkCompletionBlockers(dependent.id)).toEqual([])
  })

  it('reporta todos os impedimentos de uma vez, não só o primeiro', async () => {
    const task = await createTask(projectId, userId, { title: 'Múltiplos bloqueios', statusId: openStatusId })
    await createTask(projectId, userId, { title: 'Sub', statusId: openStatusId, parentId: task.id })
    await prisma.checklistItem.create({ data: { task_id: task.id, text: 'Pendente', done: false, position: 0 } })

    const codes = (await checkCompletionBlockers(task.id)).map((b) => b.code)
    expect(codes).toContain('SUBTASKS_PENDING')
    expect(codes).toContain('CHECKLIST_PENDING')
  })

  it('bloqueia quando um campo personalizado obrigatório está vazio', async () => {
    await prisma.customField.create({
      data: { project_id: projectId, name: 'Ambiente', type: 'text', required: true, position: 0 },
    })
    const task = await createTask(projectId, userId, { title: 'Sem campo', statusId: openStatusId })

    const blockers = await checkCompletionBlockers(task.id)
    expect(blockers.map((b) => b.code)).toContain('REQUIRED_FIELDS_MISSING')
    expect(blockers.find((b) => b.code === 'REQUIRED_FIELDS_MISSING')!.message).toContain('Ambiente')
  })

  it('aguarda aprovação em vez de concluir quando o status exige', async () => {
    const approvalStatus = await prisma.projectStatus.create({
      data: {
        project_id: projectId, name: 'Aguardando Aprovação', color: '#fa0',
        category: 'in_review', position: 2, requires_approval: true,
      },
    })
    const task = await createTask(projectId, userId, { title: 'Precisa aprovar', statusId: openStatusId })

    const result = await completeTask(task.id, userId, { statusId: approvalStatus.id })
    expect(result.outcome).toBe('awaiting_approval')

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status_id).toBe(approvalStatus.id)
  })

  it('recusa um statusId de outro projeto', async () => {
    const other = await prisma.project.create({ data: { name: `Outro ${Date.now()}`, owner_id: userId } })
    const foreignStatus = await prisma.projectStatus.create({
      data: { project_id: other.id, name: 'Externo', color: '#000', category: 'done', position: 0 },
    })
    const task = await createTask(projectId, userId, { title: 'Alvo', statusId: openStatusId })

    await expect(completeTask(task.id, userId, { statusId: foreignStatus.id })).rejects.toThrow(/Status inválido/)

    await prisma.projectStatus.delete({ where: { id: foreignStatus.id } })
    await prisma.project.delete({ where: { id: other.id } })
  })

  describe('bulk actions', () => {
    it('aplica a ação às tasks do projeto e recusa ids de fora', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      const b = await createTask(projectId, userId, { title: 'B', statusId: openStatusId })

      const other = await prisma.project.create({ data: { name: `Fora ${Date.now()}`, owner_id: userId } })
      const otherStatus = await prisma.projectStatus.create({
        data: { project_id: other.id, name: 'X', color: '#000', category: 'open', position: 0 },
      })
      const foreign = await createTask(other.id, userId, { title: 'Fora', statusId: otherStatus.id })

      const result = await applyBulkAction(projectId, userId, {
        taskIds: [a.id, b.id, foreign.id],
        action: 'priority',
        priority: 'high',
      })

      expect(result.succeeded).toEqual(expect.arrayContaining([a.id, b.id]))
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].taskId).toBe(foreign.id)

      // A task de fora não pode ter sido alterada.
      expect((await prisma.task.findUniqueOrThrow({ where: { id: foreign.id } })).priority).toBe('none')
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).priority).toBe('high')

      await prisma.taskActivity.deleteMany({ where: { task: { project_id: other.id } } })
      await prisma.task.deleteMany({ where: { project_id: other.id } })
      await prisma.projectStatus.deleteMany({ where: { project_id: other.id } })
      await prisma.project.delete({ where: { id: other.id } })
    })
  })

  describe('edição em massa — datas, tipo e permissões', () => {
    it('define o mesmo prazo em todas e adia por N dias só quem tem prazo', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId, dueDate: '2026-10-10T12:00:00.000Z' })
      const b = await createTask(projectId, userId, { title: 'B', statusId: openStatusId })

      await applyBulkAction(projectId, userId, { taskIds: [a.id, b.id], action: 'due_date', date: '2026-11-01T12:00:00.000Z' }, 'member')
      for (const id of [a.id, b.id]) {
        expect((await prisma.task.findUniqueOrThrow({ where: { id } })).due_date?.toISOString()).toBe('2026-11-01T12:00:00.000Z')
      }

      await prisma.task.update({ where: { id: b.id }, data: { due_date: null } })
      const shifted = await applyBulkAction(projectId, userId, { taskIds: [a.id, b.id], action: 'due_date', shiftDays: 7 }, 'member')
      expect(shifted.succeeded).toHaveLength(2)
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).due_date?.toISOString()).toBe('2026-11-08T12:00:00.000Z')
      expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).due_date).toBeNull()

      // Cada mudança fica no histórico da task.
      expect(await prisma.taskActivity.count({ where: { task_id: a.id, type: 'due_date_changed' } })).toBe(2)
    })

    it('troca o tipo em massa e cada task ganha ID no tipo novo', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      const b = await createTask(projectId, userId, { title: 'B', statusId: openStatusId })
      const bug = await prisma.taskType.findFirstOrThrow({ where: { project_id: projectId, prefix: 'BUG' } })
      await applyBulkAction(projectId, userId, { taskIds: [a.id, b.id], action: 'task_type', taskTypeId: bug.id }, 'member')
      const keys = (await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { seq: 'asc' } })).map((t) => t.key)
      expect(keys).toEqual(['BUG-1', 'BUG-2'])
    })

    it('membro não arquiva em massa (só dono/gerente, igual à task individual)', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      await expect(applyBulkAction(projectId, userId, { taskIds: [a.id], action: 'archive' }, 'member')).rejects.toThrow(/dono ou um gerente/)
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).archived_at).toBeNull()
      const ok = await applyBulkAction(projectId, userId, { taskIds: [a.id], action: 'archive' }, 'manager')
      expect(ok.succeeded).toEqual([a.id])
    })

    it('recusa tag de outro projeto', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      const other = await prisma.project.create({ data: { name: `Fora tag ${Date.now()}`, owner_id: userId } })
      const tag = await prisma.tag.create({ data: { project_id: other.id, name: 'alheia', color: '#000' } })
      await expect(applyBulkAction(projectId, userId, { taskIds: [a.id], action: 'add_tag', tagId: tag.id }, 'member')).rejects.toThrow(/outro projeto/)
      await prisma.tag.delete({ where: { id: tag.id } })
      await prisma.project.delete({ where: { id: other.id } })
    })
  })

  describe('relações entre tasks', () => {
    it('cria a relação e a lista dos dois lados', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      const b = await createTask(projectId, userId, { title: 'B', statusId: openStatusId })

      await createRelation(a.id, userId, { toTaskId: b.id, type: 'relates_to' })

      expect((await listRelations(a.id))[0].task.id).toBe(b.id)
      expect((await listRelations(b.id))[0].task.id).toBe(a.id)
    })

    it('recusa auto-relação e duplicata em qualquer direção', async () => {
      const a = await createTask(projectId, userId, { title: 'A', statusId: openStatusId })
      const b = await createTask(projectId, userId, { title: 'B', statusId: openStatusId })

      await expect(createRelation(a.id, userId, { toTaskId: a.id, type: 'relates_to' })).rejects.toThrow(/ela mesma/)

      await createRelation(a.id, userId, { toTaskId: b.id, type: 'relates_to' })
      await expect(createRelation(b.id, userId, { toTaskId: a.id, type: 'relates_to' })).rejects.toThrow(/já estão relacionadas/)
    })
  })

  describe('recorrência', () => {
    it('calcula a próxima ocorrência por frequência e intervalo', () => {
      const base = new Date('2026-09-19T12:00:00Z')
      expect(nextOccurrence(base, { freq: 'daily', interval: 1, mode: 'on_complete' }).getUTCDate()).toBe(20)
      expect(nextOccurrence(base, { freq: 'weekly', interval: 2, mode: 'on_complete' }).getUTCDate()).toBe(3)
      expect(nextOccurrence(base, { freq: 'monthly', interval: 1, mode: 'on_complete' }).getUTCMonth()).toBe(9)
      expect(nextOccurrence(base, { freq: 'yearly', interval: 1, mode: 'on_complete' }).getUTCFullYear()).toBe(2027)
    })

    it('gera a próxima ocorrência ao concluir e para de recorrer na anterior', async () => {
      const task = await createTask(projectId, userId, {
        title: 'Relatório semanal',
        statusId: openStatusId,
        dueDate: new Date('2026-09-21T18:00:00Z').toISOString(),
        recurrence: { freq: 'weekly', interval: 1, mode: 'on_complete' },
      })

      const result = await completeTask(task.id, userId)
      expect(result.recurrenceSpawnedId).toBeTruthy()

      const spawned = await prisma.task.findUniqueOrThrow({ where: { id: result.recurrenceSpawnedId! } })
      expect(spawned.title).toBe('Relatório semanal')
      expect(spawned.status_id).toBe(openStatusId)
      expect(spawned.due_date?.toISOString()).toBe(new Date('2026-09-28T18:00:00Z').toISOString())

      // A ocorrência concluída deixa de ser o molde — senão cada conclusão
      // futura geraria uma duplicata a mais.
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).recurrence).toBeNull()
    })

    it('não gera ocorrência quando a task não é recorrente', async () => {
      const task = await createTask(projectId, userId, { title: 'Avulsa', statusId: openStatusId })
      expect(await spawnNextOccurrence(task.id)).toBeNull()
    })
  })
})

describe('quem pode ser aprovador', () => {
  const S = `apr-${Date.now()}`
  const userIds: string[] = []
  let projectId: string, owner: string, manager: string, member: string, colleague: string, viewer: string, stranger: string
  let openId: string, gateId: string

  const newTask = () => createTask(projectId, owner, { title: 'Precisa aprovar', statusId: openId })

  beforeAll(async () => {
    const mk = async (key: string) => {
      const u = await prisma.user.create({ data: { name: key, email: `${key}-${S}@test.com`, role: 'agent' } })
      userIds.push(u.id)
      return u.id
    }
    ;[owner, manager, member, colleague, viewer, stranger] = await Promise.all(['dono', 'gerente', 'membro', 'colega', 'leitor', 'fora'].map(mk))
    projectId = (await prisma.project.create({
      data: {
        name: `Projeto ${S}`, owner_id: owner,
        members: { create: [
          { user_id: owner, role: 'owner' }, { user_id: manager, role: 'manager' }, { user_id: member, role: 'member' },
          { user_id: colleague, role: 'member' }, { user_id: viewer, role: 'viewer' },
        ] },
      },
    })).id
    openId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#888', category: 'open', position: 0 } })).id
    gateId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Aprovado', color: '#0a0', category: 'done', position: 1, requires_approval: true } })).id
  })

  afterAll(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.notification.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  })

  it('membro não se indica ao concluir, e a task não sai do lugar', async () => {
    const task = await newTask()
    await expect(completeTask(task.id, member, { statusId: gateId, approverId: member })).rejects.toMatchObject({ statusCode: 400, code: 'APPROVER_IS_REQUESTER' })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status_id).toBe(openId)
    expect(await prisma.approval.count({ where: { task_id: task.id } })).toBe(0)
  })

  it('membro não pede aprovação a si mesmo pela rota manual', async () => {
    const task = await newTask()
    await expect(requestApproval(task.id, { approverId: member }, member)).rejects.toMatchObject({ code: 'APPROVER_IS_REQUESTER' })
    expect(await prisma.approval.count({ where: { task_id: task.id } })).toBe(0)
  })

  it('quem está fora ou só lê não vira aprovador: a pendência travaria a task para sempre', async () => {
    const task = await newTask()
    await expect(requestApproval(task.id, { approverId: stranger }, member)).rejects.toMatchObject({ statusCode: 400, code: 'APPROVER_NOT_MEMBER' })
    await expect(requestApproval(task.id, { approverId: viewer }, member)).rejects.toMatchObject({ code: 'APPROVER_NOT_MEMBER' })
    await expect(completeTask(task.id, member, { statusId: gateId, approverId: stranger })).rejects.toMatchObject({ code: 'APPROVER_NOT_MEMBER' })
    expect(await prisma.approval.count({ where: { task_id: task.id } })).toBe(0)
  })

  it('segue valendo: colega, dono por padrão, e dono ou gerente indicando a si', async () => {
    const task = await newTask()
    expect((await requestApproval(task.id, { approverId: colleague }, member)).approver_id).toBe(colleague)
    await prisma.approval.deleteMany({ where: { task_id: task.id } })
    expect((await requestApproval(task.id, { approverId: owner }, owner)).approver_id).toBe(owner)
    await prisma.approval.deleteMany({ where: { task_id: task.id } })
    expect((await requestApproval(task.id, { approverId: manager }, manager)).approver_id).toBe(manager)
    await prisma.approval.deleteMany({ where: { task_id: task.id } })

    const result = await completeTask(task.id, member, { statusId: gateId })
    expect(result.outcome).toBe('awaiting_approval')
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: result.approvalId! } })).approver_id).toBe(owner)
  })
})
