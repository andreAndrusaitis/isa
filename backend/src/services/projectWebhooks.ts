/**
 * Webhooks exclusivos do módulo Projetos.
 *
 * Separado dos webhooks de chamados (`WebhookEndpoint`) porque o escopo é outro:
 * um webhook de projeto só recebe eventos daquele projeto, e o global só pode
 * ser criado por quem tem permissão administrativa do módulo. Reusa a
 * infraestrutura de entrega já endurecida dos chamados — validação anti-SSRF,
 * assinatura HMAC, backoff exponencial — em vez de duplicar aquele código.
 */
import { createHmac, randomUUID } from 'node:crypto'
import prisma from '../config/prisma'
import { logger } from '../utils/logger'
import { AppError } from '../middlewares/errorHandler'
import {
  validateWebhookUrl,
  postWithValidatedRedirects,
  truncate,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  DELIVERY_TIMEOUT_MS,
} from './webhookDelivery'
import { inferJsonSchema } from './webhookEvents'
import { loadFullTask } from './taskFull'
import { camelize } from '../utils/serialize'

const CLAIM_LEASE_MINUTES = 5
const DELIVERIES_PAGE_SIZE = 20

export const PROJECT_WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'task.assignee_changed',
  'task.completed',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'project.updated',
  'project.member_added',
  'project.member_removed',
  'approval.requested',
  'approval.approved',
  'approval.rejected',
  'document.created',
  'document.updated',
  'automation.executed',
  'automation.failed',
  'webhook.test',
] as const

export type ProjectWebhookEvent = (typeof PROJECT_WEBHOOK_EVENTS)[number]

export const PROJECT_WEBHOOK_EVENT_LABELS: Record<ProjectWebhookEvent, { group: string; label: string; description: string }> = {
  'task.created':            { group: 'Tasks', label: 'Task criada', description: 'Uma task nova foi criada no projeto.' },
  'task.updated':            { group: 'Tasks', label: 'Task atualizada', description: 'Algum campo da task mudou (status, prazo, título, responsável…); traz todas as mudanças da edição.' },
  'task.deleted':            { group: 'Tasks', label: 'Task excluída', description: 'A task foi excluída do projeto.' },
  'task.status_changed':     { group: 'Tasks', label: 'Status alterado', description: 'A task mudou de status (ex.: A fazer → Em andamento).' },
  'task.assignee_changed':   { group: 'Tasks', label: 'Responsável alterado', description: 'O responsável principal (changes.assignee) ou os co-responsáveis (changes.assignees) mudaram.' },
  'task.completed':          { group: 'Tasks', label: 'Task concluída', description: 'A task foi concluída.' },
  'comment.created':         { group: 'Comentários', label: 'Comentário criado', description: 'Alguém comentou numa task.' },
  'comment.updated':         { group: 'Comentários', label: 'Comentário editado', description: 'Um comentário foi editado.' },
  'comment.deleted':         { group: 'Comentários', label: 'Comentário excluído', description: 'Um comentário foi excluído.' },
  'project.updated':         { group: 'Projeto', label: 'Projeto atualizado', description: 'Dados do projeto (nome, datas, status) mudaram.' },
  'project.member_added':    { group: 'Projeto', label: 'Membro adicionado', description: 'Uma pessoa entrou no projeto.' },
  'project.member_removed':  { group: 'Projeto', label: 'Membro removido', description: 'Uma pessoa saiu do projeto.' },
  'approval.requested':      { group: 'Aprovações', label: 'Aprovação solicitada', description: 'Uma task pediu aprovação.' },
  'approval.approved':       { group: 'Aprovações', label: 'Aprovação concedida', description: 'O aprovador aprovou a task.' },
  'approval.rejected':       { group: 'Aprovações', label: 'Alterações solicitadas', description: 'O aprovador pediu alterações na task.' },
  'document.created':        { group: 'Docs', label: 'Documento criado', description: 'Um documento foi criado no projeto.' },
  'document.updated':        { group: 'Docs', label: 'Documento atualizado', description: 'Um documento do projeto foi editado.' },
  'automation.executed':     { group: 'Automação', label: 'Automação executada', description: 'Uma regra de automação do projeto rodou.' },
  'automation.failed':       { group: 'Automação', label: 'Automação falhou', description: 'Uma regra de automação do projeto falhou.' },
  'webhook.test':            { group: 'Sistema', label: 'Evento de teste', description: 'Disparado pelo botão "Testar" do webhook.' },
}

