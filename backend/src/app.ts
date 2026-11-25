/**
 * ISA - Backend Entry Point
 *
 * Este arquivo orquestra a inicialização do servidor Express, configurando
 * middlewares globais, rotas da API, jobs agendados e tratamento de erros.
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { createServer } from 'http'
import { initSocket } from './config/socket'
import { env } from './config/env'
import { errorHandler } from './middlewares/errorHandler'
import { notFound } from './middlewares/notFound'
import { apiRateLimit, mcpRateLimit, ssoRateLimit } from './middlewares/rateLimiter'
import { requireKnownOrigin } from './middlewares/knownOrigin'
import { presentAvatars } from './middlewares/presentAvatars'
import authRoutes from './routes/auth'
import accessRoutes from './access/routes'
import authSsoRoutes from './routes/authSso'
import ticketRoutes from './routes/tickets'
import userRoutes from './routes/users'
import orgRoutes from './routes/organizations'
import queueRoutes from './routes/queues'
import categoryRoutes from './routes/categories'
import macroRoutes from './routes/macros'
import routingRoutes from './routes/routing'
import slaRoutes from './routes/sla'
import auditRoutes from './routes/audit'
import emailLogRoutes from './routes/emailLogs'
import surveyRoutes from './routes/survey'
import escalationRoutes from './routes/escalation'
import notificationRoutes from './routes/notifications'
import { startSlaJob } from './jobs/slaChecker'
import { startAutoCloseJob } from './jobs/ticketAutoClose'
import { startTrashPurgeJob } from './jobs/trashPurge'
import { startRoutingIdleJob } from './jobs/routingIdle'
import { startProjectForecastJob } from './jobs/projectForecastJob'
import { startTaskRecurrenceJob } from './jobs/taskRecurrenceJob'
import { startInactivityRedirectJob } from './jobs/inactivityRedirect'
import { startPendingScheduleReopenJob } from './jobs/pendingScheduleReopen'
import { startWebhookRetryJob } from './jobs/webhookRetry'
import { startInboundMailJob } from './jobs/inboundMail'
import { startConfiguredWebhookBootstrap } from './services/webhookBootstrap'
import inactivitySettingsRoutes from './routes/inactivitySettings'
import autoCloseRoutes from './routes/autoClose'
import reopenSlaRoutes from './routes/reopenSla'
import ticketTypeConfigRoutes from './routes/ticketTypeConfig'
import dashboardRoutes from './routes/dashboard'
import managerLinksRoutes from './routes/managerLinks'
import businessHoursRoutes from './routes/businessHours'
import webhookRoutes from './routes/webhooks'
import apiKeyRoutes from './routes/apiKeys'
import externalApiRoutes from './routes/externalApi'
import projectsApiRoutes from './routes/projectsApi'
import aiRoutes from './ai/routes'
import intakeRoutes from './ai/agents/intake/routes'
import guidanceRoutes from './ai/agents/guidance/routes'
import triageRoutes from './ai/agents/triage/routes'
import insightsRoutes from './ai/insights'
import knowledgeRoutes from './ai/knowledge/routes'
import suggestRoutes, { feedbackRouter as aiFeedbackRoutes } from './ai/agents/knowledge/routes'
import { aiConfigured } from './ai/core/llm'
import { startAiProviderRefresh } from './ai/core/provider'
import systemConfigRoutes from './routes/systemConfig'
import { warmExamples } from './ai/core/examples'
import { AGENT as TRIAGE_AGENT } from './ai/agents/triage/agent'
import { agentMode } from './ai/agents/registry'
import mcpRoutes from './routes/mcp'
import mcpTokensRoutes from './routes/mcpTokens'
import assistantRoutes from './routes/assistant'
import teamsBotRoutes from './routes/teamsBot'
import linkPreviewRoutes from './routes/linkPreview'
import projectsRoutes from './routes/projects'
import projectsTeamRoutes from './routes/projectsTeam'
import documentsRoutes from './routes/documents'
import projectAttachmentsRoutes from './routes/projectAttachments'
import templatesRoutes from './routes/templates'
import docsRoutes from './routes/docs'
import { flushDocsOnShutdown } from './realtime/docs'
import myTasksRoutes from './routes/myTasks'
import morgan from 'morgan'
import { logger } from './utils/logger'
import { requestLogger } from './middlewares/requestLogger'
import prisma from './config/prisma'

const app = express()

app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false)

// ── Segurança (HTTP headers) ────────────────────────────────────────────────

// helmet aplica cabeçalhos de segurança: nosniff, frameguard (anti-clickjacking),
// HSTS (força HTTPS), Referrer-Policy e oculta o X-Powered-By.
// Esta é uma API JSON (não serve HTML), por isso a CSP padrão é desnecessária e
// poderia interferir em respostas — desabilitamos apenas a CSP e mantemos o resto.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}))

// ── Middlewares globais ─────────────────────────────────────────────────────

// Configuração de CORS: Permite que o frontend acesse a API.
// Origin é definido via variável de ambiente (env.CORS_ORIGIN), podendo ser uma lista separada por vírgulas.
const corsOrigins = env.CORS_ORIGIN.split(',').map(o => o.trim())
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}))

// Parser de JSON: Necessário para ler o corpo das requisições POST/PATCH em formato JSON.
// API externa aceita anexos em base64 no JSON (10 MB por arquivo; vários por POST /tickets).
app.use('/api/auth', express.json({ limit: '100kb' }))
app.use('/mcp', express.json({ limit: '1mb' }))
app.use('/api/integrations/v1', express.json({ limit: '30mb' }))
// Aceite da sugestão da IA: todos os anexos do Wizard vêm num corpo só, senão a mensagem
// de cada um reabriria o chamado já resolvido.
app.use(/^\/api\/ai\/suggest\/[^/]+\/accept$/, express.json({ limit: '30mb' }))
// 15 MB: anexo de até 10 MB (limite da tela) chega em base64 (+33%) dentro do JSON.
app.use(express.json({ limit: '15mb' }))

// Parser de cookies: necessário para ler o refresh token do cookie httpOnly.
app.use(cookieParser())

// ── Logging ──────────────────────────────────────────────────────────────────

// requestLogger: loga entrada (→) e saída (←) de cada requisição com método,
// URL, status, tempo, body sanitizado (sem senhas) e usuário autenticado.
app.use(requestLogger)

// Morgan 'combined' em produção — formato Apache para ingestão por log aggregators.
// Em dev o requestLogger já cobre tudo com mais detalhes.
if (env.NODE_ENV === 'production') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }))
}

// ── Health check ────────────────────────────────────────────────────────────

// Verifica conectividade real com o banco — Azure usa este endpoint para liveness probe.
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'ok', v: 3, timestamp: new Date().toISOString() })
  } catch (err: unknown) {
    logger.error('Health check failed:', err)
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
      v: 3,
      timestamp: new Date().toISOString()
    })
  }
})

app.get('/', (_req, res) => {
  res.json({
    name: 'ISA - API',
    version: '1.0.0',
    status: 'running'
  })
})

// ── Rotas da API ────────────────────────────────────────────────────────────

// Bot do Teams: antes do rate limit por IP — o tráfego vem todo dos IPs do
// Bot Framework; o SDK autentica o token e o assistente limita por usuário.
app.use('/api/teams',        teamsBotRoutes)

// Prévia de link (Open Graph) para Teams/Slack/WhatsApp, chamada pelo nginx do front:
// pública e antes do limite geral, porque todo o tráfego chega do mesmo IP (o nginx).
// O limite próprio fica no router.
app.use('/api/link-preview', linkPreviewRoutes)

// Rate limit geral aplicado em toda a API (proteção básica contra flood).
// Limites específicos por endpoint estão definidos em middlewares/rateLimiter.ts.
app.use('/api', apiRateLimit)
app.use('/api', presentAvatars)

// Registro dos módulos da API. Cada arquivo de rota gerencia seus próprios endpoints.
app.use('/api/auth', requireKnownOrigin)
app.use('/api/auth',          authRoutes)       // Login, Refresh Token, Logout
app.use('/api/system-config', systemConfigRoutes) // Aparência, login Microsoft e provedor de IA
app.use('/api/access',        accessRoutes)     // Catálogo de capacidades (porteiro)
// Fora do prefixo /api de propósito: o Redirect URI cadastrado no Entra ID
// (Azure AD) é .../auth/acs sem o prefixo /api — mudar aqui quebraria o SSO
// em produção.
app.use('/auth', ssoRateLimit)
app.use('/auth',              authSsoRoutes)    // SSO OIDC multi-tenant: login, acs, logout
app.use('/api/tickets',       ticketRoutes)    // Gestão de chamados (SLA, Status, Mensagens)
import * as userController from './controllers/users'
import { authenticate } from './middlewares/auth'

app.get('/api/users/me/stats', authenticate, userController.getMeStats)
app.use('/api/users',         userRoutes)      // Gestão de usuários e perfis
app.use('/api/organizations', orgRoutes)       // Cadastro de empresas/clientes
app.use('/api/queues',        queueRoutes)     // Filas de atendimento (N1, N2, etc.)
app.use('/api/categories',    categoryRoutes)  // Categorias e subcategorias de problemas
app.use('/api/macros',        macroRoutes)     // Macros (respostas pré-definidas) para o chat
app.use('/api/routing',       routingRoutes)   // Regras de roteamento automático
app.use('/api/sla',           slaRoutes)       // Configuração de SLA por Tier
app.use('/api/survey',        surveyRoutes)    // Pesquisa de Satisfação
app.use('/api/audit',         auditRoutes)     // Logs de auditoria (Login, Execuções)
app.use('/api/email-logs',    emailLogRoutes)  // Logs de envio de e-mail — admin
app.use('/api/escalation',    escalationRoutes) // Regras de escalonamento manual
app.use('/api/notifications', notificationRoutes) // Notificações persistentes por usuário
app.use('/api/inactivity',    inactivitySettingsRoutes) // Redirecionamento automático por inatividade
app.use('/api/auto-close',    autoCloseRoutes)          // Fechamento automático de resolvidos
app.use('/api/reopen-sla',    reopenSlaRoutes)          // Regra de SLA de Reabertura
app.use('/api/ticket-types',  ticketTypeConfigRoutes)   // Habilitar/desabilitar tipos de chamado
app.use('/api/dashboard',    dashboardRoutes)          // KPIs e dashboards para Manager/Supervisor
app.use('/api/manager-links', managerLinksRoutes)      // Vínculos Gerente ↔ Empresa/Analista
app.use('/api/business-hours', businessHoursRoutes)    // Horário comercial gerenciável (motor de SLA)
app.use('/api/webhooks',      webhookRoutes)           // Administração de webhooks de saída — admin
app.use('/api/integrations/keys', apiKeyRoutes)         // Administração das API keys de integração — admin
app.use('/api/integrations/v1/projects', projectsApiRoutes) // API pública de Projetos (chave isaproj_) — antes da de chamados, que exige isakey_ em todo /v1
app.use('/api/integrations/v1',   externalApiRoutes)    // API externa pública (token por API key) — cria/atualiza chamados e usuários
app.use('/mcp', mcpRateLimit)
app.use('/mcp',              mcpRoutes)               // Servidor MCP (token pessoal) — projetos e tarefas
app.use('/api/mcp-tokens',   mcpTokensRoutes)         // CRUD dos tokens pessoais usados pelo endpoint /mcp
app.use('/api/assistant',    assistantRoutes)         // Assistente de chamados no portal — só solicitante
app.use('/api/projects',     projectsTeamRoutes)      // Equipe/Dashboard do Gerente e Busca Global — antes do router :projectId
app.use('/api/projects/:projectId/docs', documentsRoutes)  // Docs/Wiki do projeto
app.use('/api/projects/:projectId/files', projectAttachmentsRoutes)  // Central de arquivos do projeto
app.use('/api/templates',    templatesRoutes)  // Templates de Projeto/Task
app.use('/api/projects',     projectsRoutes)          // Módulo de Projetos
app.use('/api/my-tasks',     myTasksRoutes)          // Consolidado cross-projeto
app.use('/api/docs',         docsRoutes)             // Módulo Documentos: espaços, páginas, versões e anexos

app.use('/api/ai/intake',     intakeRoutes)            // Agente intake: checklist (admin) e dispensar marca (analista)
app.use('/api/ai/guidance',   guidanceRoutes)          // Agente guidance: respostas do solicitante e veto de cartões (equipe)
app.use('/api/ai/tickets',    triageRoutes)            // Agente triage: última triagem do chamado e correções (equipe com acesso ao chamado)
app.use('/api/ai/insights',   insightsRoutes)          // Insights da IA para gestores (dentro da carteira)
app.use('/api/ai/suggest',    suggestRoutes)           // Agente knowledge: sugestão da base no Wizard (quem abre chamado)
app.use('/api/ai/feedback',   aiFeedbackRoutes)        // Agente knowledge: Útil / Não útil na resposta, só o dono da interação
app.use('/api/ai',            aiRoutes)                // Motor IA: status, execuções e métricas dos agentes — admin, somente leitura
app.use('/api/knowledge',     knowledgeRoutes)         // Base de conhecimento: artigos e indexação — admin

// ── Handlers de erro ────────────────────────────────────────────────────────

// Middleware para capturar rotas que não existem (404).
app.use(notFound)

// Middleware global de tratamento de erros: Centraliza todas as exceções da aplicação.
app.use(errorHandler)

// ── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3001

const httpServer = createServer(app)
initSocket(httpServer)

// Testes (vitest) importam o app só para o supertest: sem porta nem jobs de fundo,
// senão colide com o backend de dev na 3001 e os jobs escrevem no banco de teste.
if (!process.env.VITEST) httpServer.listen(port, () => {
  logger.info(`[ISA] Backend rodando na porta ${port}`)

  if (!env.AZURE_COMMUNICATION_CONNECTION_STRING) {
    logger.warn('[ISA] Azure Communication Services não configurado — e-mails serão ignorados.')
  }

  startSlaJob()
  startAutoCloseJob()
  startTrashPurgeJob()
  startRoutingIdleJob()
  startProjectForecastJob()
  startTaskRecurrenceJob()
  startInactivityRedirectJob()
  startPendingScheduleReopenJob()
  startConfiguredWebhookBootstrap()
  startWebhookRetryJob()
  startInboundMailJob()
  startAiProviderRefresh()
  flushDocsOnShutdown()

  // Aquece o índice RAG da triagem em segundo plano (evita N cargas na 1ª rajada de chamados).
  if (aiConfigured()) {
    agentMode(TRIAGE_AGENT)
      .then(mode => (mode === 'off' ? 0 : warmExamples(TRIAGE_AGENT)))
      .then(n => { if (n) logger.info(`[AI:${TRIAGE_AGENT}] cache de exemplos aquecido: ${n}`) })
      .catch(err => logger.warn(`[AI:${TRIAGE_AGENT}] aquecimento do cache de exemplos falhou: ${err?.message ?? err}`))
  }
})

export default app

