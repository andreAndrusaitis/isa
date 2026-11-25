import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { requireProjectRole } from '../middlewares/projectAuthorize'
import * as projectsController from '../controllers/projects'
import * as collab from '../controllers/projectCollab'
import * as apiKeys from '../controllers/projectApiKeys'
import { camelizeResponses } from '../utils/serialize'
import { z } from 'zod'
import * as ticketTaskLink from '../services/ticketTaskLink'
import * as projectInsights from '../services/projectInsights'
import * as taskTime from '../services/taskTime'
import * as projectDrill from '../services/projectDrill'
import { getTaskTimeline } from '../services/taskActivity'
import { scopeParamsToProject } from '../middlewares/projectScope'
import * as projectBackup from '../services/projectBackup'
import prisma from '../config/prisma'
import * as globalSprints from '../services/globalSprints'
import * as navFolders from '../services/projectNavFolders'
import { createSprintSchema, updateSprintSchema } from '../services/sprints'

const router = Router()
scopeParamsToProject(router) // ids na URL têm de ser do :projectId (IDOR entre projetos)

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)

/**
 * Converte todo corpo de resposta deste router para camelCase (ver
 * utils/serialize). Aplicado como middleware e não controller a controller
 * para que nenhuma rota nova esqueça a conversão e volte a servir snake_case
 * para um frontend que espera camelCase.
 */
router.use(camelizeResponses)

const ANY_MEMBER = ['owner', 'manager', 'member', 'viewer'] as const
const CAN_EDIT = ['owner', 'manager', 'member'] as const
const CAN_CONFIGURE = ['owner', 'manager'] as const


router.get('/access', projectsController.checkAccess)

router.get('/', projectsController.list)
router.post('/', projectsController.create)

// Rotas literais ANTES de /:projectId — registradas depois, o Express casaria
// :projectId="me" e elas nunca seriam alcançadas.
// Minha Área, favoritos e filtros são por usuário: filtram pelo próprio req.user,
// sem requireProjectRole.
// Backup: importar (backup do ISA ou export do ClickUp). Quem usa o módulo
// pode importar; vira dono dos projetos criados.
async function importerOf(req: any) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { id: true, email: true } })
  return me
}
router.post('/import/preview', async (req, res, next) => {
  try { res.json({ data: await projectBackup.previewImport(await importerOf(req), req.body) }) } catch (err) { next(err) }
})
router.post('/import', async (req, res, next) => {
  try { res.status(201).json({ data: await projectBackup.runImport(await importerOf(req), req.body) }) } catch (err) { next(err) }
})

router.get('/me/area', collab.myArea)
router.get('/me/favorites', collab.listFavorites)
router.post('/me/favorites', collab.toggleFavorite)
router.get('/me/filters', collab.listSavedFilters)
router.post('/me/filters', collab.createSavedFilter)
router.delete('/me/filters/:filterId', collab.deleteSavedFilter)

// Webhooks e chaves de API: Gerente pelo cargo; os demais só com a liberação
// "Integrações de Projetos" na ficha (o dono de cada um continua valendo no controller).
const integrations = requireCap('projects.integrations')

router.get('/webhook-events', integrations, collab.listWebhookEvents)
router.get('/webhook-events/:event/example', integrations, collab.getWebhookEventExample)
router.get('/webhook-events/:event/schema', integrations, collab.getWebhookEventSchema)

// Webhooks do módulo — independentes de projeto: cada um seleciona a lista
// de projetos aos quais se aplica (vazio = global, todos os projetos).
router.get('/webhooks', integrations, collab.listWebhooks)
router.post('/webhooks', integrations, collab.createWebhook)
router.patch('/webhooks/:webhookId', integrations, collab.updateWebhook)
router.delete('/webhooks/:webhookId', integrations, collab.deleteWebhook)
router.get('/webhooks/:webhookId/deliveries', integrations, collab.listDeliveries)
router.post('/webhooks/:webhookId/deliveries/:deliveryId/resend', integrations, collab.resendDelivery)
router.post('/webhooks/:webhookId/test', integrations, collab.testWebhook)
router.post('/webhooks/:webhookId/regenerate-secret', integrations, collab.regenerateWebhookSecret)