export function isProjectWebhookEvent(value: string): value is ProjectWebhookEvent {
  return (PROJECT_WEBHOOK_EVENTS as readonly string[]).includes(value)
}

/** Assinatura do header X-Projects-Signature: sha256=<hex> sobre `timestamp.body`. */
export function buildProjectSignature(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

// ------------------------------------------------------------------
// Exemplo de payload e JSON Schema por evento: o que o painel mostra em
// "Ver payload" / "Esquemas" para o destino (Power Automate, Zapier, n8n…).
// O formato de `data` segue o que tasks.ts emite de fato.
// ------------------------------------------------------------------

/** Resumo enxuto da task no payload — sem descrição nem PII extra. */
// `key` segue "#seq" por compatibilidade com quem já consome o webhook; o ID por tipo vai em `typeKey`.
export function webhookTask(task: { id: string; seq: number; title: string; key?: string | null }) {
  return { id: task.id, key: `#${task.seq}`, typeKey: task.key ?? null, seq: task.seq, title: task.title }
}

const SAMPLE_PERSON = { id: '3f6c1e2a-0000-4000-8000-0000000000b1', name: 'Maria Souza', email: 'maria.souza@empresa.com.br' }
const SAMPLE_TASK_REF = { id: '3f6c1e2a-0000-4000-8000-000000000002', seq: 140, key: 'FEAT-3', title: 'Tela de login' }
/** Mesmo formato que `withFullTask` envia (task completa em camelCase). */
const SAMPLE_TASK = {
  id: '3f6c1e2a-0000-4000-8000-000000000001',
  key: '#142', typeKey: 'BUG-7', seq: 142, number: '#142', typeNumber: 7,
  title: 'Implementar autenticação',
  description: 'Login com SSO Microsoft e fallback de senha local.\n\nCritérios: bloqueio após 5 tentativas.',
  priority: 'high',
  projectId: '3f6c1e2a-0000-4000-8000-0000000000c1', listId: '3f6c1e2a-0000-4000-8000-0000000000d2',
  statusId: '3f6c1e2a-0000-4000-8000-0000000000a2', parentId: SAMPLE_TASK_REF.id,
  taskTypeId: '3f6c1e2a-0000-4000-8000-0000000000e2', sprintId: '3f6c1e2a-0000-4000-8000-0000000000f2',
  assigneeId: SAMPLE_PERSON.id, creatorId: '3f6c1e2a-0000-4000-8000-0000000000d1',
  startDate: '2026-10-01T00:00:00.000Z', dueDate: '2026-10-20T00:00:00.000Z',
  storyPoints: 5, position: 3, isMilestone: false, recurrence: { freq: 'weekly', interval: 1, mode: 'on_complete' },
  archivedAt: '2026-10-21T12:00:00.000Z', createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-10-09T12:00:00.000Z',
  url: 'https://app.exemplo.com/projetos/3f6c1e2a-0000-4000-8000-0000000000c1/tasks?task=3f6c1e2a-0000-4000-8000-000000000001',
  project: { id: '3f6c1e2a-0000-4000-8000-0000000000c1', name: 'Atlas' },
  status: { id: '3f6c1e2a-0000-4000-8000-0000000000a2', name: 'Em andamento', category: 'in_progress', color: '#0f73ac' },
  taskType: { id: '3f6c1e2a-0000-4000-8000-0000000000e2', name: 'Bug', prefix: 'BUG', color: '#b3402a' },
  list: { id: '3f6c1e2a-0000-4000-8000-0000000000d2', name: 'Backlog' },
  sprint: { id: '3f6c1e2a-0000-4000-8000-0000000000f2', name: 'Sprint 12', status: 'active', startDate: '2026-10-06T00:00:00.000Z', endDate: '2026-10-17T00:00:00.000Z' },
  parent: SAMPLE_TASK_REF,
  assignee: SAMPLE_PERSON,
  creator: { id: '3f6c1e2a-0000-4000-8000-0000000000d1', name: 'João Silva', email: 'joao.silva@empresa.com.br' },
  assignees: [SAMPLE_PERSON],
  tags: [{ id: '3f6c1e2a-0000-4000-8000-000000000121', name: 'segurança', color: '#a8761b' }],
  customFields: [{ id: '3f6c1e2a-0000-4000-8000-000000000131', name: 'Cliente', type: 'text', value: 'ACME' }],
  checklist: [{ id: '3f6c1e2a-0000-4000-8000-000000000141', text: 'Escrever testes', done: true, position: 0 }],
  subtasks: [{ id: '3f6c1e2a-0000-4000-8000-000000000151', seq: 143, key: 'TASK-9', title: 'Tela de MFA', dueDate: '2026-10-18T00:00:00.000Z', assigneeId: SAMPLE_PERSON.id, status: { id: '3f6c1e2a-0000-4000-8000-0000000000a1', name: 'A fazer', category: 'open' } }],
  blockedBy: [{ dependencyId: '3f6c1e2a-0000-4000-8000-000000000161', task: SAMPLE_TASK_REF }],
  blocks: [{ dependencyId: '3f6c1e2a-0000-4000-8000-000000000162', task: { id: '3f6c1e2a-0000-4000-8000-000000000003', seq: 150, key: 'TASK-12', title: 'Deploy' } }],
  documents: [{ id: '3f6c1e2a-0000-4000-8000-000000000101', title: 'Especificação do login' }],
  tickets: [{ id: '3f6c1e2a-0000-4000-8000-000000000171', displayNumber: 'ISA-1042', title: 'Erro ao logar', status: 'pending' }],
  comments: [{ id: '3f6c1e2a-0000-4000-8000-0000000000e1', body: 'Revisei o fluxo, pode seguir.', createdAt: '2026-10-09T11:00:00.000Z', editedAt: '2026-10-09T11:05:00.000Z', author: SAMPLE_PERSON }],
  commentsCount: 1,
}
const SAMPLE_STATUS = {
  from: '3f6c1e2a-0000-4000-8000-0000000000a1',
  to: '3f6c1e2a-0000-4000-8000-0000000000a2',
  fromName: 'A fazer',
  toName: 'Em andamento',
  toCategory: 'in_progress',
}
const SAMPLE_USER = '3f6c1e2a-0000-4000-8000-0000000000b1'
const SAMPLE_COMMENT = { id: '3f6c1e2a-0000-4000-8000-0000000000e1', body: 'Revisei o fluxo, pode seguir.', authorId: SAMPLE_USER }
const SAMPLE_APPROVAL = { id: '3f6c1e2a-0000-4000-8000-0000000000f1', approverId: SAMPLE_USER, status: 'approved', comment: null }
const SAMPLE_DOCUMENT = { id: '3f6c1e2a-0000-4000-8000-000000000101', title: 'Especificação do login' }
const SAMPLE_AUTOMATION = { id: '3f6c1e2a-0000-4000-8000-000000000111', name: 'Concluída → avisar gerente', trigger: 'status_changed' }

function sampleData(event: ProjectWebhookEvent): Record<string, unknown> {
  switch (event) {
    case 'task.updated':
      return { task: SAMPLE_TASK, changes: { status_changed: SAMPLE_STATUS, title_changed: { from: 'Título antigo', to: SAMPLE_TASK.title } } }
    case 'task.status_changed':
      return { task: SAMPLE_TASK, changes: { status: SAMPLE_STATUS } }
    case 'task.assignee_changed':
      // `assignee` = responsável principal; `assignees` = lista completa (co-responsáveis).
      return { task: SAMPLE_TASK, changes: { assignee: { from: SAMPLE_USER, to: '3f6c1e2a-0000-4000-8000-0000000000b2' } } }
    case 'task.completed':
      return { task: SAMPLE_TASK, status: { id: SAMPLE_STATUS.to, name: 'Concluído' } }
    case 'comment.created':
    case 'comment.updated':
      return { task: SAMPLE_TASK, comment: SAMPLE_COMMENT }
    case 'comment.deleted':
      return { task: SAMPLE_TASK, comment: { id: SAMPLE_COMMENT.id, authorId: SAMPLE_USER } }
    case 'project.updated':
      return { changes: ['name', 'target_date'] }
    case 'project.member_added':
      return { member: { userId: SAMPLE_USER, name: 'Maria Souza', role: 'member' } }
    case 'project.member_removed':
      return { member: { userId: SAMPLE_USER, name: 'Maria Souza' } }
    case 'approval.requested':
      return { task: SAMPLE_TASK, approval: { ...SAMPLE_APPROVAL, status: 'pending' } }
    case 'approval.approved':
      return { task: SAMPLE_TASK, approval: SAMPLE_APPROVAL }
    case 'approval.rejected':
      return { task: SAMPLE_TASK, approval: { ...SAMPLE_APPROVAL, status: 'changes_requested', comment: 'Faltou o teste de regressão.' } }
    case 'document.created':
    case 'document.updated':
      return { document: SAMPLE_DOCUMENT }
    case 'automation.executed':
      return { task: SAMPLE_TASK, automation: SAMPLE_AUTOMATION }
    case 'automation.failed':
      return { task: SAMPLE_TASK, automation: SAMPLE_AUTOMATION, error: 'Status de destino não existe mais' }
    case 'webhook.test':
      return { message: 'Evento de teste disparado manualmente.' }
    default:
      return { task: SAMPLE_TASK }
  }
}

/** Envelope completo que o destino recebe para o evento. */
export function buildProjectExamplePayload(event: ProjectWebhookEvent): Record<string, unknown> {
  return {
    id: 'evt_0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    event,
    timestamp: '2026-10-09T12:00:00.000Z',
    project: { id: '3f6c1e2a-0000-4000-8000-0000000000c1', name: 'Atlas' },
    actor: { id: '3f6c1e2a-0000-4000-8000-0000000000d1', name: 'João Silva' },
    data: sampleData(event),
  }
}

/**
 * Todo campo abaixo da raiz aceita null: task sem responsável, sem sprint ou não
 * arquivada manda null, e o "Analisar JSON" do Power Automate falha se o esquema
 * não aceitar (mesma regra do painel de chamados).
 */
function nullableDeep(schema: Record<string, any>, root = true): Record<string, any> {
  const out: Record<string, any> = { ...schema }
  if (!root && out.type && !(Array.isArray(out.type) && out.type.includes('null'))) out.type = [...[out.type].flat(), 'null']
  if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, nullableDeep(v as Record<string, any>, false)]))
  if (out.items && typeof out.items === 'object') out.items = nullableDeep(out.items, false)
  return out
}

