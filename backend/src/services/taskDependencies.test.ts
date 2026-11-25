// Prisma real contra o banco local (a checagem de ciclo é uma CTE recursiva no
// Postgres). Cleanup restrito aos IDs criados aqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/taskDependencies.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createDependency } from './taskDependencies'
import { createTask, listTasksByProject, archiveTask } from './tasks'
import { checkCompletionBlockers } from './taskCompletion'

const S = `dep-${Date.now()}`
const ids = { userId: '', projects: [] as string[] }
let statusId = ''
let otherStatusId = ''

beforeAll(async () => {
  ids.userId = (await prisma.user.create({ data: { name: 'Teste Dependência', email: `${S}@test.local`, role: 'manager' } })).id
  const project = await prisma.project.create({ data: { name: `Projeto ${S}`, owner_id: ids.userId } })
  const other = await prisma.project.create({ data: { name: `Outro ${S}`, owner_id: ids.userId } })
  ids.projects.push(project.id, other.id)
  statusId = (await prisma.projectStatus.create({ data: { project_id: project.id, name: 'A Fazer', color: '#888', category: 'open', position: 0 } })).id
  otherStatusId = (await prisma.projectStatus.create({ data: { project_id: other.id, name: 'A Fazer', color: '#888', category: 'open', position: 0 } })).id
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: ids.projects } } })
  await prisma.user.delete({ where: { id: ids.userId } })
})

const newTask = (title: string, projectId = ids.projects[0], status = statusId) => createTask(projectId, ids.userId, { title, statusId: status })

describe('createDependency', () => {
  it('cria uma dependência direta', async () => {
    const [a, b] = [await newTask('A'), await newTask('B')]
    const dep = await createDependency(a.id, b.id)
    expect(dep).toMatchObject({ task_id: a.id, depends_on_id: b.id })
  })

  it('recusa ciclo direto e indireto, e a auto-dependência', async () => {
    const [a, b, c] = [await newTask('A'), await newTask('B'), await newTask('C')]
    await createDependency(a.id, b.id)
    await createDependency(b.id, c.id)
    await expect(createDependency(b.id, a.id)).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' })
    await expect(createDependency(c.id, a.id)).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' })
    await expect(createDependency(a.id, a.id)).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' })
    // Ramo sem ciclo continua permitido (A → C já é implícito, não fecha laço).
    await expect(createDependency(a.id, c.id)).resolves.toMatchObject({ task_id: a.id })
  })

  it('recusa depender de task de outro projeto (400)', async () => {
    const a = await newTask('Daqui')
    const foreign = await newTask('De lá', ids.projects[1], otherStatusId)
    await expect(createDependency(a.id, foreign.id)).rejects.toMatchObject({ statusCode: 400, code: 'DEPENDENCY_CROSS_PROJECT' })
  })

  it('dependência arquivada não bloqueia a conclusão nem aparece em blocked_by', async () => {
    const [a, b] = [await newTask('Bloqueada'), await newTask('Bloqueadora')]
    await createDependency(a.id, b.id)
    expect((await checkCompletionBlockers(a.id)).map((x) => x.code)).toContain('DEPENDENCIES_BLOCKING')
    expect((await listTasksByProject(ids.projects[0])).find((t) => t.id === a.id)!.blocked_by).toHaveLength(1)

    await archiveTask(b.id, ids.userId)
    expect((await checkCompletionBlockers(a.id)).map((x) => x.code)).not.toContain('DEPENDENCIES_BLOCKING')
    expect((await listTasksByProject(ids.projects[0])).find((t) => t.id === a.id)!.blocked_by).toHaveLength(0)
  })
})