// Chaves da API pública de Projetos — mesma regra de dono dos webhooks.
router.get('/api-scopes', integrations, apiKeys.listScopes)
router.get('/api-keys', integrations, apiKeys.list)
router.post('/api-keys', integrations, apiKeys.create)
router.patch('/api-keys/:keyId', integrations, apiKeys.update)
router.delete('/api-keys/:keyId', integrations, apiKeys.remove)
router.post('/api-keys/:keyId/regenerate', integrations, apiKeys.regenerate)
router.get('/api-keys/:keyId/requests', integrations, apiKeys.listRequests)

// Sprints globais: calendário por Gerente, replicado nos projetos que o seguem.
// Ler: o próprio, os dos Gerentes acima e os seguidos por projetos visíveis; mexer: dono do calendário ou admin (no service).
router.get('/global-sprints/owners', async (req, res, next) => {
  try { res.json({ data: await globalSprints.listOwners(req.user!.sub) }) } catch (err) { next(err) }
})
router.get('/global-sprints', async (req, res, next) => {
  try {
    const ownerId = z.string().uuid().parse(req.query.ownerId)
    res.json({ data: await globalSprints.listGlobalSprints(req.user!.sub, ownerId) })
  } catch (err) { next(err) }
})
router.post('/global-sprints', requireCap('projects.global.manage'), async (req, res, next) => {
  try {
    const { ownerId, ...data } = createSprintSchema.extend({ ownerId: z.string().uuid() }).parse(req.body)
    res.status(201).json({ data: await globalSprints.createGlobalSprint(req.user!, ownerId, data) })
  } catch (err) { next(err) }
})
router.get('/global-sprints/:globalSprintId/overview', async (req, res, next) => {
  try { res.json({ data: await globalSprints.getGlobalSprintOverview(req.user!.sub, req.params.globalSprintId as string) }) } catch (err) { next(err) }
})
router.patch('/global-sprints/:globalSprintId', requireCap('projects.global.manage'), async (req, res, next) => {
  try { res.json({ data: await globalSprints.updateGlobalSprint(req.user!, req.params.globalSprintId as string, updateSprintSchema.parse(req.body)) }) } catch (err) { next(err) }
})
router.delete('/global-sprints/:globalSprintId', requireCap('projects.global.manage'), async (req, res, next) => {
  try { await globalSprints.deleteGlobalSprint(req.user!, req.params.globalSprintId as string); res.status(204).send() } catch (err) { next(err) }
})
router.post('/global-sprints/:globalSprintId/start', requireCap('projects.global.manage'), async (req, res, next) => {
  try { res.json({ data: await globalSprints.startGlobalSprint(req.user!, req.params.globalSprintId as string) }) } catch (err) { next(err) }
})
router.post('/global-sprints/:globalSprintId/complete', requireCap('projects.global.manage'), async (req, res, next) => {
  try { res.json({ data: await globalSprints.completeGlobalSprint(req.user!, req.params.globalSprintId as string) }) } catch (err) { next(err) }
})

