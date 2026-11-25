// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui —
// nunca deleteMany amplo em user/organization.
//   cd backend && DATABASE_URL="postgresql://isa:isa@localhost:5433/isa" npx vitest run --fileParallelism=false src/services/sprints.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../app'
import { env } from '../config/env'
import prisma from '../config/prisma'
import { createTask } from './tasks'
import { createSprint, createSprintSchema, listSprints, updateSprint, startSprint, completeSprint, deleteSprint } from './sprints'
import { AppError } from '../middlewares/errorHandler'

describe('gerenciamento de sprints por projeto', () => {
  let projectId: string
  let userId: string
  let statusId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste Sprints', email: `sprints-${Date.now()}-${Math.random()}@test.com`, role: 'manager' },
    })
    userId = user.id
    const project = await prisma.project.create({ data: { name: `Projeto Sprints ${Date.now()}`, owner_id: userId } })
    projectId = project.id
    const status = await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 },
    })
    statusId = status.id
  })

  afterEach(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.sprint.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('cria um sprint no fim da lista, com status planned por padrão', async () => {
    const sprint1 = await createSprint(projectId, { name: 'Sprint 1' })
    const sprint2 = await createSprint(projectId, { name: 'Sprint 2' })

    expect(sprint1.status).toBe('planned')
    expect(sprint1.position).toBe(0)
    expect(sprint2.position).toBe(1)

    const listed = await listSprints(projectId)
    expect(listed.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2'])
  })

  it('atualiza nome e datas', async () => {
    const created = await createSprint(projectId, { name: 'Sprint 1' })
    const updated = await updateSprint(projectId, created.id, {
      name: 'Sprint 1 - revisado', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-14T00:00:00.000Z',
    })
    expect(updated.name).toBe('Sprint 1 - revisado')
    expect(updated.start_date?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('inicia um sprint planned e recusa iniciar um segundo enquanto o primeiro está ativo', async () => {
    const sprint1 = await createSprint(projectId, { name: 'Sprint 1' })
    const sprint2 = await createSprint(projectId, { name: 'Sprint 2' })

    const started = await startSprint(projectId, sprint1.id)
    expect(started.status).toBe('active')

    await expect(startSprint(projectId, sprint2.id)).rejects.toThrow(AppError)
  })

  it('encerra um sprint ativo sem desvincular as tasks', async () => {
    const sprint = await createSprint(projectId, { name: 'Sprint 1' })
    await startSprint(projectId, sprint.id)
    const task = await createTask(projectId, userId, { title: 'Na sprint', statusId, sprintId: sprint.id } as any)

    const completed = await completeSprint(projectId, sprint.id)
    expect(completed.status).toBe('completed')

    const reloadedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(reloadedTask.sprint_id).toBe(sprint.id)
  })

  it('exclui um sprint e as tasks vinculadas ficam com sprint_id nulo', async () => {
    const sprint = await createSprint(projectId, { name: 'Sprint 1' })
    const task = await createTask(projectId, userId, { title: 'Na sprint', statusId, sprintId: sprint.id } as any)

    await deleteSprint(projectId, sprint.id)

    const reloadedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(reloadedTask.sprint_id).toBeNull()
    expect(await prisma.sprint.findUnique({ where: { id: sprint.id } })).toBeNull()
  })

  describe('fim antes do início', () => {
    const D1 = '2026-10-01T00:00:00.000Z'
    const D10 = '2026-10-10T00:00:00.000Z'
    const D20 = '2026-10-20T00:00:00.000Z'
    const inverted = { statusCode: 400, code: 'SPRINT_DATES_INVERTED' }

    it('recusa na criação e aceita o mesmo dia', async () => {
      await expect(createSprint(projectId, { name: 'Invertida', startDate: D10, endDate: D1 })).rejects.toMatchObject(inverted)
      expect(await prisma.sprint.count({ where: { project_id: projectId } })).toBe(0)
      expect((await createSprint(projectId, { name: 'Um dia', startDate: D10, endDate: D10 })).end_date?.toISOString()).toBe(D10)
    })

    it('na edição, compara com o valor salvo quando só uma das datas vem', async () => {
      const sprint = await createSprint(projectId, { name: 'Sprint', startDate: D10, endDate: D20 })
      await expect(updateSprint(projectId, sprint.id, { endDate: D1 })).rejects.toMatchObject(inverted)
      await expect(updateSprint(projectId, sprint.id, { startDate: '2026-10-25T00:00:00.000Z' })).rejects.toMatchObject(inverted)
      await expect(updateSprint(projectId, sprint.id, { startDate: D20, endDate: D1 })).rejects.toMatchObject(inverted)

      const saved = await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } })
      expect([saved.start_date?.toISOString(), saved.end_date?.toISOString()]).toEqual([D10, D20])
    })

    it('limpar uma das datas libera a outra; trocar as duas juntas vale pelo novo par', async () => {
      const sprint = await createSprint(projectId, { name: 'Sprint', startDate: D10, endDate: D20 })
      expect((await updateSprint(projectId, sprint.id, { startDate: null, endDate: D1 })).end_date?.toISOString()).toBe(D1)
      const moved = await updateSprint(projectId, sprint.id, { startDate: D10, endDate: D20 })
      expect(moved.start_date?.toISOString()).toBe(D10)
    })

    it('sprint antigo já invertido continua podendo ser renomeado', async () => {
      const legacy = await prisma.sprint.create({ data: { project_id: projectId, name: 'Antigo', start_date: new Date(D10), end_date: new Date(D1), position: 0 } })
      expect((await updateSprint(projectId, legacy.id, { name: 'Renomeado' })).name).toBe('Renomeado')
    })

    it('sprint que não existe segue 404', async () => {
      await expect(updateSprint(projectId, '00000000-0000-0000-0000-000000000000', { endDate: D1 })).rejects.toMatchObject({ statusCode: 404 })
    })

    it('o schema continua extensível: a rota de sprint global faz .extend com o ownerId', () => {
      expect(createSprintSchema.extend({ ownerId: z.string() }).parse({ name: 'G', ownerId: 'x' })).toEqual({ name: 'G', ownerId: 'x' })
    })
  })
})

