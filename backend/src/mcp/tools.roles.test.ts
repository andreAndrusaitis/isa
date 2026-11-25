// MCP respeita o papel no projeto: visualizador lê, mas não escreve. Prisma real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { mcpTools } from './tools'

const S = `mcpr-${Date.now()}`
const ids: Record<string, string> = {}

beforeAll(async () => {
  ids.viewer = (await prisma.user.create({ data: { name: 'Vê', email: `v-${S}@t.local`, role: 'agent', module_projects: true } })).id
  ids.owner = (await prisma.user.create({ data: { name: 'Dono', email: `o-${S}@t.local`, role: 'agent', module_projects: true } })).id
  ids.project = (await prisma.project.create({ data: { name: `P ${S}`, owner_id: ids.owner, members: { create: [{ user_id: ids.owner, role: 'owner' }, { user_id: ids.viewer, role: 'viewer' }] } } })).id
  ids.status = (await prisma.projectStatus.create({ data: { project_id: ids.project, name: 'A Fazer', color: '#999', category: 'open' } })).id
  ids.task = (await prisma.task.create({ data: { project_id: ids.project, status_id: ids.status, seq: 99, title: 'Original', creator_id: ids.owner } })).id
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: ids.project } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.viewer, ids.owner] } } })
})

describe('MCP e papel no projeto', () => {
  it('visualizador lê a task', async () => {
    const task: any = await mcpTools.get_task.handler({ taskId: ids.task }, ids.viewer)
    expect(task.title).toBe('Original')
  })

  it('visualizador não cria nem edita task', async () => {
    await expect(mcpTools.create_task.handler({ projectId: ids.project, title: 'x', statusId: ids.status } as any, ids.viewer)).rejects.toMatchObject({ statusCode: 403 })
    await expect(mcpTools.update_task.handler({ taskId: ids.task, title: 'invadido' } as any, ids.viewer)).rejects.toMatchObject({ statusCode: 403 })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ids.task } })).title).toBe('Original')
  })
})