// Pastas compartilhadas da sidebar: todos leem (podadas ao que enxergam); Gerente/admin organizam.
router.get('/nav-folders', async (req, res, next) => {
  try { res.json({ data: await navFolders.listNavFolders(req.user!.sub, ['manager', 'admin'].includes(req.user!.role)) }) } catch (err) { next(err) }
})
router.post('/nav-folders', requireCap('projects.global.manage'), async (req, res, next) => {
  try { res.status(201).json({ data: await navFolders.createNavFolder(navFolders.navFolderSchema.parse(req.body)) }) } catch (err) { next(err) }
})
router.patch('/nav-folders/:navFolderId', requireCap('projects.global.manage'), async (req, res, next) => {
  try { res.json({ data: await navFolders.updateNavFolder(req.params.navFolderId as string, navFolders.updateNavFolderSchema.parse(req.body)) }) } catch (err) { next(err) }
})
router.delete('/nav-folders/:navFolderId', requireCap('projects.global.manage'), async (req, res, next) => {
  try { await navFolders.deleteNavFolder(req.params.navFolderId as string); res.status(204).send() } catch (err) { next(err) }
})
// Mover exige enxergar o projeto: antes bastava o id para tirar da pasta projeto de outro Gerente.
router.put('/:projectId/nav-folder', requireCap('projects.global.manage'), requireProjectRole('owner', 'manager', 'member', 'viewer'), async (req, res, next) => {
  try {
    await navFolders.moveProjectToNavFolder(req.params.projectId as string, navFolders.moveProjectSchema.parse(req.body).folderId)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.get('/:projectId', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.getById)
router.patch('/:projectId', requireProjectRole('owner'), projectsController.update)
router.delete('/:projectId', requireProjectRole('owner'), projectsController.archive)

router.get('/:projectId/members', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listMembers)
router.post('/:projectId/members', requireProjectRole('owner', 'manager'), projectsController.addMember)
router.patch('/:projectId/members/:userId', requireProjectRole('owner'), projectsController.updateMember)
router.delete('/:projectId/members/:userId', requireProjectRole('owner', 'manager'), projectsController.removeMember)

router.get('/:projectId/folders', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listFolders)
router.post('/:projectId/folders', requireProjectRole('owner', 'manager'), projectsController.createFolder)

router.get('/:projectId/lists', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listLists)
router.post('/:projectId/lists', requireProjectRole('owner', 'manager'), projectsController.createList)

router.get('/:projectId/statuses', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listStatuses)
router.post('/:projectId/statuses', requireProjectRole('owner', 'manager'), projectsController.createStatus)
router.patch('/:projectId/statuses/reorder', requireProjectRole('owner', 'manager'), projectsController.reorderStatuses)
router.patch('/:projectId/statuses/:statusId', requireProjectRole('owner', 'manager'), projectsController.updateStatus)
router.delete('/:projectId/statuses/:statusId', requireProjectRole('owner', 'manager'), projectsController.deleteStatus)

router.get('/:projectId/export', requireProjectRole(...CAN_CONFIGURE), async (req, res, next) => {
  try {
    const backup = await projectBackup.exportProject(req.params.projectId as string)
    res.setHeader('Content-Disposition', `attachment; filename="projeto-${req.params.projectId}.json"`)
    res.json({ data: backup })
  } catch (err) { next(err) }
})
router.get('/:projectId/task-types', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listTaskTypes)
router.post('/:projectId/task-types', requireProjectRole('owner', 'manager'), projectsController.createTaskType)
router.patch('/:projectId/task-types/:taskTypeId', requireProjectRole('owner', 'manager'), projectsController.updateTaskType)
router.delete('/:projectId/task-types/:taskTypeId', requireProjectRole('owner', 'manager'), projectsController.deleteTaskType)

router.get('/:projectId/sprints', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listSprints)
router.post('/:projectId/sprints', requireProjectRole('owner', 'manager'), projectsController.createSprint)
router.patch('/:projectId/sprints/:sprintId', requireProjectRole('owner', 'manager'), projectsController.updateSprint)
router.delete('/:projectId/sprints/:sprintId', requireProjectRole('owner', 'manager'), projectsController.deleteSprint)
router.post('/:projectId/sprints/:sprintId/start', requireProjectRole('owner', 'manager'), projectsController.startSprint)
router.post('/:projectId/sprints/:sprintId/complete', requireProjectRole('owner', 'manager'), projectsController.completeSprint)

router.get('/:projectId/tasks', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listTasks)
router.post('/:projectId/tasks', requireProjectRole('owner', 'manager', 'member'), projectsController.createTask)
// Ponte chamado ↔ task (ID 1.1): cria a task a partir do chamado e já vincula.
router.post('/:projectId/tasks/from-ticket', requireProjectRole(...CAN_EDIT), async (req, res, next) => {
  try {
    const input = ticketTaskLink.createTaskFromTicketSchema.parse(req.body ?? {})
    res.status(201).json({ data: await ticketTaskLink.createTaskFromTicket(req.params.projectId as string, req.user!, input) })
  } catch (err) { next(err) }
})
router.get('/:projectId/tasks/:taskId', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.getTask)
router.patch('/:projectId/tasks/:taskId', requireProjectRole('owner', 'manager', 'member'), projectsController.updateTaskHandler)
router.delete('/:projectId/tasks/:taskId', requireProjectRole('owner', 'manager'), projectsController.archiveTask)

router.post('/:projectId/tasks/:taskId/checklist', requireProjectRole('owner', 'manager', 'member'), projectsController.createChecklistItem)
router.patch('/:projectId/tasks/:taskId/checklist/:itemId', requireProjectRole('owner', 'manager', 'member'), projectsController.toggleChecklistItem)
router.delete('/:projectId/tasks/:taskId/checklist/:itemId', requireProjectRole('owner', 'manager', 'member'), projectsController.deleteChecklistItem)

router.get('/:projectId/tasks/:taskId/comments', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listComments)
router.post('/:projectId/tasks/:taskId/comments', requireProjectRole('owner', 'manager', 'member'), projectsController.createComment)
router.patch('/:projectId/tasks/:taskId/comments/:commentId', requireProjectRole(...CAN_EDIT), projectsController.editComment)
router.delete('/:projectId/tasks/:taskId/comments/:commentId', requireProjectRole(...CAN_EDIT), projectsController.deleteComment)

router.get('/:projectId/tasks/:taskId/assignees', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listTaskAssignees)
router.put('/:projectId/tasks/:taskId/assignees', requireProjectRole('owner', 'manager', 'member'), projectsController.setTaskAssignees)

router.get('/:projectId/tasks/:taskId/dependencies', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listTaskDependencies)
router.post('/:projectId/tasks/:taskId/dependencies', requireProjectRole('owner', 'manager', 'member'), projectsController.createTaskDependency)
router.delete('/:projectId/tasks/:taskId/dependencies/:dependencyId', requireProjectRole('owner', 'manager', 'member'), projectsController.removeTaskDependency)

router.get('/:projectId/custom-fields', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listCustomFields)
router.post('/:projectId/custom-fields', requireProjectRole('owner', 'manager'), projectsController.createCustomField)
router.put('/:projectId/tasks/:taskId/custom-fields/:customFieldId', requireProjectRole('owner', 'manager', 'member'), projectsController.setCustomFieldValue)

router.get('/:projectId/tags', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listTags)
router.post('/:projectId/tags', requireProjectRole('owner', 'manager'), projectsController.createTag)
router.delete('/:projectId/tags/:tagId', requireProjectRole('owner', 'manager'), projectsController.deleteTag)
router.post('/:projectId/tasks/:taskId/tags/:tagId', requireProjectRole('owner', 'manager', 'member'), projectsController.addTagToTask)
router.delete('/:projectId/tasks/:taskId/tags/:tagId', requireProjectRole('owner', 'manager', 'member'), projectsController.removeTagFromTask)

router.post('/:projectId/tasks/:taskId/documents/:documentId', requireProjectRole('owner', 'manager', 'member'), projectsController.linkTaskDocument)
router.delete('/:projectId/tasks/:taskId/documents/:documentId', requireProjectRole('owner', 'manager', 'member'), projectsController.unlinkTaskDocument)

router.post('/:projectId/tasks/:taskId/approvals', requireProjectRole('owner', 'manager', 'member'), projectsController.requestTaskApproval)
router.patch('/:projectId/tasks/:taskId/approvals/:approvalId', requireProjectRole('owner', 'manager', 'member'), projectsController.decideTaskApproval)

router.get('/:projectId/automations', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listAutomations)
router.post('/:projectId/automations', requireProjectRole('owner', 'manager'), projectsController.createAutomation)
router.patch('/:projectId/automations/:automationId', requireProjectRole('owner', 'manager'), projectsController.updateAutomation)
router.get('/:projectId/automations/:automationId/runs', requireProjectRole('owner', 'manager', 'member', 'viewer'), projectsController.listAutomationRuns)

// --- Colaboração ---------------------------------------------------------

// Dashboards do projeto
router.get('/:projectId/dashboard', requireProjectRole(...ANY_MEMBER), collab.projectDashboard)
router.get('/:projectId/workload', requireProjectRole(...ANY_MEMBER), collab.projectWorkload)
router.get('/:projectId/timeline', requireProjectRole(...ANY_MEMBER), collab.projectTimeline)

// Views personalizadas
router.get('/:projectId/views', requireProjectRole(...ANY_MEMBER), collab.listCustomViews)
router.post('/:projectId/views', requireProjectRole(...CAN_EDIT), collab.createCustomView)
router.delete('/:projectId/views/:viewId', requireProjectRole(...CAN_CONFIGURE), collab.deleteCustomView)

// Bulk actions
router.post('/:projectId/tasks/bulk', requireProjectRole(...CAN_EDIT), collab.bulkAction)

// Watchers
// Tempo por task: conta em andamento/revisão, pausa em backlog/a fazer, para ao concluir.
router.get('/:projectId/insights', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await projectInsights.getInsights([req.params.projectId as string]) }) } catch (err) { next(err) }
})
router.get('/:projectId/time', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await taskTime.getProjectTime(req.params.projectId as string) }) } catch (err) { next(err) }
})
// Modais de detalhe dos painéis e histórico da task (leitura para quem vê o projeto).
router.get('/:projectId/drill', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await projectDrill.getProjectDrill(req.params.projectId as string) }) } catch (err) { next(err) }
})
router.get('/:projectId/tasks/:taskId/drill', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await projectDrill.getTaskDrill(req.params.projectId as string, req.params.taskId as string, req.user!) }) } catch (err) { next(err) }
})
router.get('/:projectId/tasks/:taskId/activity', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await getTaskTimeline(req.params.projectId as string, req.params.taskId as string) }) } catch (err) { next(err) }
})
router.get('/:projectId/tasks/:taskId/time', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await taskTime.getTaskTime(req.params.projectId as string, req.params.taskId as string) }) } catch (err) { next(err) }
})

