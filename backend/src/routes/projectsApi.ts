import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { extractToken } from '../middlewares/apiKeyAuth'
import { apiKeyRateLimit } from '../middlewares/rateLimiter'
import { scopeParamsToProject, assertRefsInProject } from '../middlewares/projectScope'
import { camelize, snakeizeResponses } from '../utils/serialize'
import { runIdempotent } from '../services/externalApi'
import { authenticateProjectApiToken, keyProjectsWhere, assertKeyProject, keyRoleIn, ProjectApiKeyContext, ProjectApiScope } from '../services/projectApiKeys'
import { loadFullTask, loadFullTasks } from '../services/taskFull'
import { getEffectiveModules } from '../services/moduleAccess'
import * as projectsService from '../services/projects'
import * as structureService from '../services/projectStructure'
import * as taskTypesService from '../services/taskTypes'
import * as sprintsService from '../services/sprints'
import * as tasksService from '../services/tasks'
import * as completionService from '../services/taskCompletion'
import * as checklistService from '../services/taskChecklist'
import * as commentsService from '../services/taskComments'
import * as assigneesService from '../services/taskAssignees'
import * as dependenciesService from '../services/taskDependencies'
import * as customFieldsService from '../services/customFields'
import * as tagsService from '../services/tags'
import * as documentsService from '../services/documents'
import * as attachmentsService from '../services/projectAttachments'
import * as dashboardService from '../services/projectDashboard'
import * as taskTime from '../services/taskTime'
import * as ticketTaskLink from '../services/ticketTaskLink'

declare module 'express-serve-static-core' {
  interface Request {
    projectApiKey?: ProjectApiKeyContext
  }
}

/**
 * API pública de Projetos — montada em /api/integrations/v1/projects, ANTES do
 * router da API de chamados (que exige a chave isakey_ em tudo abaixo de /v1).
 *
 * Contrato igual ao da API de chamados: snake_case na entrada e na saída,
 * `{ data, pagination }` nas listas, escritas idempotentes por
 * `external_request_id` e registradas no log da chave. Por dentro reusa os
 * mesmos serviços das telas (histórico, notificações, webhooks e automações
 * saem iguais), agindo como o usuário de serviço da chave. O poder da chave em
 * cada projeto é o de quem a criou: dono/gerente (ou admin) → gerente, sem
 * mexer em donos nem arquivar projeto; membro → membro (tasks, comentários,
 * docs, anexos e chamados, sem configurar o projeto).
 */
const router = Router()

router.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req)
    if (!token) throw new AppError(401, 'Informe a API key no header Authorization', 'API_KEY_MISSING')
    req.projectApiKey = await authenticateProjectApiToken(token)
    next()
  } catch (err) { next(err) }
}, apiKeyRateLimit, snakeizeResponses)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.param('projectId', async (req, _res, next, value) => {
  try { await assertKeyProject(req.projectApiKey!, String(value)); next() } catch (err) { next(err) }
})

// A task pode ser chamada pelo uuid, pelo ID do tipo (BUG-12) ou pelo número (#142 / 142).
router.param('taskId', async (req, _res, next, value) => {
  try {
    const ref = decodeURIComponent(String(value))
    const where = UUID.test(ref) ? { id: ref } : /^#?\d+$/.test(ref) ? { seq: Number(ref.replace('#', '')) } : { key: ref.toUpperCase() }
    const task = await prisma.task.findFirst({ where: { project_id: req.params.projectId as string, ...where }, select: { id: true } })
    if (!task) throw new AppError(404, 'Task não encontrada neste projeto', 'NOT_FOUND')
    req.params.taskId = task.id
    next()
  } catch (err) { next(err) }
})
scopeParamsToProject(router, { skip: ['taskId'] })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Ctx {
  key: ProjectApiKeyContext
  /** Usuário de serviço da chave: assina tudo o que a API faz. */
  actor: string
  projectId: string
  taskId: string
  params: Record<string, string>
  query: Record<string, unknown>
  /** Corpo já em camelCase, pronto para os schemas dos serviços. */
  input: any
}

function ctxOf(req: Request): Ctx {
  return {
    key: req.projectApiKey!,
    actor: req.projectApiKey!.serviceUserId,
    projectId: req.params.projectId as string,
    taskId: req.params.taskId as string,
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    input: camelize(req.body ?? {}),
  }
}