/** JSON Schema (draft-07) do envelope do evento. */
export function buildProjectEventJsonSchema(event: ProjectWebhookEvent): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `Projetos — evento ${event}`,
    ...nullableDeep(inferJsonSchema(buildProjectExamplePayload(event))),
  }
}

export interface EmitContext {
  projectId: string
  /** Basta o id: sem `name`, o nome é buscado só se houver webhook inscrito. */
  actor?: { id: string; name?: string } | null
  data: Record<string, unknown>
}

/** Atalho dos serviços: dispara sem esperar e sem nunca derrubar o fluxo de negócio. */
export function fireProjectWebhook(event: ProjectWebhookEvent, projectId: string, actorId: string | null | undefined, data: Record<string, unknown>) {
  void emitProjectWebhook(event, { projectId, actor: actorId ? { id: actorId } : null, data })
}

/**
 * Para quem só tem o id da task: busca projeto e resumo fora do caminho da
 * requisição — qualquer falha aqui só vira log, a ação do usuário já valeu.
 */
export function fireTaskWebhook(event: ProjectWebhookEvent, taskId: string, actorId: string | null | undefined, data: Record<string, unknown> = {}) {
  void (async () => {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, seq: true, title: true, key: true, project_id: true } })
    if (task) await emitProjectWebhook(event, { projectId: task.project_id, actor: actorId ? { id: actorId } : null, data: { task: webhookTask(task), ...data } })
  })().catch((error) => logger.error('[ProjectWebhooks] Falha ao preparar evento', { event, taskId, error: error?.message }))
}

