// Prisma real contra o banco descartável. Cleanup restrito aos IDs criados aqui.
//   cd backend && DATABASE_URL=postgresql://isa:isa@127.0.0.1:5434/isa DIRECT_URL=$DATABASE_URL npx vitest run --fileParallelism=false --test-timeout=30000 src/services/projectsTeam.service.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject, listProjectsForUser } from './projects'
import { createTask } from './tasks'
import { setAssignees } from './taskAssignees'
import { getDashboardGlobal, getTeamWorkload } from './projectsTeam'

const S = `${Date.now()}-${Math.random()}`
let managerId: string
let analystId: string
let outsiderId: string
let projectId: string

beforeAll(async () => {
  managerId = (await prisma.user.create({ data: { name: 'Gerente', email: `ptm-${S}@t.local`, role: 'manager', module_projects: true } })).id
  analystId = (await prisma.user.create({ data: { name: 'Analista', email: `pta-${S}@t.local`, role: 'agent', manager_id: managerId } })).id
  outsiderId = (await prisma.user.create({ data: { name: 'Fora', email: `pto-${S}@t.local`, role: 'agent', module_projects: true } })).id
  projectId = (await createProject(managerId, { name: `Carga ${S}`, privacy: 'restricted' })).id
  await prisma.projectMember.create({ data: { project_id: projectId, user_id: analystId, role: 'member' } })

  const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'open' } })
  const done = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'done' } })
  const past = '2026-01-10T12:00:00.000Z'
  // Atrasada e aberta, atrasada mas concluída, aberta sem prazo.
  await createTask(projectId, managerId, { title: 'aberta atrasada', statusId: open.id, assigneeId: analystId, dueDate: past })
  await createTask(projectId, managerId, { title: 'concluída antiga', statusId: done.id, assigneeId: analystId, dueDate: past })
  await createTask(projectId, managerId, { title: 'aberta', statusId: open.id })
})

afterAll(async () => {
  await prisma.taskAssignee.deleteMany({ where: { task: { project_id: projectId } } })
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
  await prisma.task.deleteMany({ where: { project_id: projectId } })
  await prisma.project.delete({ where: { id: projectId } })
  await prisma.user.deleteMany({ where: { id: { in: [analystId, outsiderId, managerId] } } })
})

describe('números de gestão de Projetos', () => {
  it('BI: atrasada só conta o que está aberto (concluída antiga não entra)', async () => {
    const dash = await getDashboardGlobal(managerId)
    expect(dash.totalTasks).toBe(3)
    expect(dash.overdueCount).toBe(1)
  })

  it('carga da equipe conta só tarefas em aberto', async () => {
    const workload = await getTeamWorkload(managerId)
    expect(workload).toEqual([{ userId: analystId, name: 'Analista', avatar: null, taskCount: 1 }])
  })

  it('lista de projetos traz progresso, abertas, atrasadas e membros', async () => {
    const [p] = (await listProjectsForUser(managerId)).filter((x) => x.id === projectId)
    expect(p).toMatchObject({ total_tasks: 3, done_tasks: 1, open_tasks: 2, overdue_tasks: 1, progress: 33, member_count: 2 })
  })

  it('responsável precisa ser membro do projeto (único e múltiplos)', async () => {
    const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'open' } })
    await expect(createTask(projectId, managerId, { title: 'x', statusId: open.id, assigneeId: outsiderId })).rejects.toThrow(/membro do projeto/)
    const task = await prisma.task.findFirstOrThrow({ where: { project_id: projectId, title: 'aberta' } })
    await expect(setAssignees(task.id, managerId, [analystId, outsiderId])).rejects.toThrow(/membro do projeto/)
    expect(await setAssignees(task.id, managerId, [analystId, managerId, analystId])).toEqual(expect.arrayContaining([analystId, managerId]))
    // O primeiro vira o principal pelo updateTask; o conjunto fica no histórico (base do tempo por pessoa).
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignee_id).toBe(analystId)
    const log = await prisma.taskActivity.findMany({ where: { task_id: task.id }, orderBy: { created_at: 'asc' } })
    expect(log.map((a) => a.type)).toEqual(['created', 'assignee_changed', 'assignees_changed'])
    expect(log[2]).toMatchObject({ from_value: null, to_value: `${analystId},${managerId}` })
  })
})
