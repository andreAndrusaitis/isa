// Auditoria de automações: referências das ações validadas no projeto, gatilhos
// sem disparo recusados, task_completed/subtasks_completed disparando de verdade.
// Prisma real; cleanup restrito aos IDs criados aqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/automations.audit.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { createTask, updateTask } from './tasks'
import { createAutomation, listAutomations } from './automationRules'
import { runAutomationsFor } from './automations'
import { requestApproval, decideApproval } from './taskApprovals'

vi.mock('../config/socket', () => ({ getIo: () => undefined }))

const S = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

describe('automações (auditoria)', () => {
  let projectId: string
  let otherProjectId: string
  let ownerId: string
  let outsiderId: string
  let todoId: string
  let doingId: string
  let doneId: string

  beforeEach(async () => {
    ownerId = (await prisma.user.create({ data: { name: 'Dono Auto', email: `auto-o-${S()}@test.com`, role: 'manager', module_projects: true } })).id
    outsiderId = (await prisma.user.create({ data: { name: 'Fora Auto', email: `auto-f-${S()}@test.com`, role: 'agent', module_projects: true } })).id
    projectId = (await prisma.project.create({ data: { name: `Auto ${S()}`, owner_id: ownerId, members: { create: { user_id: ownerId, role: 'owner' } } } })).id
    otherProjectId = (await prisma.project.create({ data: { name: `Outro ${S()}`, owner_id: outsiderId, members: { create: { user_id: outsiderId, role: 'owner' } } } })).id
    todoId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 } })).id
    doingId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Fazendo', color: '#00f', category: 'in_progress', position: 1 } })).id
    doneId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Concluído', color: '#0f0', category: 'done', position: 2 } })).id
  })

  afterEach(async () => {
    const ids = [projectId, otherProjectId]
    await prisma.automationRun.deleteMany({ where: { automation: { project_id: { in: ids } } } })
    await prisma.automation.deleteMany({ where: { project_id: { in: ids } } })
    await prisma.notification.deleteMany({ where: { task: { project_id: { in: ids } } } })
    await prisma.taskTag.deleteMany({ where: { task: { project_id: { in: ids } } } })
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: { in: ids } } } })
    await prisma.task.deleteMany({ where: { project_id: { in: ids }, parent_id: { not: null } } })
    await prisma.task.deleteMany({ where: { project_id: { in: ids } } })
    await prisma.project.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } })
  })

  describe('validação ao criar', () => {
    it('recusa etiqueta de outro projeto e aceita a do próprio', async () => {
      const foreign = await prisma.tag.create({ data: { project_id: otherProjectId, name: 'urgente', color: '#f00' } })
      const own = await prisma.tag.create({ data: { project_id: projectId, name: 'urgente', color: '#f00' } })
      await expect(createAutomation(projectId, ownerId, { name: 'x', trigger: 'task_created', actions: [{ type: 'add_tag', tagId: foreign.id }] }))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUTOMATION_TAG' })
      const ok = await createAutomation(projectId, ownerId, { name: 'y', trigger: 'task_created', actions: [{ type: 'add_tag', tagId: own.id }] })
      expect(ok.project_id).toBe(projectId)
    })

    it('recusa notificação para quem não é membro e aceita membro', async () => {
      await expect(createAutomation(projectId, ownerId, { name: 'x', trigger: 'task_created', actions: [{ type: 'send_notification', userId: outsiderId, message: 'oi' }] }))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUTOMATION_RECIPIENT' })
      await expect(createAutomation(projectId, ownerId, { name: 'y', trigger: 'task_created', actions: [{ type: 'send_notification', userId: ownerId, message: 'oi' }] }))
        .resolves.toBeTruthy()
    })

    it('recusa gatilhos sem disparo, mas regra antiga com eles continua listada', async () => {
      for (const trigger of ['due_date_reached', 'task_overdue'] as const) {
        await expect(createAutomation(projectId, ownerId, { name: 'x', trigger, actions: [{ type: 'change_priority', priority: 'high' }] }))
          .rejects.toMatchObject({ statusCode: 400, code: 'UNSUPPORTED_TRIGGER' })
      }
      await prisma.automation.create({ data: { project_id: projectId, name: 'legada', trigger: 'task_overdue', actions: [{ type: 'change_priority', priority: 'high' }], created_by: ownerId } })
      expect((await listAutomations(projectId)).map((a) => a.name)).toContain('legada')
    })
  })

  describe('gatilhos de conclusão', () => {
    it('task_completed dispara quando a task vai para etapa de conclusão (e não em outra etapa)', async () => {
      await createAutomation(projectId, ownerId, { name: 'Concluiu', trigger: 'task_completed', actions: [{ type: 'change_priority', priority: 'high' }] })
      const task = await createTask(projectId, ownerId, { title: 'T', statusId: todoId })

      await updateTask(task.id, ownerId, { statusId: doingId })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('none')

      await updateTask(task.id, ownerId, { statusId: doneId })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('high')
      const runs = await prisma.automationRun.findMany({ where: { task_id: task.id } })
      expect(runs.map((r) => r.status)).toEqual(['success'])
    })

    it('etapa com aprovação: task_completed só dispara quando a aprovação sai', async () => {
      const approvalDoneId = (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Aprovado', color: '#0a0', category: 'done', position: 3, requires_approval: true } })).id
      await createAutomation(projectId, ownerId, { name: 'Concluiu', trigger: 'task_completed', actions: [{ type: 'change_priority', priority: 'high' }] })
      const task = await createTask(projectId, ownerId, { title: 'T', statusId: doingId })
      const approval = await requestApproval(task.id, { approverId: ownerId }, ownerId)
      const moved = await prisma.task.update({ where: { id: task.id }, data: { status_id: approvalDoneId } })
      await runAutomationsFor('status_changed', moved, { actorId: ownerId, depth: 0 })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('none')

      await decideApproval(approval.id, ownerId, { status: 'approved' })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('high')
      await prisma.approval.deleteMany({ where: { task_id: task.id } })
    })

    it('subtasks_completed dispara no pai só quando a última subtask aberta fecha', async () => {
      await createAutomation(projectId, ownerId, { name: 'Filhas prontas', trigger: 'subtasks_completed', actions: [{ type: 'change_status', statusId: doneId }] })
      const parent = await createTask(projectId, ownerId, { title: 'Pai', statusId: doingId })
      const a = await createTask(projectId, ownerId, { title: 'A', statusId: todoId, parentId: parent.id })
      const b = await createTask(projectId, ownerId, { title: 'B', statusId: todoId, parentId: parent.id })

      await updateTask(a.id, ownerId, { statusId: doneId })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).status_id).toBe(doingId)

      await updateTask(b.id, ownerId, { statusId: doneId })
      expect((await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).status_id).toBe(doneId)
      const runs = await prisma.automationRun.findMany({ where: { automation: { project_id: projectId } } })
      expect(runs.map((r) => [r.task_id, r.status])).toEqual([[parent.id, 'success']])
    })
  })
})
