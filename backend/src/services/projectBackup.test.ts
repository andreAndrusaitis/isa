// Prisma real contra o banco descartável. Cleanup restrito aos IDs criados aqui.
//   cd backend && DATABASE_URL=postgresql://isa:isa@127.0.0.1:5434/isa DIRECT_URL=$DATABASE_URL npx vitest run --fileParallelism=false --test-timeout=30000 src/services/projectBackup.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject } from './projects'
import { createTask } from './tasks'
import { exportProject, previewImport, runImport, mapClickUpStatus, guessTypePrefix } from './projectBackup'

describe('mapeamento do ClickUp', () => {
  it('status vão para a categoria certa e os padrão são reaproveitados', () => {
    expect(mapClickUpStatus('concluído')).toMatchObject({ name: 'Concluído', category: 'done' })
    expect(mapClickUpStatus('to do')).toMatchObject({ name: 'A Fazer', category: 'open' })
    expect(mapClickUpStatus('em andamento')).toMatchObject({ name: 'Em Progresso', category: 'in_progress' })
    expect(mapClickUpStatus('backlog').category).toBe('backlog')
    expect(mapClickUpStatus('deploy (ainda não subiu)').category).toBe('in_review')
    expect(mapClickUpStatus('virada para produção').category).toBe('in_review')
    expect(mapClickUpStatus('em andamento (mvp)').category).toBe('in_progress')
  })

  it('tipo vem da tag ou do título', () => {
    expect(guessTypePrefix('ID 1 - [BUG] quebra', [])).toBe('BUG')
    expect(guessTypePrefix('Algo', ['epic'])).toBe('EPIC')
    expect(guessTypePrefix('ID 9 - [FEATURE] – nova tela', [])).toBe('FEAT')
    expect(guessTypePrefix('US 3.1 - fluxo', [])).toBe('US')
    expect(guessTypePrefix('Reunião com cliente', [])).toBe('TASK')
  })
})

