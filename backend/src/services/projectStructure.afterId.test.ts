// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/projectStructure.afterId.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import prisma from '../config/prisma'
import { createStatus, listStatuses } from './projectStructure'

describe('createStatus com afterId inexistente', () => {
  let projectId: string
  let otherProjectId: string
  let otherStatusId: string
  let userId: string

  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { name: 'Teste afterId', email: `afterid-${Date.now()}-${Math.random()}@test.com`, role: 'manager' } })).id
    projectId = (await prisma.project.create({ data: { name: `Projeto afterId ${Date.now()}`, owner_id: userId } })).id
    otherProjectId = (await prisma.project.create({ data: { name: `Outro afterId ${Date.now()}`, owner_id: userId } })).id
    await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#888', category: 'open', position: 0 } })
    otherStatusId = (await prisma.projectStatus.create({ data: { project_id: otherProjectId, name: 'Outro', color: '#888', category: 'open', position: 0 } })).id
  })

  afterEach(async () => {
    await prisma.projectStatus.deleteMany({ where: { project_id: { in: [projectId, otherProjectId] } } })
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('recusa com 400 em vez de inserir na posição 0', async () => {
    await expect(createStatus(projectId, { name: 'QA', color: '#f0a', category: 'in_review', afterId: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 400, code: 'STATUS_NOT_FOUND' })
    expect((await listStatuses(projectId)).map((s) => s.name)).toEqual(['A Fazer'])
  })

  it('recusa status de outro projeto como referência', async () => {
    await expect(createStatus(projectId, { name: 'QA', color: '#f0a', category: 'in_review', afterId: otherStatusId }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('projeto sem status e sem afterId continua criando na posição 0', async () => {
    const created = await createStatus(otherProjectId, { name: 'Novo', color: '#000', category: 'open', afterId: undefined })
    expect(created.position).toBe(1)
    await prisma.projectStatus.deleteMany({ where: { project_id: otherProjectId } })
    const first = await createStatus(otherProjectId, { name: 'Primeiro', color: '#000', category: 'open' })
    expect(first.position).toBe(0)
  })
})
