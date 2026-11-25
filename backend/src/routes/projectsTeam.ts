import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as teamService from '../services/projectsTeam'
import * as searchService from '../services/projectsSearch'
import * as reportsService from '../services/projectReports'
import { camelizeResponses } from '../utils/serialize'
import * as taskTime from '../services/taskTime'
import * as drill from '../services/projectDrill'
import { readableTickets } from '../services/taskFull'
import { z } from 'zod'
import * as insights from '../services/projectInsights'
import { collectDossier } from '../services/projectExport/collect'
import { renderDossierHtml } from '../services/projectExport/html'
import { buildDossierWorkbook } from '../services/projectExport/xlsx'
import { resolveExportProjects, dayStartSp, dayEndSp } from '../services/projectExport/index'
import { createAuditLog } from '../services/audit'
import { teamUserIds, effectiveProjectRole, visibleProjectsWhere } from '../services/projectAccess'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { can, subjectOf } from '../access/can'
import { areaDenied } from '../utils/denials'

const router = Router()

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)
router.use(camelizeResponses)

// Relatórios do portfólio (painéis, equipe, horas, dossiê): Gerente e TM pelo cargo;
// os demais só com a liberação "Relatórios de Projetos" na ficha.
const reports = requireCap('projects.reports')

router.get('/team', reports, async (req, res, next) => {
  try {
    const workload = await teamService.getTeamWorkload(req.user!.sub)
    res.json({ data: workload })
  } catch (err) { next(err) }
})

// Gestão: horas por projeto/pessoa e chamados em projeto, nos projetos de que o usuário participa.
router.get('/time-summary', reports, async (req, res, next) => {
  try {
    const [time, canOpen] = await Promise.all([taskTime.getPortfolioTime(req.user!.sub), drill.personAccess(req.user!.sub, req.user!.role)])
    res.json({ data: { ...time, byPerson: time.byPerson.map((p) => ({ ...p, canOpen: !!p.userId && canOpen(p.userId) })) } })
  } catch (err) { next(err) }
})
router.get('/linked-tickets', reports, async (req, res, next) => {
  try {
    const tickets = await taskTime.getLinkedTicketsForUser(req.user!.sub)
    // Ver o projeto não dá acesso ao chamado: o relatório fica com os que a pessoa pode ler.
    const readable = new Set((await readableTickets(req.user!, { id: { in: tickets.map((t) => t.id) } })).map((t) => t.id))
    res.json({ data: tickets.filter((t) => readable.has(t.id)) })
  } catch (err) { next(err) }
})

// Gráficos do portfólio (BI): projetos de que o usuário é membro.
router.get('/insights', reports, async (req, res, next) => {
  try { res.json({ data: await insights.getInsights(await insights.memberProjectIds(req.user!.sub)) }) } catch (err) { next(err) }
})
// Mapa de calor de atividade nos projetos do usuário: do time, de uma pessoa ou "me".
router.get('/activity', async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.union([z.literal('me'), z.string().uuid()]).optional() }).parse(req.query)
    // A própria atividade (Minha Área) é de todos; a do time ou de outra pessoa é relatório.
    if (userId !== 'me' && userId !== req.user!.sub && !can(await subjectOf(req), 'projects.reports')) {
      throw areaDenied('projects_reports', req.user!.role)
    }
    // Atividade de uma pessoa: a própria, a de quem está abaixo no organograma, ou admin.
    if (userId && userId !== 'me' && userId !== req.user!.sub && req.user!.role !== 'admin' && !(await teamUserIds(req.user!.sub)).includes(userId)) {
      throw new AppError(403, 'Você só vê a atividade de quem está abaixo de você no organograma.', 'ACTIVITY_OUT_OF_TEAM')
    }
    const ids = await insights.memberProjectIds(req.user!.sub)
    res.json({ data: await insights.getActivityHeatmap(ids, userId === 'me' ? req.user!.sub : userId) })
  } catch (err) { next(err) }
})

// Lente do BI: "team" (padrão) = projetos de que a equipe participa; "mine" = os que a pessoa é dona ou gerente.
const scopeQuery = z.object({ scope: z.enum(['mine', 'team']).default('team') })

router.get('/dashboard-global', reports, async (req, res, next) => {
  try {
    const { scope } = scopeQuery.parse(req.query)
    const dashboard = scope === 'mine'
      ? await reportsService.getDashboardGlobalFor(await reportsService.managedProjectIds(req.user!.sub))
      : await teamService.getDashboardGlobal(req.user!.sub)
    res.json({ data: dashboard })
  } catch (err) { next(err) }
})

// Tempo médio de ciclo por tipo de task, concluídas nos últimos `days` dias.
router.get('/cycle-time', reports, async (req, res, next) => {
  try {
    const { days, scope } = scopeQuery.extend({ days: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query)
    res.json({
      data: scope === 'mine'
        ? await reportsService.getCycleTimeByTypeFor(await reportsService.managedProjectIds(req.user!.sub), days)
        : await teamService.getCycleTimeByType(req.user!.sub, days),
    })
  } catch (err) { next(err) }
})

// Tabela "Meus projetos" do BI: abertas, concluídas, atrasadas, ciclo médio e membros.
router.get('/reports/my-projects', reports, async (req, res, next) => {
  try {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query)
    res.json({ data: await reportsService.getMyProjectsReport(req.user!.sub, days) })
  } catch (err) { next(err) }
})

// Meu ciclo por projeto (Minha Área): pessoal, só as minhas tasks — não é relatório.
router.get('/my-cycle', async (req, res, next) => {
  try {
    const { days } = z.object({ days: z.coerce.number().int().min(30).max(365).default(90) }).parse(req.query)
    res.json({ data: await reportsService.getMyCycle(req.user!.sub, days) })
  } catch (err) { next(err) }
})

