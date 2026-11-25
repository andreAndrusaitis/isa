// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui —
// nunca deleteMany amplo em user/organization.
//   cd backend && DATABASE_URL="postgresql://isa:isa@localhost:5433/isa" npx vitest run --fileParallelism=false src/services/projects.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject } from './projects'

describe('projects service', () => {
  let userId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste Projects', email: `projects-${Date.now()}-${Math.random()}@test.com`, role: 'manager' },
    })
    userId = user.id
  })

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } })
  })

  it('cria os 8 tipos de tarefa padrão, com prefixo de ID, junto com o projeto', async () => {
    const project = await createProject(userId, { name: `Projeto Seed ${Date.now()}`, privacy: 'organization' })
    const types = await prisma.taskType.findMany({ where: { project_id: project.id }, orderBy: { position: 'asc' } })

    expect(types.map((t) => t.name)).toEqual(['Epic', 'Feature', 'User Story', 'Tarefa', 'Bug', 'Melhoria', 'QA', 'Documentação'])
    expect(types.map((t) => t.prefix)).toEqual(['EPIC', 'FEAT', 'US', 'TASK', 'BUG', 'MEL', 'QA', 'DOC'])
    expect(types.every((t) => t.next_number === 1)).toBe(true)
    expect(types[4].icon).toBe('Bug')
    expect(types[4].color).toBe('#b3402a')

    await prisma.taskType.deleteMany({ where: { project_id: project.id } })
    await prisma.projectStatus.deleteMany({ where: { project_id: project.id } })
    await prisma.projectMember.deleteMany({ where: { project_id: project.id } })
    await prisma.project.delete({ where: { id: project.id } })
  })
})
