/**
 * Controllers das funcionalidades de colaboração: watchers, relações, conclusão
 * validada, bulk actions, favoritos, filtros salvos, views, dashboards e
 * webhooks do módulo.
 */
import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import prisma from '../config/prisma'
import { effectiveProjectRole } from '../services/projectAccess'
import { AppError } from '../middlewares/errorHandler'
import * as collab from '../services/taskCollab'
import * as completion from '../services/taskCompletion'
import * as dashboard from '../services/projectDashboard'
import * as projectWebhooks from '../services/projectWebhooks'
import { validateWebhookUrl } from '../services/webhookDelivery'

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

const watcherSchema = z.object({ userId: z.string().uuid().optional() })

/** Seguir e deixar de seguir por conta própria é livre, até para leitor; mexer na lista de outra pessoa é editar a task. */
function assertCanChangeOthersWatch(req: Request) {
  if (!['owner', 'manager', 'member'].includes(req.projectMembership?.role ?? '')) {
    throw new AppError(403, 'Sem permissão nesta ação', 'FORBIDDEN')
  }
}

export async function listWatchers(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await collab.listWatchers(req.params.taskId as string) })
  } catch (err) { next(err) }
}

export async function addWatcher(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = watcherSchema.parse(req.body ?? {})
    const target = userId ?? req.user!.sub

    // Seguir outra pessoa exige que ela seja membro; seguir a si mesmo é livre.
    if (target !== req.user!.sub) {
      assertCanChangeOthersWatch(req)
      const member = await prisma.projectMember.findUnique({
        where: { project_id_user_id: { project_id: req.params.projectId as string, user_id: target } },
      })
      if (!member) throw new AppError(400, 'Usuário não é membro deste projeto', 'NOT_A_MEMBER')
    }

    const watcher = await collab.addWatcher(req.params.taskId as string, target, req.user!.sub)
    res.status(201).json({ data: watcher })
  } catch (err) { next(err) }
}

export async function removeWatcher(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.params.userId !== req.user!.sub) assertCanChangeOthersWatch(req)
    await collab.removeWatcher(req.params.taskId as string, req.params.userId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

// ---------------------------------------------------------------------------
// Relações entre tasks
// ---------------------------------------------------------------------------

export async function listRelations(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await collab.listRelations(req.params.taskId as string) })
  } catch (err) { next(err) }
}

export async function createRelation(req: Request, res: Response, next: NextFunction) {
  try {
    const data = collab.createRelationSchema.parse(req.body)
    const relation = await collab.createRelation(req.params.taskId as string, req.user!.sub, data)
    res.status(201).json({ data: relation })
  } catch (err) { next(err) }
}