function need(scope: ProjectApiScope): RequestHandler {
  return (req, _res, next) => {
    if (!req.projectApiKey!.scopes.includes(scope)) {
      return next(new AppError(403, `Esta API key não tem o escopo "${scope}" exigido por este endpoint. Edite a chave em Projetos → API.`, 'API_KEY_SCOPE_DENIED'))
    }
    next()
  }
}

/** Ação que a tela só libera para dono/gerente: a chave precisa ter esse poder neste projeto. */
function asManager(c: Ctx) {
  if (keyRoleIn(c.key, c.projectId) !== 'manager') {
    throw new AppError(403, 'Esta chave age como membro neste projeto (é o papel de quem a criou) e esta ação é só de dono/gerente.', 'API_KEY_ROLE_DENIED')
  }
}

function read(scope: ProjectApiScope, fn: (c: Ctx) => Promise<unknown>): RequestHandler[] {
  return [need(scope), async (req, res, next) => {
    try {
      const out = await fn(ctxOf(req))
      res.json(out && typeof out === 'object' && 'pagination' in out ? out : { data: out })
    } catch (err) { next(err) }
  }]
}

/** Escrita: idempotente por external_request_id e registrada no log da chave. */
function write(scope: ProjectApiScope, resourceType: string, fn: (c: Ctx) => Promise<unknown>, statusCode = 200): RequestHandler[] {
  return [need(scope), async (req, res, next) => {
    try {
      const c = ctxOf(req)
      const result = await runIdempotent(
        { project_api_key_id: c.key.id }, req.method, req.originalUrl.replace(/^\/api\/integrations\/v1/, '').split('?')[0], req.body ?? {}, { ip: req.ip },
        async () => {
          const data = await fn(c)
          const resourceId = (data as { id?: string } | null)?.id ?? c.params.taskId ?? c.projectId ?? ''
          return { statusCode, resourceType, resourceId, body: { duplicate: false, resource_type: resourceType, resource_id: resourceId, data: data ?? null } }
        },
      )
      res.status(result.statusCode).json(result.body)
    } catch (err) { next(err) }
  }]
}

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
})

function paginated<T>(rows: T[], total: number, page: number, perPage: number) {
  return { data: rows, pagination: { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) } }
}

/** Usuário real e ativo do módulo, por id ou e-mail (nunca outro usuário de serviço). */
async function resolveUser(ref: { userId?: string; email?: string }) {
  if (!ref.userId && !ref.email) throw new AppError(400, 'Informe user_id ou email', 'VALIDATION_ERROR')
  const user = await prisma.user.findFirst({
    where: {
      ...(ref.userId ? { id: ref.userId } : { email: { equals: ref.email, mode: 'insensitive' as const } }),
      active: true, deleted_at: null, is_service_account: false,
    },
    select: { id: true, role: true },
  })
  if (!user) throw new AppError(404, 'Usuário não encontrado', 'USER_NOT_FOUND')
  return user
}

const userRef = z.object({ userId: z.string().uuid().optional(), email: z.string().email().optional() })

// ---------------------------------------------------------------------------
// Projetos
// ---------------------------------------------------------------------------

router.get('/', ...read('read_projects', async (c) => {
  const { page, per_page } = pageQuery.parse(c.query)
  const where = keyProjectsWhere(c.key)
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * per_page, take: per_page }),
  ])
  return paginated(rows, total, page, per_page)
}))

router.post('/', ...write('write_projects', 'project', async (c) => {
  // Projeto novo nasce fora de qualquer lista: só chave de alcance total cria.
  if (c.key.projectIds) throw new AppError(403, 'Só chaves com acesso a todos os projetos podem criar projetos.', 'API_KEY_PROJECT_CREATE_DENIED')
  const { userId, email, ...rest } = projectsService.createProjectSchema.merge(userRef.extend({ ownerId: z.string().uuid().optional(), ownerEmail: z.string().email().optional() }))
    .parse(c.input) as any
  const owner = await resolveUser({ userId: rest.ownerId ?? userId, email: rest.ownerEmail ?? email })
  if (!(await getEffectiveModules(owner.id, owner.role)).projects) {
    throw new AppError(400, 'O dono informado não tem acesso ao módulo Projetos.', 'USER_WITHOUT_PROJECTS_MODULE')
  }
  return projectsService.createProject(owner.id, projectsService.createProjectSchema.parse(rest))
}, 201))