// Ponte chamado ↔ task: chamado vinculado sai do SLA e segue o prazo da task.
router.get('/:projectId/tasks/:taskId/tickets', requireProjectRole(...ANY_MEMBER), async (req, res, next) => {
  try { res.json({ data: await ticketTaskLink.listTaskTickets(req.params.projectId as string, req.params.taskId as string, req.user!) }) } catch (err) { next(err) }
})
router.post('/:projectId/tasks/:taskId/tickets', requireProjectRole(...CAN_EDIT), async (req, res, next) => {
  try {
    const { ticket } = z.object({ ticket: z.string().trim().min(1) }).parse(req.body ?? {})
    await ticketTaskLink.linkTicketToTask(req.params.projectId as string, req.params.taskId as string, ticket, req.user!)
    res.status(201).json({ data: await ticketTaskLink.listTaskTickets(req.params.projectId as string, req.params.taskId as string, req.user!) })
  } catch (err) { next(err) }
})
// Vários chamados de uma vez (ID 1.2): lote não atômico, devolve quem falhou.
router.post('/:projectId/tasks/:taskId/tickets/bulk', requireProjectRole(...CAN_EDIT), async (req, res, next) => {
  try {
    const { tickets } = z.object({ tickets: z.array(z.string().trim().min(1)).min(1, 'Informe ao menos um chamado').max(ticketTaskLink.MAX_BULK_LINK, `No máximo ${ticketTaskLink.MAX_BULK_LINK} chamados por vez`) }).parse(req.body ?? {})
    const result = await ticketTaskLink.linkTicketsBulk(req.params.projectId as string, req.params.taskId as string, tickets, req.user!)
    res.json({ data: { ...result, tickets: await ticketTaskLink.listTaskTickets(req.params.projectId as string, req.params.taskId as string, req.user!) } })
  } catch (err) { next(err) }
})
router.delete('/:projectId/tasks/:taskId/tickets/:ticketId', requireProjectRole(...CAN_EDIT), async (req, res, next) => {
  try {
    await ticketTaskLink.unlinkTicketFromTask(req.params.projectId as string, req.params.taskId as string, req.params.ticketId as string, req.user!)
    res.status(204).end()
  } catch (err) { next(err) }
})
router.get('/:projectId/tasks/:taskId/watchers', requireProjectRole(...ANY_MEMBER), collab.listWatchers)
router.post('/:projectId/tasks/:taskId/watchers', requireProjectRole(...ANY_MEMBER), collab.addWatcher)
router.delete('/:projectId/tasks/:taskId/watchers/:userId', requireProjectRole(...ANY_MEMBER), collab.removeWatcher)

// Relações entre tasks
router.get('/:projectId/tasks/:taskId/relations', requireProjectRole(...ANY_MEMBER), collab.listRelations)
router.post('/:projectId/tasks/:taskId/relations', requireProjectRole(...CAN_EDIT), collab.createRelation)
router.delete('/:projectId/tasks/:taskId/relations/:relationId', requireProjectRole(...CAN_EDIT), collab.removeRelation)

// Conclusão validada
router.get('/:projectId/tasks/:taskId/completion-check', requireProjectRole(...ANY_MEMBER), collab.getCompletionBlockers)
router.post('/:projectId/tasks/:taskId/complete', requireProjectRole(...CAN_EDIT), collab.completeTask)

export default router