export async function removeRelation(req: Request, res: Response, next: NextFunction) {
  try {
    await collab.removeRelation(req.params.relationId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

// ---------------------------------------------------------------------------
// Conclusão e bulk actions
// ---------------------------------------------------------------------------

export async function getCompletionBlockers(req: Request, res: Response, next: NextFunction) {
  try {
    const blockers = await completion.checkCompletionBlockers(req.params.taskId as string)
    res.json({ data: { canComplete: blockers.length === 0, blockers } })
  } catch (err) { next(err) }
}

export async function completeTask(req: Request, res: Response, next: NextFunction) {
  try {
    const data = completion.completeTaskSchema.parse(req.body ?? {})
    const result = await completion.completeTask(req.params.taskId as string, req.user!.sub, data)
    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function bulkAction(req: Request, res: Response, next: NextFunction) {
  try {
    const data = completion.bulkActionSchema.parse(req.body)
    const result = await completion.applyBulkAction(req.params.projectId as string, req.user!.sub, data, req.projectMembership?.role)
    res.json({ data: result })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------------------------
// Favoritos, filtros salvos, views
// ---------------------------------------------------------------------------

const favoriteSchema = z.object({
  entityType: z.enum(['project', 'document']),
  entityId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
})

export async function listFavorites(req: Request, res: Response, next: NextFunction) {
  try {
    const entityType = req.query.entityType as 'project' | 'document' | undefined
    res.json({ data: await collab.listFavorites(req.user!.sub, entityType) })
  } catch (err) { next(err) }
}

export async function toggleFavorite(req: Request, res: Response, next: NextFunction) {
  try {
    const data = favoriteSchema.parse(req.body)

    // Só é possível favoritar o que se pode ver — senão o toggle vira um
    // oráculo de existência de projetos privados.
    const projectId = data.entityType === 'project' ? data.entityId : data.projectId
    if (!projectId) throw new AppError(400, 'projectId é obrigatório para favoritar um documento', 'VALIDATION')

    if (!(await effectiveProjectRole(projectId, req.user!.sub))) throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')

    const result = await collab.toggleFavorite(req.user!.sub, data.entityType, data.entityId, projectId)
    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function listSavedFilters(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await collab.listSavedFilters(req.user!.sub, req.query.projectId as string | undefined) })
  } catch (err) { next(err) }
}

export async function createSavedFilter(req: Request, res: Response, next: NextFunction) {
  try {
    const data = collab.savedFilterSchema.parse(req.body)
    if (data.projectId) {
      if (!(await effectiveProjectRole(data.projectId, req.user!.sub))) throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')
    }
    res.status(201).json({ data: await collab.createSavedFilter(req.user!.sub, data) })
  } catch (err) { next(err) }
}

export async function deleteSavedFilter(req: Request, res: Response, next: NextFunction) {
  try {
    await collab.deleteSavedFilter(req.params.filterId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function listCustomViews(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await collab.listCustomViews(req.params.projectId as string) })
  } catch (err) { next(err) }
}

export async function createCustomView(req: Request, res: Response, next: NextFunction) {
  try {
    const data = collab.customViewSchema.parse(req.body)
    const view = await collab.createCustomView(req.params.projectId as string, req.user!.sub, data)
    res.status(201).json({ data: view })
  } catch (err) { next(err) }
}

export async function deleteCustomView(req: Request, res: Response, next: NextFunction) {
  try {
    await collab.deleteCustomView(req.params.viewId as string, req.params.projectId as string)
    res.status(204).send()
  } catch (err) { next(err) }
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export async function myArea(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await dashboard.getMyArea(req.user!.sub) })
  } catch (err) { next(err) }
}

export async function projectDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await dashboard.getProjectDashboard(req.params.projectId as string) })
  } catch (err) { next(err) }
}

export async function projectWorkload(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await dashboard.getProjectWorkload(req.params.projectId as string) })
  } catch (err) { next(err) }
}

export async function projectTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await dashboard.getProjectTimeline(req.params.projectId as string) })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------------------------
// Webhooks do módulo
// ---------------------------------------------------------------------------

const webhookSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  active: z.boolean().default(true),
  // Vazio/omitido = global (recebe eventos de todos os projetos, presentes e futuros).
  projectIds: z.array(z.string().uuid()).default([]),
})

function assertKnownEvents(events: string[]) {
  const unknown = events.filter((e) => !projectWebhooks.isProjectWebhookEvent(e))
  if (unknown.length > 0) {
    throw new AppError(400, `Evento(s) desconhecido(s): ${unknown.join(', ')}`, 'WEBHOOK_UNKNOWN_EVENT')
  }
}

/** O secret nunca é devolvido em listagens — só no momento da criação. */
function stripSecret<T extends { secret?: string }>(webhook: T) {
  const { secret: _secret, ...rest } = webhook
  return rest
}

export async function listWebhookEvents(_req: Request, res: Response) {
  res.json({
    data: projectWebhooks.PROJECT_WEBHOOK_EVENTS.map((event) => ({
      event,
      ...projectWebhooks.PROJECT_WEBHOOK_EVENT_LABELS[event],
    })),
  })
}

function knownEvent(req: Request) {
  const event = req.params.event as string
  if (!projectWebhooks.isProjectWebhookEvent(event)) throw new AppError(404, 'Evento desconhecido', 'WEBHOOK_EVENT_NOT_FOUND')
  return event
}