router.get('/:projectId', ...read('read_projects', (c) => projectsService.getProjectById(c.projectId)))
router.patch('/:projectId', ...write('write_projects', 'project', (c) => {
  asManager(c)
  return projectsService.updateProject(c.projectId, projectsService.updateProjectSchema.parse(c.input), c.actor)
}))

// ---------------------------------------------------------------------------
// Membros — a chave age como gerente: não cria, promove nem remove donos.
// ---------------------------------------------------------------------------

router.get('/:projectId/members', ...read('read_members', (c) => projectsService.listMembers(c.projectId)))

router.post('/:projectId/members', ...write('write_members', 'project_member', async (c) => {
  asManager(c)
  const data = userRef.extend({ role: z.enum(['manager', 'member', 'viewer']).default('member') }).parse(c.input)
  const user = await resolveUser(data)
  return projectsService.addMember(c.projectId, { userId: user.id, role: data.role }, 'manager', c.actor)
}, 201))

async function assertNotOwner(projectId: string, userId: string) {
  const member = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } }, select: { role: true } })
  if (!member) throw new AppError(404, 'Membro não encontrado', 'NOT_FOUND')
  if (member.role === 'owner') throw new AppError(403, 'Donos do projeto só são alterados pela tela, pelo próprio dono.', 'OWNER_ONLY')
}

router.patch('/:projectId/members/:userId', ...write('write_members', 'project_member', async (c) => {
  asManager(c)
  const { role } = z.object({ role: z.enum(['manager', 'member', 'viewer']) }).parse(c.input)
  await assertNotOwner(c.projectId, c.params.userId)
  // 'owner' como papel do ator só para passar a trava interna; a troca para/de dono já foi barrada acima.
  return projectsService.updateMemberRole(c.projectId, c.params.userId, role, 'owner')
}))

router.delete('/:projectId/members/:userId', ...write('write_members', 'project_member', async (c) => {
  asManager(c)
  await assertNotOwner(c.projectId, c.params.userId)
  await projectsService.removeMember(c.projectId, c.params.userId, 'manager', c.actor)
  return { id: c.params.userId }
}))

// ---------------------------------------------------------------------------
// Estrutura: status, listas, pastas, tipos, sprints, tags, campos
// ---------------------------------------------------------------------------

router.get('/:projectId/statuses', ...read('read_structure', (c) => structureService.listStatuses(c.projectId)))
router.post('/:projectId/statuses', ...write('write_structure', 'status', (c) => { asManager(c); return structureService.createStatus(c.projectId, structureService.createStatusSchema.parse(c.input)) }, 201))
router.patch('/:projectId/statuses/:statusId', ...write('write_structure', 'status', (c) => { asManager(c); return structureService.updateStatus(c.projectId, c.params.statusId, structureService.updateStatusSchema.parse(c.input)) }))

router.get('/:projectId/folders', ...read('read_structure', (c) => structureService.listFolders(c.projectId)))
router.post('/:projectId/folders', ...write('write_structure', 'folder', (c) => { asManager(c); return structureService.createFolder(c.projectId, structureService.createFolderSchema.parse(c.input)) }, 201))
router.get('/:projectId/lists', ...read('read_structure', (c) => structureService.listLists(c.projectId)))
router.post('/:projectId/lists', ...write('write_structure', 'list', async (c) => {
  asManager(c)
  const data = structureService.createListSchema.parse(c.input)
  const folderId = (data as { folderId?: string | null }).folderId
  if (folderId && !(await prisma.projectFolder.findFirst({ where: { id: folderId, project_id: c.projectId }, select: { id: true } }))) {
    throw new AppError(400, 'Pasta de outro projeto.', 'CROSS_PROJECT_REFERENCE')
  }
  return structureService.createList(c.projectId, data)
}, 201))

router.get('/:projectId/task-types', ...read('read_structure', (c) => taskTypesService.listTaskTypes(c.projectId)))
router.post('/:projectId/task-types', ...write('write_structure', 'task_type', (c) => { asManager(c); return taskTypesService.createTaskType(c.projectId, taskTypesService.createTaskTypeSchema.parse(c.input)) }, 201))
router.patch('/:projectId/task-types/:taskTypeId', ...write('write_structure', 'task_type', (c) => { asManager(c); return taskTypesService.updateTaskType(c.projectId, c.params.taskTypeId, taskTypesService.updateTaskTypeSchema.parse(c.input)) }))