/**
 * Enfileira o evento para todo webhook inscrito — os do próprio projeto e os
 * globais (project_id null). Fire-safe: nunca lança no caminho de negócio.
 */
export async function emitProjectWebhook(event: ProjectWebhookEvent, ctx: EmitContext): Promise<string[]> {
  try {
    const webhooks = await prisma.projectWebhook.findMany({
      where: {
        active: true,
        events: { has: event },
        // O acesso do dono é conferido a cada envio, não só na criação: quem
        // foi desativado, saiu do projeto ou virou leitor para de receber os dados dele.
        creator: { active: true, deleted_at: null },
        OR: [
          // Global (sem projetos) só vale enquanto o dono for admin.
          { projects: { none: {} }, creator: { role: 'admin' } },
          {
            projects: { some: { project_id: ctx.projectId } },
            creator: {
              OR: [
                { role: 'admin' },
                { project_memberships: { some: { project_id: ctx.projectId, role: { in: ['owner', 'manager', 'member'] } } } },
              ],
            },
          },
        ],
      },
      select: { id: true },
    })
    if (webhooks.length === 0) return []

    const [project, actor] = await Promise.all([
      prisma.project.findUnique({ where: { id: ctx.projectId }, select: { id: true, name: true } }),
      // Os serviços passam só o id de quem agiu; o nome sai daqui, uma vez por evento.
      ctx.actor && !ctx.actor.name
        ? prisma.user.findUnique({ where: { id: ctx.actor.id }, select: { id: true, name: true } })
        : Promise.resolve(ctx.actor ?? null),
    ])

    const timestamp = new Date().toISOString()
    const ids: string[] = []
    const data = await withFullTask(ctx.data)

    for (const webhook of webhooks) {
      const eventId = `evt_${randomUUID().replace(/-/g, '')}`
      const delivery = await prisma.projectWebhookDelivery.create({
        data: {
          webhook_id: webhook.id,
          event_id: eventId,
          event,
          payload: {
            id: eventId,
            event,
            timestamp,
            project: project ? { id: project.id, name: project.name } : null,
            actor: actor ?? ctx.actor ?? null,
            data,
          } as any,
          status: 'pending',
          next_retry_at: null,
        },
        select: { id: true },
      })
      ids.push(delivery.id)
    }

    for (const id of ids) {
      attemptProjectDelivery(id).catch((error) => {
        logger.error('[ProjectWebhooks] Falha na tentativa imediata', { deliveryId: id, error: error?.message })
      })
    }

    return ids
  } catch (error: any) {
    logger.error('[ProjectWebhooks] Falha ao emitir evento', { event, error: error?.message })
    return []
  }
}