// Modais de detalhe. Dentro de um projeto, basta vê-lo; no portfólio, é relatório e
// a pessoa precisa ser o próprio usuário ou alguém abaixo dele no organograma.
const assertSeesProject = async (projectId: string, userId: string) => {
  if (!(await effectiveProjectRole(projectId, userId))) throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND') // como o requireProjectRole: não revela que existe
}

// Quem abre pelo projeto só vê gente dele: membro, responsável ou quem já foi (o tempo por
// pessoa mantém ex-responsáveis). Sem isso, o projectId abriria o cadastro de qualquer usuário.
const assertPersonInProject = async (projectId: string, personId: string) => {
  const [members, tasks] = await Promise.all([
    prisma.projectMember.count({ where: { project_id: projectId, user_id: personId } }),
    prisma.task.count({
      where: {
        project_id: projectId,
        OR: [
          { assignee_id: personId },
          { multi_assignees: { some: { user_id: personId } } },
          { activities: { some: { type: { in: ['assignee_changed', 'assignees_changed'] }, OR: [{ from_value: { contains: personId } }, { to_value: { contains: personId } }] } } },
        ],
      },
    }),
  ])
  if (!members && !tasks) throw new AppError(404, 'Pessoa não encontrada', 'NOT_FOUND')
}

const drillTasksQuery = scopeQuery.extend({
  projectId: z.string().uuid().optional(),
  kind: z.enum(['all', 'open', 'done', 'overdue', 'upcoming', 'running']).optional(),
  categories: z.string().max(120).optional(),
  statusId: z.string().uuid().optional(),
  priority: z.string().max(20).optional(),
  type: z.string().max(120).optional(),
  assigneeId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(7).max(365).default(90),
})

router.get('/drill/tasks', async (req, res, next) => {
  try {
    const q = drillTasksQuery.parse(req.query)
    const userId = req.user!.sub
    let projectIds: string[]
    if (q.projectId) {
      await assertSeesProject(q.projectId, userId)
      projectIds = [q.projectId]
    } else {
      if (!can(await subjectOf(req), 'projects.reports')) throw areaDenied('projects_reports', req.user!.role)
      projectIds = q.scope === 'mine'
        ? await reportsService.managedProjectIds(userId)
        : (await prisma.project.findMany({ where: { ...(await visibleProjectsWhere(userId)), archived_at: null }, select: { id: true } })).map((p) => p.id)
    }
    const canOpen = q.projectId ? () => true : await drill.personAccess(userId, req.user!.role)
    res.json({
      data: await drill.getTaskListDrill(projectIds, {
        kind: q.kind, categories: q.categories?.split(',').filter(Boolean), statusId: q.statusId, priority: q.priority,
        typeName: q.type, assigneeId: q.assigneeId, days: q.days,
      }, canOpen),
    })
  } catch (err) { next(err) }
})

router.get('/drill/people/:userId', async (req, res, next) => {
  try {
    const personId = z.string().uuid().parse(req.params.userId)
    const { projectId, days } = z.object({ projectId: z.string().uuid().optional(), days: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query)
    const userId = req.user!.sub
    if (projectId) {
      await assertSeesProject(projectId, userId)
      if (personId !== userId) await assertPersonInProject(projectId, personId)
    } else if (personId !== userId) {
      if (!can(await subjectOf(req), 'projects.reports')) throw areaDenied('projects_reports', req.user!.role)
      if (!(await drill.personAccess(userId, req.user!.role))(personId)) {
        throw new AppError(403, 'Você só vê o detalhe de quem está abaixo de você no organograma.', 'PERSON_OUT_OF_TEAM')
      }
    }
    res.json({ data: await drill.getPersonDrill(userId, personId, { projectId, days }) })
  } catch (err) { next(err) }
})

router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q as string) ?? ''
    const results = await searchService.search(req.user!.sub, q)
    res.json({ data: results })
  } catch (err) { next(err) }
})

// Dossiê de projetos (HTML para ler/apresentar, Excel para analisar): os projetos que a
// pessoa vê — inclusive os da equipe, para o Gerente — ou os escolhidos.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')
const exportQuery = z.object({
  format: z.enum(['html', 'xlsx']),
  projectIds: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
})
router.get('/export', reports, async (req, res, next) => {
  try {
    const q = exportQuery.parse(req.query)
    const userId = req.user!.sub
    const ids = await resolveExportProjects(userId, q.projectIds?.split(',').map((s) => s.trim()).filter(Boolean))
    const dossier = await collectDossier(ids, { userId, from: q.from ? dayStartSp(q.from) : null, to: q.to ? dayEndSp(q.to) : null })
    // Título, status e empresa do chamado seguem a carteira de quem exporta; a task mantém só o número.
    const readable = new Set((await readableTickets(req.user!, { display_number: { in: dossier.tickets.map((k) => k.number) } })).map((k) => k.display_number))
    dossier.tickets = dossier.tickets.filter((k) => readable.has(k.number))
    await createAuditLog({ userId, action: 'PROJECTS_EXPORT', resource: 'PROJECT', details: { format: q.format, projectIds: ids, from: q.from ?? null, to: q.to ?? null } })

    const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) // AAAA-MM-DD
    res.setHeader('Content-Disposition', `attachment; filename="dossie-projetos-${stamp}.${q.format}"`)
    if (q.format === 'html') {
      res.type('text/html; charset=utf-8').send(renderDossierHtml(dossier))
      return
    }
    const buf = await (await buildDossierWorkbook(dossier)).xlsx.writeBuffer()
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf as ArrayBuffer))
  } catch (err) { next(err) }
})

export default router
