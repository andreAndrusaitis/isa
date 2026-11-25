// Contrato da API de Projetos: toda resposta GET do módulo sai em camelCase,
// que é o que os tipos do frontend (types/projects.ts) leem. Já quebrou Board,
// Gantt, Timeline, Visão Geral, favoritos, webhooks e Minhas Tarefas quando um
// router não camelizava ou o tipo do front estava em snake_case.
// As rotas vêm da pilha dos routers (rota GET nova entra sozinha no teste).
// Usa Prisma real: rodar contra banco de teste (DATABASE_URL + DIRECT_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { createProjectApiKey } from '../services/projectApiKeys'
import projectsRoutes from './projects'
import projectsTeamRoutes from './projectsTeam'
import documentsRoutes from './documents'
import projectAttachmentsRoutes from './projectAttachments'
import templatesRoutes from './templates'
import myTasksRoutes from './myTasks'
import mcpTokensRoutes from './mcpTokens'

const MOUNTS: Array<[string, any]> = [
  ['/api/projects', projectsRoutes],
  ['/api/projects', projectsTeamRoutes],
  ['/api/projects/:projectId/docs', documentsRoutes],
  ['/api/projects/:projectId/files', projectAttachmentsRoutes],
  ['/api/templates', templatesRoutes],
  ['/api/my-tasks', myTasksRoutes],
  ['/api/mcp-tokens', mcpTokensRoutes],
]

// Mesmo conjunto de utils/serialize.ts: valor é dado do usuário, chaves preservadas.
const OPAQUE = new Set(['filters', 'conditions', 'actions', 'payload', 'structure', 'recurrence', 'value', 'content'])

function snakeKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => snakeKeys(v, `${path}[${i}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...(/^[a-z0-9]+_[a-z0-9_]+$/i.test(k) ? [`${path}.${k}`] : []),
    ...(OPAQUE.has(k) ? [] : snakeKeys(v, `${path}.${k}`)),
  ])
}

const ids: Record<string, string> = {}
let auth = ''

beforeAll(async () => {
  const stamp = Date.now()
  const user = await prisma.user.create({ data: { name: 'Contrato', email: `contrato-${stamp}@test.local`, role: 'agent', module_projects: true, permissions: ['projects_reports', 'projects_integrations'] } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { name: `Contrato ${stamp}`, owner_id: user.id, members: { create: { user_id: user.id, role: 'owner' } } } })
  ids.projectId = project.id
  const status = await prisma.projectStatus.create({ data: { project_id: project.id, name: 'A Fazer', color: '#000', category: 'open' } })
  const sprint = await prisma.sprint.create({ data: { project_id: project.id, name: 'S1' } })
  const task = await prisma.task.create({
    data: { project_id: project.id, status_id: status.id, seq: 1, title: 'T', creator_id: user.id, assignee_id: user.id, sprint_id: sprint.id, start_date: new Date(), due_date: new Date(Date.now() + 86_400_000) },
  })
  ids.taskId = task.id
  const tag = await prisma.tag.create({ data: { project_id: project.id, name: 'bug', color: '#f00' } })
  await prisma.taskTag.create({ data: { task_id: task.id, tag_id: tag.id } })
  await prisma.taskComment.create({ data: { task_id: task.id, author_id: user.id, body: 'oi' } })
  await prisma.taskActivity.create({ data: { task_id: task.id, actor_id: user.id, type: 'created' } })
  const doc = await prisma.document.create({ data: { project_id: project.id, title: 'Doc', content: [], created_by: user.id, updated_by: user.id } })
  ids.documentId = doc.id
  await prisma.attachment.create({ data: { project_id: project.id, entity_type: 'task', entity_id: task.id, file_name: 'a.txt', file_size: 1, mime_type: 'text/plain', storage_key: 'data:text/plain;base64,YQ==', uploaded_by: user.id } })
  const automation = await prisma.automation.create({ data: { project_id: project.id, name: 'A', trigger: 'task_created', actions: [], created_by: user.id } })
  ids.automationId = automation.id
  await prisma.automationRun.create({ data: { automation_id: automation.id, task_id: task.id, status: 'success' } })
  const webhook = await prisma.projectWebhook.create({ data: { name: 'W', url: 'https://example.com', secret: 's', events: ['task.created'], created_by: user.id, projects: { create: { project_id: project.id } } } })
  ids.webhookId = webhook.id
  // Chave da API pública com uma requisição no log (a tela "API" lê os dois).
  const apiKey = await createProjectApiKey(user.id, { name: `K ${stamp}`, scopes: ['read_tasks'], active: true, projectIds: [project.id] })
  ids.keyId = apiKey.id
  ids.keyServiceUserId = apiKey.service_user_id
  await prisma.apiRequestLog.create({ data: { project_api_key_id: apiKey.id, method: 'POST', path: '/x', status: 'success', resource_type: 'task', resource_id: task.id } })
  await prisma.projectWebhookDelivery.create({ data: { webhook_id: webhook.id, event_id: `evt_${stamp}`, event: 'task.created', payload: {} } })
  await prisma.favorite.create({ data: { user_id: user.id, entity_type: 'project', entity_id: project.id, project_id: project.id } })
  // Sprint global do próprio usuário, com cópia no projeto (o overview devolve projetos/tasks aninhados).
  const globalSprint = await prisma.globalSprint.create({ data: { owner_id: user.id, name: 'G1' } })
  ids.globalSprintId = globalSprint.id
  await prisma.project.update({ where: { id: project.id }, data: { sprint_source_id: user.id } })
  await prisma.sprint.create({ data: { project_id: project.id, global_sprint_id: globalSprint.id, name: 'G1' } })

  auth = `Bearer ${jwt.sign({ sub: user.id, role: 'agent', orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
})

afterAll(async () => {
  // Só o que este teste criou (nunca deleteMany amplo em user/organization).
  await prisma.projectWebhook.deleteMany({ where: { id: ids.webhookId } })
  await prisma.projectApiKey.deleteMany({ where: { id: ids.keyId } })
  await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.userId, ids.keyServiceUserId] } } })
})

describe('contrato camelCase da API de Projetos', () => {
  it('nenhuma rota GET do módulo devolve chave snake_case', async () => {
    const problems: string[] = []
    let checked = 0
    for (const [base, router] of MOUNTS) {
      for (const layer of router.stack) {
        if (!layer.route?.methods?.get) continue
        const url = `${base}${layer.route.path === '/' ? '' : layer.route.path}`
          .replace(':projectId', ids.projectId).replace(':taskId', ids.taskId).replace(':documentId', ids.documentId)
          .replace(':automationId', ids.automationId).replace(':webhookId', ids.webhookId).replace(':keyId', ids.keyId).replace(':event', 'task.updated')
          .replace(':globalSprintId', ids.globalSprintId).replace(':userId', ids.userId)
        if (url.includes(':')) { problems.push(`sem id de teste para ${url}`); continue }
        const query = url.endsWith('/search') ? { q: 'T' } : url.endsWith('/global-sprints') ? { ownerId: ids.userId }
          : url.endsWith('/export') ? { format: 'html' } : {} // dossiê: arquivo, não JSON
        const res = await request(app).get(url).query(query).set('Authorization', auth)
        checked++
        if (res.status >= 400) { problems.push(`${res.status} GET ${url}`); continue }
        for (const key of snakeKeys(res.body)) problems.push(`GET ${url} → ${key}`)
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(problems).toEqual([])
  }, 60_000) // ~40 requests reais: o padrão de 5s estoura com outros arquivos em paralelo
})
