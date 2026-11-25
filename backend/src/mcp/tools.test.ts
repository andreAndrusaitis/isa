import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { mcpTools } from './tools'

describe('mcp tools', () => {
  let userId: string
  let outsiderId: string
  let projectId: string
  let statusId: string

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { name: 'MCP Owner', email: 'mcp-owner@test.local', role: 'user', active: true },
    })
    const outsider = await prisma.user.create({
      data: { name: 'MCP Outsider', email: 'mcp-outsider@test.local', role: 'user', active: true },
    })
    userId = owner.id
    outsiderId = outsider.id

    const project = await prisma.project.create({
      data: { name: 'Projeto MCP', owner_id: userId },
    })
    projectId = project.id
    await prisma.projectMember.create({ data: { project_id: projectId, user_id: userId, role: 'owner' } })

    const status = await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 },
    })
    statusId = status.id
  })

  afterAll(async () => {
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.user.delete({ where: { id: outsiderId } })
  })

  it('list_projects devolve só os projetos em que o usuário é membro', async () => {
    const result = await mcpTools.list_projects.handler({}, userId)
    expect(result.some((p: any) => p.id === projectId)).toBe(true)

    const outsiderResult = await mcpTools.list_projects.handler({}, outsiderId)
    expect(outsiderResult.some((p: any) => p.id === projectId)).toBe(false)
  })

  it('get_project lança erro para quem não é membro do projeto', async () => {
    await expect(mcpTools.get_project.handler({ projectId }, outsiderId)).rejects.toThrow(/não encontrado/i)
  })

  it('create_task cria uma tarefa e get_task/list_tasks a devolvem', async () => {
    const created = await mcpTools.create_task.handler(
      { projectId, title: 'Tarefa via MCP', statusId },
      userId,
    )
    expect(created.title).toBe('Tarefa via MCP')

    const fetched = await mcpTools.get_task.handler({ taskId: created.id }, userId)
    expect(fetched?.id).toBe(created.id)

    const list = await mcpTools.list_tasks.handler({ projectId }, userId)
    expect(list.some((t: any) => t.id === created.id)).toBe(true)

    await expect(mcpTools.get_task.handler({ taskId: created.id }, outsiderId)).rejects.toThrow(/não encontrado/i)
  })

  it('list_tasks lança erro para quem não é membro do projeto', async () => {
    await expect(mcpTools.list_tasks.handler({ projectId }, outsiderId)).rejects.toThrow(/não encontrado/i)
  })

  it('create_task lança erro para quem não é membro do projeto', async () => {
    await expect(
      mcpTools.create_task.handler({ projectId, title: 'Tarefa proibida', statusId }, outsiderId),
    ).rejects.toThrow(/não encontrado/i)
  })

  it('update_task atualiza o status da tarefa', async () => {
    const created = await mcpTools.create_task.handler(
      { projectId, title: 'Tarefa 2', statusId },
      userId,
    )
    const updated = await mcpTools.update_task.handler(
      { taskId: created.id, title: 'Tarefa 2 editada' },
      userId,
    )
    expect(updated.title).toBe('Tarefa 2 editada')
  })

  it('update_task lança erro para quem não é membro do projeto', async () => {
    const created = await mcpTools.create_task.handler(
      { projectId, title: 'Tarefa 3', statusId },
      userId,
    )
    await expect(
      mcpTools.update_task.handler({ taskId: created.id, title: 'Tentativa alheia' }, outsiderId),
    ).rejects.toThrow(/não encontrado/i)
  })
})