/** JSON de exemplo do evento (o corpo exato que o destino recebe). */
export async function getWebhookEventExample(req: Request, res: Response, next: NextFunction) {
  try {
    // Dentro de `payload` (chave opaca do camelizeResponses): as chaves saem como o destino recebe.
    res.json({ data: { payload: projectWebhooks.buildProjectExamplePayload(knownEvent(req)) } })
  } catch (err) { next(err) }
}

/** JSON Schema do evento, pronto para o "Solicitar Esquema JSON do Corpo" do Power Automate. */
export async function getWebhookEventSchema(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: { payload: projectWebhooks.buildProjectEventJsonSchema(knownEvent(req)) } })
  } catch (err) { next(err) }
}

/**
 * Formato de resposta: substitui a lista de relações de junção por uma lista
 * simples de ids de projeto e, quando vierem as entregas, resume a saúde das
 * últimas 50 (indicador do card, como no admin).
 */
function presentWebhook<T extends { projects?: Array<{ project_id: string }>; deliveries?: Array<{ status: string }> }>(webhook: T) {
  const { projects, deliveries, ...rest } = webhook
  return {
    ...rest,
    projectIds: projects?.map((p) => p.project_id) ?? [],
    ...(deliveries ? {
      recentDeliveries: {
        total: deliveries.length,
        success: deliveries.filter((d) => d.status === 'success').length,
        failed: deliveries.filter((d) => d.status === 'failed').length,
        pending: deliveries.filter((d) => d.status === 'pending').length,
      },
    } : {}),
  }
}

const webhookInclude = { projects: { select: { project_id: true } } } as const

// Webhook tem dono: cada um vê e mexe só nos que criou; admin vê todos.
const ownWebhook = (req: Request) => (req.user!.role === 'admin' ? {} : { created_by: req.user!.sub })

/** Global (sem projetos) só admin; demais só para projetos onde o usuário é dono, gerente ou membro (leitor não). */
export async function assertCanTarget(req: Request, projectIds: string[]) {
  if (req.user!.role === 'admin') return
  if (projectIds.length === 0) {
    throw new AppError(403, 'Integração com todos os projetos só o administrador cria. Selecione os projetos.', 'WEBHOOK_GLOBAL_ADMIN_ONLY')
  }
  const managed = await prisma.projectMember.count({ where: { user_id: req.user!.sub, project_id: { in: projectIds }, role: { in: ['owner', 'manager', 'member'] } } })
  if (managed !== new Set(projectIds).size) {
    throw new AppError(403, 'Você só pode ligar webhooks e chaves de API a projetos em que participa como dono, gerente ou membro.', 'WEBHOOK_PROJECT_NOT_MANAGED')
  }
}

export async function listWebhooks(req: Request, res: Response, next: NextFunction) {
  try {
    const webhooks = await prisma.projectWebhook.findMany({
      where: ownWebhook(req),
      orderBy: { created_at: 'desc' },
      // Testes manuais ficam fora da saúde do card: são cliques, não tráfego real.
      include: { ...webhookInclude, deliveries: { where: { event: { not: 'webhook.test' } }, select: { status: true }, orderBy: { created_at: 'desc' }, take: 50 } },
    })
    res.json({ data: webhooks.map((w) => presentWebhook(stripSecret(w))) })
  } catch (err) { next(err) }
}

export async function createWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const data = webhookSchema.parse(req.body)
    assertKnownEvents(data.events)
    await validateWebhookUrl(data.url)
    await assertCanTarget(req, data.projectIds)

    const secret = randomBytes(32).toString('hex')
    const webhook = await prisma.projectWebhook.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        url: data.url,
        secret,
        events: data.events,
        active: data.active,
        created_by: req.user!.sub,
        projects: { create: data.projectIds.map((project_id) => ({ project_id })) },
      },
      include: webhookInclude,
    })

    // Única resposta que carrega o secret — depois disso ele não sai mais.
    res.status(201).json({ data: { ...presentWebhook(stripSecret(webhook)), secret } })
  } catch (err) { next(err) }
}