router.get('/:projectId/sprints', ...read('read_structure', (c) => sprintsService.listSprints(c.projectId)))
router.post('/:projectId/sprints', ...write('write_structure', 'sprint', (c) => { asManager(c); return sprintsService.createSprint(c.projectId, sprintsService.createSprintSchema.parse(c.input)) }, 201))
router.patch('/:projectId/sprints/:sprintId', ...write('write_structure', 'sprint', (c) => { asManager(c); return sprintsService.updateSprint(c.projectId, c.params.sprintId, sprintsService.updateSprintSchema.parse(c.input)) }))
router.post('/:projectId/sprints/:sprintId/start', ...write('write_structure', 'sprint', (c) => { asManager(c); return sprintsService.startSprint(c.projectId, c.params.sprintId) }))
router.post('/:projectId/sprints/:sprintId/complete', ...write('write_structure', 'sprint', (c) => { asManager(c); return sprintsService.completeSprint(c.projectId, c.params.sprintId) }))

router.get('/:projectId/tags', ...read('read_structure', (c) => tagsService.listTags(c.projectId)))
router.post('/:projectId/tags', ...write('write_structure', 'tag', (c) => { asManager(c); return tagsService.createTag(c.projectId, tagsService.createTagSchema.parse(c.input)) }, 201))
router.get('/:projectId/custom-fields', ...read('read_structure', (c) => customFieldsService.listCustomFields(c.projectId)))
router.post('/:projectId/custom-fields', ...write('write_structure', 'custom_field', (c) => { asManager(c); return customFieldsService.createCustomField(c.projectId, customFieldsService.createCustomFieldSchema.parse(c.input)) }, 201))

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const listTasksQuery = pageQuery.extend({
  status_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  sprint_id: z.string().uuid().optional(),
  list_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
  updated_since: z.string().datetime().optional(),
  include_archived: z.enum(['true', 'false']).default('false'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

router.get('/:projectId/tasks', ...read('read_tasks', async (c) => {
  const q = listTasksQuery.parse(c.query)
  const where = {
    project_id: c.projectId,
    ...(q.include_archived === 'true' ? {} : { archived_at: null }),
    ...(q.status_id ? { status_id: q.status_id } : {}),
    ...(q.assignee_id ? { OR: [{ assignee_id: q.assignee_id }, { multi_assignees: { some: { user_id: q.assignee_id } } }] } : {}),
    ...(q.sprint_id ? { sprint_id: q.sprint_id } : {}),
    ...(q.list_id ? { list_id: q.list_id } : {}),
    ...(q.parent_id ? { parent_id: q.parent_id } : {}),
    ...(q.updated_since ? { updated_at: { gte: new Date(q.updated_since) } } : {}),
  }
  const [total, page] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({ where, orderBy: [{ updated_at: q.order }, { id: 'asc' }], skip: (q.page - 1) * q.per_page, take: q.per_page, select: { id: true } }),
  ])
  return paginated(await loadFullTasks(page.map((t) => t.id)), total, q.page, q.per_page)
}))

router.post('/:projectId/tasks', ...write('write_tasks', 'task', async (c) => {
  // Sem status: entra no primeiro status "aberto" do projeto, como o botão + do Board.
  const statusId = c.input.statusId ?? (await prisma.projectStatus.findFirst({ where: { project_id: c.projectId, category: 'open', is_active: true }, orderBy: { position: 'asc' }, select: { id: true } }))?.id
  const task = await tasksService.createTask(c.projectId, c.actor, tasksService.createTaskSchema.parse({ ...c.input, statusId }))
  return loadFullTask(task.id)
}, 201))

router.get('/:projectId/tasks/:taskId', ...read('read_tasks', (c) => loadFullTask(c.taskId)))
router.patch('/:projectId/tasks/:taskId', ...write('write_tasks', 'task', async (c) => {
  await tasksService.updateTask(c.taskId, c.actor, tasksService.updateTaskSchema.parse(c.input))
  return loadFullTask(c.taskId)
}))
router.post('/:projectId/tasks/:taskId/complete', ...write('write_tasks', 'task', (c) =>
  completionService.completeTask(c.taskId, c.actor, completionService.completeTaskSchema.parse(c.input)).then((r) => ({ id: c.taskId, ...r }))))
router.delete('/:projectId/tasks/:taskId', ...write('write_tasks', 'task', (c) => {
  asManager(c) // arquivar task é de dono/gerente, como na tela
  return tasksService.archiveTask(c.taskId, c.actor)
}))

router.get('/:projectId/tasks/:taskId/assignees', ...read('read_tasks', (c) => assigneesService.listAssignees(c.taskId).then((ids) => ({ user_ids: ids }))))
router.put('/:projectId/tasks/:taskId/assignees', ...write('write_tasks', 'task', async (c) => {
  const { userIds } = assigneesService.setAssigneesSchema.parse(c.input)
  return { id: c.taskId, user_ids: await assigneesService.setAssignees(c.taskId, c.actor, userIds) }
}))

router.get('/:projectId/tasks/:taskId/checklist', ...read('read_tasks', (c) => prisma.checklistItem.findMany({ where: { task_id: c.taskId }, orderBy: { position: 'asc' } })))
router.post('/:projectId/tasks/:taskId/checklist', ...write('write_tasks', 'checklist_item', (c) => checklistService.createChecklistItem(c.taskId, checklistService.createChecklistItemSchema.parse(c.input), c.actor), 201))
router.patch('/:projectId/tasks/:taskId/checklist/:itemId', ...write('write_tasks', 'checklist_item', (c) =>
  checklistService.toggleChecklistItem(c.params.itemId, z.object({ done: z.boolean() }).parse(c.input).done, c.actor)))
router.delete('/:projectId/tasks/:taskId/checklist/:itemId', ...write('write_tasks', 'checklist_item', async (c) => {
  await checklistService.deleteChecklistItem(c.params.itemId, c.actor)
  return { id: c.params.itemId }
}))

router.post('/:projectId/tasks/:taskId/tags/:tagId', ...write('write_tasks', 'task', (c) => tagsService.addTagToTask(c.taskId, c.params.tagId, c.actor).then(() => ({ id: c.taskId }))))
router.delete('/:projectId/tasks/:taskId/tags/:tagId', ...write('write_tasks', 'task', (c) => tagsService.removeTagFromTask(c.taskId, c.params.tagId, c.actor).then(() => ({ id: c.taskId }))))
router.put('/:projectId/tasks/:taskId/custom-fields/:customFieldId', ...write('write_tasks', 'task', (c) =>
  customFieldsService.setCustomFieldValue(c.taskId, c.params.customFieldId, customFieldsService.setCustomFieldValueSchema.parse(c.input).value)))

router.get('/:projectId/tasks/:taskId/dependencies', ...read('read_tasks', (c) => dependenciesService.listDependencies(c.taskId)))
router.post('/:projectId/tasks/:taskId/dependencies', ...write('write_tasks', 'task_dependency', async (c) => {
  const { dependsOnId } = z.object({ dependsOnId: z.string().uuid() }).parse(c.input)
  await assertRefsInProject(c.projectId, { parentId: dependsOnId }) // a outra task também tem de ser deste projeto
  return dependenciesService.createDependency(c.taskId, dependsOnId, c.actor)
}, 201))
router.delete('/:projectId/tasks/:taskId/dependencies/:dependencyId', ...write('write_tasks', 'task_dependency', async (c) => {
  await dependenciesService.removeDependency(c.params.dependencyId, c.actor)
  return { id: c.params.dependencyId }
}))

// ---------------------------------------------------------------------------
// Comentários — a chave edita só o que ela mesma escreveu; exclui os de outros só com poder de gerente.
// ---------------------------------------------------------------------------

router.get('/:projectId/tasks/:taskId/comments', ...read('read_comments', (c) => commentsService.listComments(c.taskId)))
router.post('/:projectId/tasks/:taskId/comments', ...write('write_comments', 'comment', (c) =>
  commentsService.createComment(c.taskId, c.actor, commentsService.createCommentSchema.parse(c.input)), 201))
router.patch('/:projectId/tasks/:taskId/comments/:commentId', ...write('write_comments', 'comment', (c) =>
  commentsService.editComment(c.taskId, c.params.commentId, c.actor, commentsService.editCommentSchema.parse(c.input).body)))
router.delete('/:projectId/tasks/:taskId/comments/:commentId', ...write('write_comments', 'comment', async (c) => {
  await commentsService.deleteComment(c.taskId, c.params.commentId, c.actor, keyRoleIn(c.key, c.projectId) === 'manager')
  return { id: c.params.commentId }
}))

// ---------------------------------------------------------------------------
// Documentos e anexos
// ---------------------------------------------------------------------------

router.get('/:projectId/documents', ...read('read_documents', (c) => documentsService.listDocuments(c.projectId)))
router.post('/:projectId/documents', ...write('write_documents', 'document', async (c) => {
  const data = documentsService.createDocumentSchema.parse(c.input)
  if (data.parentId && !(await prisma.document.findFirst({ where: { id: data.parentId, project_id: c.projectId }, select: { id: true } }))) {
    throw new AppError(400, 'Documento-pai de outro projeto.', 'CROSS_PROJECT_REFERENCE')
  }
  return documentsService.createDocument(c.projectId, c.actor, data)
}, 201))
router.get('/:projectId/documents/:documentId', ...read('read_documents', (c) => documentsService.getDocument(c.params.documentId)))
router.patch('/:projectId/documents/:documentId', ...write('write_documents', 'document', (c) =>
  documentsService.updateDocument(c.params.documentId, c.actor, documentsService.updateDocumentSchema.parse(c.input))))
router.post('/:projectId/tasks/:taskId/documents/:documentId', ...write('write_documents', 'task', (c) =>
  documentsService.linkDocumentToTask(c.taskId, c.params.documentId).then(() => ({ id: c.taskId })), 201))
router.delete('/:projectId/tasks/:taskId/documents/:documentId', ...write('write_documents', 'task', (c) =>
  documentsService.unlinkDocumentFromTask(c.taskId, c.params.documentId).then(() => ({ id: c.taskId }))))

router.get('/:projectId/attachments', ...read('read_attachments', (c) => {
  const q = z.object({ type: z.string().optional(), task_id: z.string().uuid().optional() }).parse(c.query)
  return attachmentsService.listAttachments(c.projectId, { type: q.type, taskId: q.task_id } as any)
}))
router.post('/:projectId/attachments', ...write('write_attachments', 'attachment', async (c) => {
  const data = attachmentsService.createAttachmentSchema.parse(c.input)
  // O anexo pendura numa task, comentário ou documento DESTE projeto.
  const owner = data.entityType === 'task'
    ? await prisma.task.findFirst({ where: { id: data.entityId, project_id: c.projectId }, select: { id: true } })
    : data.entityType === 'comment'
      ? await prisma.taskComment.findFirst({ where: { id: data.entityId, deleted_at: null, task: { project_id: c.projectId } }, select: { id: true } })
      : await prisma.document.findFirst({ where: { id: data.entityId, project_id: c.projectId }, select: { id: true } })
  if (!owner) throw new AppError(400, 'entity_id não pertence a este projeto.', 'CROSS_PROJECT_REFERENCE')
  return attachmentsService.createAttachment(c.projectId, c.actor, data)
}, 201))

// ---------------------------------------------------------------------------
// Gestão (leitura) e vínculo com chamados
// ---------------------------------------------------------------------------

router.get('/:projectId/time', ...read('read_time', (c) => taskTime.getProjectTime(c.projectId)))
router.get('/:projectId/tasks/:taskId/time', ...read('read_time', (c) => taskTime.getTaskTime(c.projectId, c.taskId)))
router.get('/:projectId/dashboard', ...read('read_time', (c) => dashboardService.getProjectDashboard(c.projectId)))
router.get('/:projectId/workload', ...read('read_time', (c) => dashboardService.getProjectWorkload(c.projectId)))

const ticketActor = (c: Ctx) => ({ sub: c.actor, role: 'agent' })
router.get('/:projectId/tasks/:taskId/tickets', ...read('read_tickets', (c) => ticketTaskLink.listTaskTickets(c.projectId, c.taskId)))
router.post('/:projectId/tasks/:taskId/tickets', ...write('write_tickets', 'task', async (c) => {
  const { ticket } = z.object({ ticket: z.string().trim().min(1) }).parse(c.input)
  await ticketTaskLink.linkTicketToTask(c.projectId, c.taskId, ticket, ticketActor(c))
  return { id: c.taskId, tickets: await ticketTaskLink.listTaskTickets(c.projectId, c.taskId) }
}, 201))
router.delete('/:projectId/tasks/:taskId/tickets/:ticketId', ...write('write_tickets', 'task', async (c) => {
  await ticketTaskLink.unlinkTicketFromTask(c.projectId, c.taskId, c.params.ticketId, ticketActor(c))
  return { id: c.taskId }
}))

// Rota desconhecida responde aqui: sem isto o pedido cairia no router da API de
// chamados, que recusaria a chave isaproj_ com um 401 confuso.
router.use((_req, _res, next) => next(new AppError(404, 'Endpoint não encontrado na API de Projetos', 'NOT_FOUND')))

export default router
