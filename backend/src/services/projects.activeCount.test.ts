// O contador de projetos ativos do Dashboard conta só projetos com 1 ou
// mais tasks abertas. A base é open_tasks do GET /projects — testado aqui
// contra o banco descartável, com os 3 critérios de aceite da história.
// Cleanup restrito aos IDs criados aqui.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject, listProjectsForUser } from './projects'

const S = `active-count-${Date.now()}`
let ownerId: string
let projectId: string
let openStatusId: string
let doneStatusId: string
let cancelledStatusId: string
let seq = 0

const openTasksOf = async () => (await listProjectsForUser(ownerId)).find((p) => p.id === projectId)!.open_tasks
const newTask = (statusId: string) =>
  prisma.task.create({ data: { project_id: projectId, status_id: statusId, creator_id: ownerId, seq: ++seq, title: `t${seq}` } })

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { name: `Dono ${S}`, email: `dono-${S}@t.com`, role: 'manager', module_projects: true } })
  ownerId = owner.id
  const project = await createProject(ownerId, { name: `Projeto ${S}`, privacy: 'organization' })
  projectId = project.id
  const statuses = await prisma.projectStatus.findMany({ where: { project_id: projectId } })
  openStatusId = statuses.find((s) => !['done', 'cancelled'].includes(s.category))!.id
  doneStatusId = statuses.find((s) => s.category === 'done')!.id
  cancelledStatusId = statuses.find((s) => s.category === 'cancelled')?.id
    ?? (await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Cancelado', color: '#999999', category: 'cancelled', position: 99 } })).id
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.user.deleteMany({ where: { id: ownerId } })
  await prisma.$disconnect()
})

describe('projeto ativo = 1 ou mais tasks abertas', () => {
  it('projeto sem tasks não conta como ativo', async () => {
    expect(await openTasksOf()).toBe(0)
  })

  it('com task aberta, conta', async () => {
    await newTask(openStatusId)
    expect(await openTasksOf()).toBe(1)
  })

  it('a última task concluída tira o projeto da conta', async () => {
    await prisma.task.updateMany({ where: { project_id: projectId }, data: { status_id: doneStatusId } })
    expect(await openTasksOf()).toBe(0)
  })

  it('task arquivada (removida) não mantém o projeto ativo', async () => {
    const t = await newTask(openStatusId)
    await prisma.task.update({ where: { id: t.id }, data: { archived_at: new Date() } })
    expect(await openTasksOf()).toBe(0)
  })

  it('task cancelada não conta como aberta', async () => {
    await newTask(cancelledStatusId)
    expect(await openTasksOf()).toBe(0)
  })

  it('nova task aberta volta a contar, sem ação manual', async () => {
    await newTask(openStatusId)
    expect(await openTasksOf()).toBe(1)
  })
})