export async function updateWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const data = webhookSchema.partial().parse(req.body)
    if (data.events) assertKnownEvents(data.events)

    const existing = await prisma.projectWebhook.findFirst({ where: { id: req.params.webhookId as string, ...ownWebhook(req) }, include: webhookInclude })
    if (!existing) throw new AppError(404, 'Webhook não encontrado', 'NOT_FOUND')
    // Sem projectIds no corpo, reconfere os atuais: quem deixou de gerir o projeto não edita mais o webhook dele.
    await assertCanTarget(req, data.projectIds ?? existing.projects.map((p) => p.project_id))
    if (data.url) await validateWebhookUrl(data.url)

    const webhook = await prisma.projectWebhook.update({
      where: { id: req.params.webhookId as string },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.events !== undefined ? { events: data.events } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        // Substitui o conjunto de projetos por completo quando enviado —
        // mais simples e previsível do que calcular diff de add/remove.
        ...(data.projectIds !== undefined
          ? { projects: { deleteMany: {}, create: data.projectIds.map((project_id) => ({ project_id })) } }
          : {}),
      },
      include: webhookInclude,
    })
    res.json({ data: presentWebhook(stripSecret(webhook)) })
  } catch (err) { next(err) }
}

/** Troca o secret: o atual deixa de valer na hora; o novo volta só nesta resposta. */
export async function regenerateWebhookSecret(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.projectWebhook.findFirst({ where: { id: req.params.webhookId as string, ...ownWebhook(req) }, include: webhookInclude })
    if (!existing) throw new AppError(404, 'Webhook não encontrado', 'NOT_FOUND')
    await assertCanTarget(req, existing.projects.map((p) => p.project_id))

    const secret = randomBytes(32).toString('hex')
    const webhook = await prisma.projectWebhook.update({ where: { id: existing.id }, data: { secret }, include: webhookInclude })
    res.json({ data: { ...presentWebhook(stripSecret(webhook)), secret } })
  } catch (err) { next(err) }
}

export async function deleteWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const deleted = await prisma.projectWebhook.deleteMany({
      where: { id: req.params.webhookId as string, ...ownWebhook(req) },
    })
    if (deleted.count === 0) throw new AppError(404, 'Webhook não encontrado', 'NOT_FOUND')
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function listDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    const webhook = await prisma.projectWebhook.findFirst({
      where: { id: req.params.webhookId as string, ...ownWebhook(req) },
      select: { id: true },
    })
    if (!webhook) throw new AppError(404, 'Webhook não encontrado', 'NOT_FOUND')

    const page = Math.max(1, Number(req.query.page) || 1)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const result = await projectWebhooks.listDeliveries(webhook.id, page, status)
    res.json(result)
  } catch (err) { next(err) }
}

export async function resendDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await prisma.projectWebhookDelivery.findFirst({
      where: { id: req.params.deliveryId as string, webhook_id: req.params.webhookId as string, webhook: ownWebhook(req) },
      select: { id: true },
    })
    if (!delivery) throw new AppError(404, 'Entrega não encontrada', 'NOT_FOUND')

    const newId = await projectWebhooks.resendDelivery(delivery.id)
    res.status(202).json({ data: { deliveryId: newId } })
  } catch (err) { next(err) }
}

export async function testWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const webhook = await prisma.projectWebhook.findFirst({
      where: { id: req.params.webhookId as string, ...ownWebhook(req) },
      include: webhookInclude,
    })
    if (!webhook) throw new AppError(404, 'Webhook não encontrado', 'NOT_FOUND')

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, name: true },
    })

    // O payload leva o primeiro projeto selecionado; global vai sem projeto.
    const result = await projectWebhooks.testProjectWebhook(webhook.id, webhook.projects[0]?.project_id ?? null, actor)
    res.json({ data: result })
  } catch (err) { next(err) }
}