describe('backup de projeto', () => {
  let owner: { id: string; email: string }
  let mate: { id: string; email: string }
  const created: string[] = []

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random()}`
    owner = await prisma.user.create({ data: { name: 'Dono Backup', email: `bk-owner-${stamp}@test.com`, role: 'admin' }, select: { id: true, email: true } })
    mate = await prisma.user.create({ data: { name: 'Colega Backup', email: `bk-mate-${stamp}@test.com`, role: 'admin' }, select: { id: true, email: true } })
  })

  afterEach(async () => {
    const projectIds = [...created.splice(0)]
    await prisma.taskComment.deleteMany({ where: { task: { project_id: { in: projectIds } } } })
    await prisma.checklistItem.deleteMany({ where: { task: { project_id: { in: projectIds } } } })
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: { in: projectIds } } } })
    await prisma.task.deleteMany({ where: { project_id: { in: projectIds }, parent_id: { not: null } } })
    await prisma.task.deleteMany({ where: { project_id: { in: projectIds } } })
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
    await prisma.auditLog.deleteMany({ where: { user_id: { in: [owner.id, mate.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, mate.id] } } })
  })

  it('exportar e importar recria o projeto com os mesmos IDs, status, tags e checklist', async () => {
    const project = await createProject(owner.id, { name: `Origem ${Date.now()}`, privacy: 'organization' })
    created.push(project.id)
    await prisma.projectMember.create({ data: { project_id: project.id, user_id: mate.id, role: 'member' } })
    const status = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: project.id, category: 'in_progress' } })
    const bug = await prisma.taskType.findFirstOrThrow({ where: { project_id: project.id, prefix: 'BUG' } })
    const tag = await prisma.tag.create({ data: { project_id: project.id, name: 'cliente', color: '#123456' } })

    const epic = await createTask(project.id, owner.id, { title: 'Épico', statusId: status.id, taskTypeId: (await prisma.taskType.findFirstOrThrow({ where: { project_id: project.id, prefix: 'EPIC' } })).id })
    await createTask(project.id, owner.id, { title: 'Bug 1', statusId: status.id, taskTypeId: bug.id })
    const bug2 = await createTask(project.id, owner.id, { title: 'Bug 2', statusId: status.id, taskTypeId: bug.id, assigneeId: mate.id, parentId: epic.id, priority: 'high', dueDate: '2026-12-01T12:00:00.000Z' })
    await prisma.taskTag.create({ data: { task_id: bug2.id, tag_id: tag.id } })
    await prisma.checklistItem.create({ data: { task_id: bug2.id, text: 'reproduzir', done: true } })
    await prisma.taskComment.create({ data: { task_id: bug2.id, author_id: mate.id, body: 'achei a causa' } })

    const backup = JSON.parse(JSON.stringify(await exportProject(project.id)))
    expect(backup.format).toBe('isa.project-backup')

    const preview = await previewImport(owner, backup)
    expect(preview).toMatchObject({ format: 'backup', totalTasks: 3, peopleMissing: [] })

    const result = await runImport(owner, backup)
    const copyId = result.projects[0].id
    created.push(copyId)

    const tasks = await prisma.task.findMany({ where: { project_id: copyId }, orderBy: { seq: 'asc' }, include: { status: true, tags: { include: { tag: true } }, checklist: true, comments: true, parent: true } })
    expect(tasks.map((t) => `${t.seq}:${t.key}`)).toEqual(['1:EPIC-1', '2:BUG-1', '3:BUG-2'])
    const copy = tasks[2]
    expect(copy.status.name).toBe(status.name)
    expect(copy.assignee_id).toBe(mate.id)
    expect(copy.priority).toBe('high')
    expect(copy.due_date?.toISOString()).toBe('2026-12-01T12:00:00.000Z')
    expect(copy.parent?.seq).toBe(1)
    expect(copy.tags.map((t) => t.tag.name)).toEqual(['cliente'])
    expect(copy.checklist).toMatchObject([{ text: 'reproduzir', done: true }])
    expect(copy.comments).toMatchObject([{ author_id: mate.id, body: 'achei a causa' }])

    // Próximas tasks seguem a numeração do backup.
    const next = await createTask(copyId, owner.id, { title: 'Bug 3', statusId: copy.status_id, taskTypeId: copy.task_type_id! })
    expect([next.seq, next.key]).toEqual([4, 'BUG-3'])

    const members = await prisma.projectMember.findMany({ where: { project_id: copyId } })
    expect(members.map((m) => `${m.user_id === owner.id ? 'importador' : 'colega'}:${m.role}`).sort()).toEqual(['colega:member', 'importador:owner'])
  })

  it('importa o export do ClickUp: projeto por lista, subpasta vira um projeto com listas, quem não existe fica de fora', async () => {
    const clickup = {
      source: 'ClickUp',
      members: [
        { id: 1, name: 'Colega', email: mate.email },
        { id: 2, name: 'Fulano Externo', email: 'fulano@nao-existe.test' },
      ],
      spaces: [{
        id: 's', name: 'Espaço',
        folders: [{
          id: 'f', name: 'Pasta',
          lists: [{ id: 'L1', name: `Produto ${Date.now()}` }],
          subfolders: [{ id: 'sf', name: `Cliente ${Date.now()}`, lists: [{ id: 'L2', name: 'Sprint 1' }, { id: 'L3', name: 'Sprint 2' }] }],
        }],
      }],
      tasks: [
        { id: 'a1', name: 'ID 1 - [BUG] erro', status: 'concluído', priority: 'urgent', assignees: [{ id: 1 }], tags: ['bug'], due_date: '2026-07-03T07:00:00Z', date_closed: '2026-07-02T12:00:00Z', list_id: 'L1' },
        { id: 'a2', name: 'Nova tela [FEATURE]', status: 'qa', priority: null, assignees: [{ id: 2, name: 'Fulano Externo' }], tags: [], list_id: 'L1' },
        { id: 'b1', name: 'Levantamento', status: 'backlog', priority: 'normal', assignees: [], tags: [], list_id: 'L2' },
        { id: 'b2', name: 'Go live', status: 'to do', priority: 'low', assignees: [], tags: [], list_id: 'L3' },
      ],
    }

    const preview = await previewImport(owner, clickup)
    expect(preview.projects).toHaveLength(2)
    expect(preview.peopleMissing).toContain('Fulano Externo (fulano@nao-existe.test)')

    const result = await runImport(owner, clickup)
    created.push(...result.projects.map((p) => p.id))

    const product = await prisma.project.findUniqueOrThrow({ where: { id: result.projects[0].id }, include: { tasks: { include: { status: true }, orderBy: { seq: 'asc' } }, statuses: { orderBy: { position: 'asc' } } } })
    expect(product.tasks.map((t) => `${t.key}:${t.status.name}:${t.priority}`)).toEqual(['BUG-1:Concluído:critical', 'FEAT-1:Qa:none'])
    expect(product.tasks[0].assignee_id).toBe(mate.id)
    expect(product.tasks[1].description).toContain('Fulano Externo')
    expect(product.statuses.map((s) => s.category)).toEqual(['open', 'in_progress', 'in_review', 'done'])

    const client = await prisma.project.findUniqueOrThrow({ where: { id: result.projects[1].id }, include: { lists: { orderBy: { position: 'asc' } }, tasks: { include: { list: true } } } })
    expect(client.lists.map((l) => l.name)).toEqual(['Sprint 1', 'Sprint 2'])
    expect(client.tasks.map((t) => t.list?.name).sort()).toEqual(['Sprint 1', 'Sprint 2'])
  })

  describe('autor dos comentários no import', () => {
    const forged = { body: 'Aprovado, pode seguir', createdAt: '2026-01-10T12:00:00.000Z' }

    async function exported() {
      const project = await createProject(owner.id, { name: `Autoria ${Date.now()}`, privacy: 'organization' })
      created.push(project.id)
      const status = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: project.id, category: 'open' } })
      const task = await createTask(project.id, owner.id, { title: 'T', statusId: status.id })
      await prisma.taskComment.create({ data: { task_id: task.id, author_id: mate.id, body: 'comentário real' } })
      return JSON.parse(JSON.stringify(await exportProject(project.id)))
    }
    async function importedComments(backup: unknown, importer = owner) {
      const result = await runImport(importer, backup)
      created.push(result.projects[0].id)
      return prisma.taskComment.findMany({ where: { task: { project_id: result.projects[0].id } }, orderBy: { created_at: 'asc' } })
    }

    it('comentário inserido no arquivo não ganha autor real: fica com o importador e o e-mail no texto', async () => {
      const backup = await exported()
      backup.tasks[0].comments.push({ authorEmail: mate.email, ...forged })
      const comments = await importedComments(backup)
      expect(comments.every((c) => c.author_id === owner.id)).toBe(true)
      expect(comments.map((c) => c.body)).toContain(`[${mate.email}] Aprovado, pode seguir`)
    })

    it('trocar o autor ou o texto de um comentário assinado invalida a assinatura', async () => {
      const swapped = await exported()
      swapped.tasks[0].comments[0].authorEmail = owner.email
      swapped.tasks[0].comments[0].body = 'texto trocado'
      const reworded = await exported()
      reworded.tasks[0].comments[0].body = 'texto trocado'
      expect((await importedComments(reworded))[0]).toMatchObject({ author_id: owner.id, body: `[${mate.email}] texto trocado` })
      expect((await importedComments(swapped))[0].author_id).toBe(owner.id)
    })

    it('backup sem assinatura, como os antigos: importa, com o autor no texto', async () => {
      const backup = await exported()
      delete backup.commentsSignature
      expect((await importedComments(backup))[0]).toMatchObject({ author_id: owner.id, body: `[${mate.email}] comentário real` })
    })

    it('o comentário do próprio importador mantém o autor mesmo sem assinatura', async () => {
      const backup = await exported()
      delete backup.commentsSignature
      backup.tasks[0].comments = [{ authorEmail: owner.email, ...forged }]
      expect((await importedComments(backup))[0]).toMatchObject({ author_id: owner.id, body: forged.body })
    })

    it('editar o resto do arquivo mantém a autoria assinada', async () => {
      const backup = await exported()
      backup.project.name = 'Renomeado no arquivo'
      expect((await importedComments(backup))[0]).toMatchObject({ author_id: mate.id, body: 'comentário real' })
    })
  })

  it('recusa arquivo que não é backup nem export do ClickUp', async () => {
    await expect(previewImport(owner, { hello: 'world' })).rejects.toThrow(/não reconhecido/)
    await expect(previewImport(owner, { format: 'isa.project-backup', version: 1 })).rejects.toThrow(/Backup inválido/)
  })
})