describe('datas do sprint pela API', () => {
  const S = `sprint-api-${Date.now()}`
  const D1 = '2026-10-01T00:00:00.000Z'
  const D10 = '2026-10-10T00:00:00.000Z'
  let manager: string
  let projectId: string
  const globalIds: string[] = []
  const auth = () => `Bearer ${jwt.sign({ sub: manager, role: 'manager', orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`

  beforeEach(async () => {
    manager = (await prisma.user.create({ data: { name: 'Gerente Sprint', email: `${S}-${Math.random()}@test.com`, role: 'manager', module_projects: true } })).id
    projectId = (await prisma.project.create({ data: { name: `Projeto ${S}`, owner_id: manager, members: { create: { user_id: manager, role: 'owner' } } } })).id
  })

  afterEach(async () => {
    await prisma.globalSprint.deleteMany({ where: { id: { in: globalIds.splice(0) } } })
    await prisma.sprint.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: manager } })
  })

  it('POST e PATCH respondem 400 com a data invertida', async () => {
    const base = `/api/projects/${projectId}/sprints`
    const inverted = await request(app).post(base).set('Authorization', auth()).send({ name: 'Invertida', startDate: D10, endDate: D1 })
    expect(inverted.status).toBe(400)
    expect(inverted.body.code).toBe('SPRINT_DATES_INVERTED')

    const created = await request(app).post(base).set('Authorization', auth()).send({ name: 'Certa', startDate: D1, endDate: D10 })
    expect(created.status).toBe(201)
    const patched = await request(app).patch(`${base}/${created.body.data.id}`).set('Authorization', auth()).send({ startDate: '2026-11-01T00:00:00.000Z' })
    expect(patched.status).toBe(400)
  })

  it('sprint global segue criando e editando pelos mesmos schemas', async () => {
    const created = await request(app).post('/api/projects/global-sprints').set('Authorization', auth()).send({ name: 'Global', ownerId: manager, startDate: D1, endDate: D10 })
    expect(created.status).toBe(201)
    globalIds.push(created.body.data.id)
    const patched = await request(app).patch(`/api/projects/global-sprints/${created.body.data.id}`).set('Authorization', auth()).send({ name: 'Global 2' })
    expect(patched.status).toBe(200)
  })
})
