// Prisma real contra o banco descartável 5434. Cleanup restrito aos IDs criados aqui.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../../config/prisma'
import { createProject } from '../projects'
import { createTask, updateTask } from '../tasks'
import { createComment } from '../taskComments'
import { collectDossier } from './collect'

const S = `dossie-${Date.now()}`
let ownerId: string
let projectId: string
let doneKey: string

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { name: `Dono ${S}`, email: `dono-${S}@t.com`, role: 'admin', module_projects: true } })).id
  projectId = (await createProject(ownerId, { name: `Projeto ${S}`, privacy: 'organization' })).id
  const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'open' } })
  const done = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'done' } })

  const a = await createTask(projectId, ownerId, { title: 'Entregar relatório', statusId: open.id })
  await updateTask(a.id, ownerId, { statusId: done.id })
  await createComment(a.id, ownerId, { body: 'Feito e validado', mentionedUserIds: [] })
  doneKey = (await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).key ?? `#${a.seq}`

  await createTask(projectId, ownerId, { title: 'Atrasada', statusId: open.id, dueDate: '2020-01-01T12:00:00.000Z' } as any)
})

afterAll(async () => {
  await prisma.taskComment.deleteMany({ where: { task: { project_id: projectId } } })
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
  await prisma.task.deleteMany({ where: { project_id: projectId } })
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.auditLog.deleteMany({ where: { user_id: ownerId } })
  await prisma.user.deleteMany({ where: { id: ownerId } })
  await prisma.$disconnect()
})

describe('collectDossier', () => {
  it('junta projeto, tasks, histórico traduzido, comentários e totais', async () => {
    const d = await collectDossier([projectId], { userId: ownerId, from: null, to: null })

    expect(d.generatedBy).toBe(`Dono ${S}`)
    expect(d.projects).toHaveLength(1)
    const p = d.projects[0]
    expect(p.name).toBe(`Projeto ${S}`)
    expect(p.totals).toMatchObject({ total: 2, done: 1, open: 1, overdue: 1, deliveredInPeriod: 1, pctDone: 50 })

    const done = d.tasks.find((t) => t.key === doneKey)!
    expect(done.statusCategory).toBe('done')
    expect(done.completedAt).toBeInstanceOf(Date)
    expect(d.tasks.find((t) => t.title === 'Atrasada')?.overdue).toBe(true)

    const change = d.activities.find((a) => a.taskKey === doneKey && a.type === 'status_changed')!
    expect(change.to).toBe('Concluído') // id do status traduzido para o nome
    expect(change.actor).toBe(`Dono ${S}`)

    expect(d.comments).toEqual([expect.objectContaining({ taskKey: doneKey, author: `Dono ${S}`, body: 'Feito e validado' })])
    expect(d.members.some((m) => m.name === `Dono ${S}` && m.role === 'owner')).toBe(true)
  })

  it('período recorta só as entregas', async () => {
    const d = await collectDossier([projectId], { userId: ownerId, from: new Date('2000-01-01'), to: new Date('2000-12-31') })
    expect(d.projects[0].totals.deliveredInPeriod).toBe(0)
    expect(d.projects[0].totals.done).toBe(1)
  })
})
