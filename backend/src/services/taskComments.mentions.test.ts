// PENDENTE DE MIGRATION: ver nota em backend/src/services/tasks.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createComment } from './taskComments'

describe('taskComments mentions', () => {
  let projectId: string
  let taskId: string
  let authorId: string
  let mentionedId: string
  const outsiders: string[] = []

  beforeEach(async () => {
    const author = await prisma.user.create({ data: { name: 'Autor', email: `autor-${Date.now()}@test.com`, role: 'manager' } })
    const mentioned = await prisma.user.create({ data: { name: 'Mencionado', email: `mencionado-${Date.now()}@test.com`, role: 'agent' } })
    authorId = author.id
    mentionedId = mentioned.id
    const project = await prisma.project.create({ data: { name: `Projeto Mentions ${Date.now()}`, owner_id: authorId } })
    projectId = project.id
    await prisma.projectMember.create({ data: { project_id: projectId, user_id: mentionedId, role: 'member' } })
    const status = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 } })
    const task = await prisma.task.create({
      data: { project_id: projectId, status_id: status.id, seq: 1, title: 'Task', creator_id: authorId },
    })
    taskId = task.id
  })

  afterEach(async () => {
    await prisma.mention.deleteMany({ where: { comment: { task_id: taskId } } })
    await prisma.notification.deleteMany({ where: { user_id: mentionedId } })
    await prisma.taskComment.deleteMany({ where: { task_id: taskId } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.deleteMany({ where: { id: { in: [authorId, mentionedId, ...outsiders.splice(0)] } } })
  })

  it('creates a Mention row for each mentioned user and a notification with a deep link', async () => {
    const comment = await createComment(taskId, authorId, { body: '@Mencionado veja isso', mentionedUserIds: [mentionedId] })

    const mentions = await prisma.mention.findMany({ where: { comment_id: comment.id } })
    expect(mentions).toHaveLength(1)
    expect(mentions[0].mentioned_id).toBe(mentionedId)

    const notifications = await prisma.notification.findMany({ where: { user_id: mentionedId, type: 'task_updated' } })
    expect(notifications.length).toBeGreaterThan(0)
  })

  it('does not create a Mention row when mentionedUserIds is empty', async () => {
    const comment = await createComment(taskId, authorId, { body: 'sem menção', mentionedUserIds: [] })
    const mentions = await prisma.mention.findMany({ where: { comment_id: comment.id } })
    expect(mentions).toHaveLength(0)
  })

  it('recusa menção a quem está fora do projeto: nada é gravado e ninguém é notificado', async () => {
    const outsider = await prisma.user.create({ data: { name: 'Fora', email: `fora-${Date.now()}@test.com`, role: 'user' } })
    outsiders.push(outsider.id)

    await expect(createComment(taskId, authorId, { body: 'Aprove em http://x', mentionedUserIds: [mentionedId, outsider.id] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'MENTION_NOT_MEMBER' })

    expect(await prisma.taskComment.count({ where: { task_id: taskId } })).toBe(0)
    expect(await prisma.notification.count({ where: { user_id: { in: [mentionedId, outsider.id] } } })).toBe(0)
  })

  it('o próprio autor não conta como gente de fora, mesmo sem ser membro', async () => {
    const comment = await createComment(taskId, authorId, { body: 'nota para mim', mentionedUserIds: [authorId] })
    expect(await prisma.mention.count({ where: { comment_id: comment.id } })).toBe(1)
  })
})