/**
 * Troca o resumo da task (`data.task`) pela task completa — descrição, pessoas,
 * status, campos, comentários… Só roda quando há webhook inscrito. `key`
 * continua "#seq" e `typeKey` o ID do tipo, por compatibilidade com quem já consome.
 */
async function withFullTask(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const summary = data.task as { id?: string } | undefined
  if (!summary?.id) return data
  const full = await loadFullTask(summary.id)
  if (!full) return data
  return { ...data, task: { ...camelize(full), key: `#${full.seq}`, typeKey: full.key ?? null } }
}

/**
 * Uma tentativa de entrega. Claim atômico com lease para não haver envio
 * duplicado quando duas instâncias pegam a mesma delivery.
 */
export async function attemptProjectDelivery(deliveryId: string, opts: { once?: boolean } = {}): Promise<void> {
  const now = new Date()

  const claimed = await prisma.projectWebhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: 'pending',
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
    },
    data: { next_retry_at: new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000) },
  })
  if (claimed.count === 0) return

  const delivery = await prisma.projectWebhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  })
  if (!delivery) return

  // `once` (botão Testar): vale mesmo com o webhook pausado — é como se confere a URL antes de ligar.
  if (!delivery.webhook.active && !opts.once) {
    await prisma.projectWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', error_message: 'Webhook inativo', next_retry_at: null },
    })
    return
  }

  const attemptNumber = delivery.attempts + 1
  const started = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let errorMessage: string | null = null

  try {
    await validateWebhookUrl(delivery.webhook.url)

    const timestamp = new Date().toISOString()
    const body = JSON.stringify(delivery.payload)
    const signature = buildProjectSignature(delivery.webhook.secret, timestamp, body)

    const response = await postWithValidatedRedirects(delivery.webhook.url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Projects-Event': delivery.event,
        'X-Projects-Delivery': delivery.event_id,
        'X-Projects-Timestamp': timestamp,
        'X-Projects-Signature': `sha256=${signature}`,
        'User-Agent': 'ISA-Projects-Webhooks/1.0',
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })

    responseStatus = response.status
    responseBody = truncate(await response.text().catch(() => null))
    if (!response.ok) errorMessage = `HTTP ${response.status}`
  } catch (error: any) {
    errorMessage = error?.name === 'TimeoutError'
      ? `Timeout após ${DELIVERY_TIMEOUT_MS / 1000}s`
      : truncate(error?.message ?? 'Erro de rede', 500)
  }

  const durationMs = Date.now() - started
  const succeeded = responseStatus !== null && responseStatus >= 200 && responseStatus < 300

  if (succeeded) {
    await prisma.projectWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'success',
        attempts: attemptNumber,
        next_retry_at: null,
        response_status: responseStatus,
        response_body: responseBody,
        error_message: null,
        duration_ms: durationMs,
        delivered_at: new Date(),
      },
    })
    return
  }

  // Teste não entra na fila de novas tentativas: o resultado já volta na hora para quem clicou.
  const exhausted = opts.once || attemptNumber >= MAX_ATTEMPTS
  await prisma.projectWebhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? 'failed' : 'pending',
      attempts: attemptNumber,
      next_retry_at: exhausted
        ? null
        : new Date(Date.now() + BACKOFF_MINUTES[Math.min(attemptNumber - 1, BACKOFF_MINUTES.length - 1)] * 60_000),
      response_status: responseStatus,
      response_body: responseBody,
      error_message: errorMessage,
      duration_ms: durationMs,
    },
  })
}

/** Chamado pelo cron: processa entregas com backoff vencido. */
export async function processDueProjectDeliveries(limit = 50): Promise<number> {
  const due = await prisma.projectWebhookDelivery.findMany({
    where: {
      status: 'pending',
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: new Date() } }],
    },
    orderBy: { created_at: 'asc' },
    take: limit,
    select: { id: true },
  })

  for (const delivery of due) {
    await attemptProjectDelivery(delivery.id).catch((error) => {
      logger.error('[ProjectWebhooks] Erro no reprocessamento', { deliveryId: delivery.id, error: error?.message })
    })
  }

  return due.length
}

/**
 * "Testar" do painel: entrega um webhook.test só para ESTE webhook (mesmo que
 * ele não assine o evento) e devolve o resultado da tentativa, como no admin.
 */
export async function testProjectWebhook(webhookId: string, projectId: string | null, actor: { id: string; name: string } | null) {
  const project = projectId ? await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }) : null
  const eventId = `evt_${randomUUID().replace(/-/g, '')}`
  const delivery = await prisma.projectWebhookDelivery.create({
    data: {
      webhook_id: webhookId,
      event_id: eventId,
      event: 'webhook.test',
      payload: {
        id: eventId,
        event: 'webhook.test',
        timestamp: new Date().toISOString(),
        project,
        actor,
        data: { message: 'Evento de teste disparado manualmente.' },
      } as any,
      status: 'pending',
      next_retry_at: null,
    },
    select: { id: true },
  })
  await attemptProjectDelivery(delivery.id, { once: true })
  return prisma.projectWebhookDelivery.findUnique({
    where: { id: delivery.id },
    select: { status: true, response_status: true, duration_ms: true, error_message: true },
  })
}

/** Entregas paginadas de um webhook, mais recentes primeiro, com filtro opcional por status. */
export async function listDeliveries(webhookId: string, page = 1, status?: string) {
  const where: any = { webhook_id: webhookId }
  if (status && ['pending', 'success', 'failed'].includes(status)) where.status = status

  const [total, deliveries] = await Promise.all([
    prisma.projectWebhookDelivery.count({ where }),
    prisma.projectWebhookDelivery.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * DELIVERIES_PAGE_SIZE,
      take: DELIVERIES_PAGE_SIZE,
    }),
  ])

  return {
    data: deliveries,
    meta: { total, page, pages: Math.max(1, Math.ceil(total / DELIVERIES_PAGE_SIZE)) },
  }
}

/**
 * Reenvio manual: cria uma NOVA delivery com o mesmo payload em vez de
 * reabrir a antiga — o histórico de tentativas anteriores tem que permanecer.
 * Mantém o event_id de propósito (X-Projects-Delivery é a chave de idempotência
 * do destino); por isso não reenvia enquanto a original ainda está na fila,
 * senão o mesmo evento sairia duas vezes.
 */
export async function resendDelivery(deliveryId: string): Promise<string> {
  const original = await prisma.projectWebhookDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
  })
  if (original.status === 'pending') {
    throw new AppError(409, 'Esta entrega ainda está na fila de novas tentativas. Aguarde o resultado antes de reenviar.', 'WEBHOOK_DELIVERY_PENDING')
  }

  const created = await prisma.projectWebhookDelivery.create({
    data: {
      webhook_id: original.webhook_id,
      event_id: original.event_id,
      event: original.event,
      payload: original.payload as any,
      status: 'pending',
      next_retry_at: null,
    },
    select: { id: true },
  })

  attemptProjectDelivery(created.id).catch((error) => {
    logger.error('[ProjectWebhooks] Falha no reenvio', { deliveryId: created.id, error: error?.message })
  })

  return created.id
}
