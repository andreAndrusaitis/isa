import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { StatusCategory, TaskPriority, ProjectMemberRole } from '@prisma/client'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { AppError } from '../middlewares/errorHandler'
import { getEffectiveModules } from './moduleAccess'
import { createAuditLog } from './audit'
import { DEFAULT_TASK_TYPES, PREFIX_PATTERN, buildKey } from './taskTypeKeys'

/**
 * Backup de projeto em JSON (exportar/importar) e importação do export do
 * ClickUp. Os dois caminhos convergem num "plano" neutro (ImportPlan) que é
 * mostrado na pré-visualização e gravado do mesmo jeito: um projeto por
 * transação, com o importador como dono e só pessoas que usam o módulo
 * Projetos como membros/responsáveis.
 */

export const BACKUP_FORMAT = 'isa.project-backup'
const BACKUP_VERSION = 1

// ---------------------------------------------------------------------------
// Plano neutro
// ---------------------------------------------------------------------------

interface PlanStatus { name: string; color: string; category: StatusCategory }
interface PlanType { name: string; prefix: string; icon: string; color: string }
interface PlanTask {
  seq?: number
  typePrefix: string
  typeNumber?: number
  title: string
  description: string | null
  statusName: string
  listName: string | null
  sprintName: string | null
  priority: TaskPriority
  assigneeEmails: string[]
  assigneeNames?: Record<string, string> // e-mail → nome, para citar quem ficou de fora
  missingAssignees: string[]
  startDate: string | null
  dueDate: string | null
  storyPoints: number | null
  isMilestone: boolean
  archivedAt: string | null
  parentSeq: number | null
  tags: string[]
  checklist: Array<{ text: string; done: boolean }>
  comments: Array<{ authorEmail: string; body: string; createdAt: string }>
}
interface PlanProject {
  name: string
  description: string | null
  startDate: string | null
  targetDate: string | null
  statuses: PlanStatus[]
  types: PlanType[]
  lists: string[]
  sprints: Array<{ name: string; status: 'planned' | 'active' | 'completed'; startDate: string | null; endDate: string | null }>
  tags: Array<{ name: string; color: string }>
  members: Array<{ email: string; role: ProjectMemberRole }>
  tasks: PlanTask[]
  keepNumbers: boolean // backup próprio mantém #seq e BUG-12; ClickUp numera do zero
  commentAuthorsVerified?: boolean // comentários assinados pelo export deste servidor
}
interface ImportPlan { format: 'backup' | 'clickup'; projects: PlanProject[] }

// ---------------------------------------------------------------------------
// Assinatura dos comentários
// ---------------------------------------------------------------------------

type SignableTask = { seq: number; comments: Array<{ authorEmail: string; body: string; createdAt: string }> }

/**
 * O arquivo é JSON comum e quem importa pode editá-lo: sem prova de origem, daria
 * para atribuir comentário a qualquer colega. O export assina autor, texto e data
 * de cada comentário; o resto do arquivo segue editável. Chave derivada para não
 * assinar com o segredo do JWT diretamente.
 */
function signComments(tasks: SignableTask[]) {
  const key = createHmac('sha256', env.JWT_SECRET).update('project-backup-comments').digest()
  const payload = tasks.flatMap((t) => t.comments.map((c) => [t.seq, c.authorEmail, c.body, c.createdAt]))
  return createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex')
}

function commentsSignatureMatches(tasks: SignableTask[], signature: string | undefined) {
  if (!signature) return false
  const expected = Buffer.from(signComments(tasks))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

export async function exportProject(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      statuses: { orderBy: { position: 'asc' } },
      task_types: { where: { is_active: true }, orderBy: { position: 'asc' } },
      lists: { where: { archived_at: null }, orderBy: { position: 'asc' } },
      sprints: { orderBy: { position: 'asc' } },
      tags: true,
      members: { include: { user: { select: { email: true } } } },
    },
  })
  const tasks = await prisma.task.findMany({
    where: { project_id: projectId },
    orderBy: { seq: 'asc' },
    include: {
      status: { select: { name: true } },
      task_type: { select: { prefix: true } },
      list: { select: { name: true } },
      sprint: { select: { name: true } },
      parent: { select: { seq: true } },
      assignee: { select: { email: true } },
      multi_assignees: { include: { user: { select: { email: true } } } },
      tags: { include: { tag: { select: { name: true } } } },
      checklist: { orderBy: { position: 'asc' } },
      comments: { where: { deleted_at: null }, orderBy: { created_at: 'asc' }, include: { author: { select: { email: true } } } },
    },
  })
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  const backupTasks = tasks.map((t) => ({
    seq: t.seq,
    typePrefix: t.task_type?.prefix ?? 'TASK',
    typeNumber: t.type_number,
    title: t.title,
    description: t.description,
    status: t.status.name,
    list: t.list?.name ?? null,
    sprint: t.sprint?.name ?? null,
    priority: t.priority,
    assignees: t.multi_assignees.length ? t.multi_assignees.map((a) => a.user.email) : t.assignee ? [t.assignee.email] : [],
    startDate: iso(t.start_date),
    dueDate: iso(t.due_date),
    storyPoints: t.story_points,
    isMilestone: t.is_milestone,
    archivedAt: iso(t.archived_at),
    parentSeq: t.parent?.seq ?? null,
    tags: t.tags.map((x) => x.tag.name),
    checklist: t.checklist.map((c) => ({ text: c.text, done: c.done })),
    comments: t.comments.map((c) => ({ authorEmail: c.author.email, body: c.body, createdAt: c.created_at.toISOString() })),
  }))

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      description: project.description,
      startDate: iso(project.start_date),
      targetDate: iso(project.target_date),
      statuses: project.statuses.map((s) => ({ name: s.name, color: s.color, category: s.category })),
      taskTypes: project.task_types.map((t) => ({ name: t.name, prefix: t.prefix, icon: t.icon, color: t.color })),
      lists: project.lists.map((l) => l.name),
      sprints: project.sprints.map((s) => ({ name: s.name, status: s.status, startDate: iso(s.start_date), endDate: iso(s.end_date) })),
      tags: project.tags.map((t) => ({ name: t.name, color: t.color })),
      members: project.members.map((m) => ({ email: m.user.email, role: m.role })),
    },
    tasks: backupTasks,
    commentsSignature: signComments(backupTasks),
  }
}

// ---------------------------------------------------------------------------
// Ler o arquivo
// ---------------------------------------------------------------------------

// Datas do arquivo em ISO 8601 (o export grava toISOString); "Invalid Date" estourava 500 no Prisma.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const isoDate = z.string().refine((s) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)), 'data inválida (use ISO 8601, ex.: 2026-10-08T12:00:00.000Z)')

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  commentsSignature: z.string().optional(),
  project: z.object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    startDate: isoDate.nullable().optional(),
    targetDate: isoDate.nullable().optional(),
    statuses: z.array(z.object({ name: z.string().min(1), color: z.string(), category: z.nativeEnum(StatusCategory) })).min(1),
    taskTypes: z.array(z.object({ name: z.string().min(1), prefix: z.string().regex(PREFIX_PATTERN, 'prefixo inválido (até 8 letras maiúsculas ou dígitos, começando por letra)'), icon: z.string(), color: z.string() })).min(1),
    lists: z.array(z.string()).default([]),
    sprints: z.array(z.object({ name: z.string(), status: z.enum(['planned', 'active', 'completed']), startDate: isoDate.nullable(), endDate: isoDate.nullable() })).default([]),
    tags: z.array(z.object({ name: z.string().min(1), color: z.string() })).default([]),
    members: z.array(z.object({ email: z.string(), role: z.nativeEnum(ProjectMemberRole) })).default([]),
  }),
  tasks: z.array(z.object({
    seq: z.number().int().positive(),
    typePrefix: z.string(),
    typeNumber: z.number().int().positive().nullable().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: z.string(),
    list: z.string().nullable().optional(),
    sprint: z.string().nullable().optional(),
    priority: z.nativeEnum(TaskPriority).default('none'),
    assignees: z.array(z.string()).default([]),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    storyPoints: z.number().int().nullable().optional(),
    isMilestone: z.boolean().default(false),
    archivedAt: isoDate.nullable().optional(),
    parentSeq: z.number().int().nullable().optional(),
    tags: z.array(z.string()).default([]),
    checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).default([]),
    comments: z.array(z.object({ authorEmail: z.string(), body: z.string(), createdAt: isoDate })).default([]),
  })).max(20_000),
})

const clickupSchema = z.object({
  source: z.literal('ClickUp'),
  members: z.array(z.object({ id: z.union([z.number(), z.string()]), name: z.string(), email: z.string() })).default([]),
  spaces: z.array(z.any()).default([]),
  tasks: z.array(z.object({
    id: z.string(),
    url: z.string().optional(),
    name: z.string().min(1),
    status: z.string().default(''),
    priority: z.string().nullable().optional(),
    assignees: z.array(z.object({ id: z.union([z.number(), z.string()]), name: z.string().optional() })).default([]),
    tags: z.array(z.string()).default([]),
    due_date: isoDate.nullable().optional(),
    date_closed: isoDate.nullable().optional(),
    list_id: z.string(),
  })).max(20_000),
})

const repeated = (values: string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))]

/** Primeiro ciclo na cadeia de pais (#3 → #5 → #3), ou null. Pai inexistente encerra a cadeia. */
function findParentCycle(tasks: Array<{ seq: number; parentSeq?: number | null }>) {
  const parent = new Map(tasks.map((t) => [t.seq, t.parentSeq ?? null]))
  const safe = new Set<number>()
  for (const t of tasks) {
    const path: number[] = []
    let cur: number | null = t.seq
    while (cur != null && parent.has(cur) && !safe.has(cur)) {
      const at = path.indexOf(cur)
      if (at >= 0) return [...path.slice(at), cur]
      path.push(cur)
      cur = parent.get(cur) ?? null
    }
    for (const s of path) safe.add(s)
  }
  return null
}

/** O que o banco recusaria no meio da transação (500) vira 400 com o problema nomeado. */
function assertConsistentBackup(data: z.infer<typeof backupSchema>) {
  const p = data.project
  const fail = (msg: string) => { throw new AppError(400, `Backup inválido: ${msg}`, 'INVALID_BACKUP') }
  const list = (values: Array<string | number>) => values.map((v) => (typeof v === 'number' ? `#${v}` : `"${v}"`)).join(', ')
  const checks: Array<[string, string[]]> = [
    ['status com nome repetido', p.statuses.map((s) => s.name)],
    ['tipos com prefixo repetido', p.taskTypes.map((t) => t.prefix)],
    ['listas com nome repetido', p.lists],
    ['sprints com nome repetido', p.sprints.map((s) => s.name)],
    ['etiquetas com nome repetido', p.tags.map((t) => t.name)],
  ]
  for (const [label, values] of checks) {
    const dup = repeated(values)
    if (dup.length) fail(`${label}: ${list(dup)}.`)
  }
  const dupSeq = repeated(data.tasks.map((t) => String(t.seq)))
  if (dupSeq.length) fail(`tasks com número repetido: ${list(dupSeq.map(Number))}.`)
  const dupKey = repeated(data.tasks.filter((t) => t.typeNumber).map((t) => buildKey(t.typePrefix, t.typeNumber!)))
  if (dupKey.length) fail(`chave repetida em mais de uma task: ${dupKey.join(', ')}.`)
  const cycle = findParentCycle(data.tasks)
  if (cycle) fail(`hierarquia circular entre as tasks ${cycle.map((s) => `#${s}`).join(' → ')}.`)
}

function backupToPlan(data: z.infer<typeof backupSchema>): ImportPlan {
  assertConsistentBackup(data)
  const p = data.project
  const statusNames = new Set(p.statuses.map((s) => s.name))
  const typePrefixes = new Set(p.taskTypes.map((t) => t.prefix))
  for (const t of data.tasks) {
    if (!statusNames.has(t.status)) throw new AppError(400, `Task #${t.seq} usa o status "${t.status}", que não está na lista de status do backup.`, 'INVALID_BACKUP')
    if (!typePrefixes.has(t.typePrefix)) throw new AppError(400, `Task #${t.seq} usa o tipo ${t.typePrefix}, que não está nos tipos do backup.`, 'INVALID_BACKUP')
  }
  return {
    format: 'backup',
    projects: [{
      name: p.name,
      description: p.description ?? null,
      startDate: p.startDate ?? null,
      targetDate: p.targetDate ?? null,
      statuses: p.statuses,
      types: p.taskTypes,
      lists: p.lists,
      sprints: p.sprints,
      tags: p.tags,
      members: p.members,
      keepNumbers: true,
      commentAuthorsVerified: commentsSignatureMatches(data.tasks, data.commentsSignature),
      tasks: data.tasks.map((t) => ({
        seq: t.seq,
        typePrefix: t.typePrefix,
        typeNumber: t.typeNumber ?? undefined,
        title: t.title,
        description: t.description ?? null,
        statusName: t.status,
        listName: t.list ?? null,
        sprintName: t.sprint ?? null,
        priority: t.priority,
        assigneeEmails: t.assignees,
        missingAssignees: [],
        startDate: t.startDate ?? null,
        dueDate: t.dueDate ?? null,
        storyPoints: t.storyPoints ?? null,
        isMilestone: t.isMilestone,
        archivedAt: t.archivedAt ?? null,
        parentSeq: t.parentSeq ?? null,
        tags: t.tags,
        checklist: t.checklist,
        comments: t.comments,
      })),
    }],
  }
}

// --- ClickUp ---------------------------------------------------------------

const DEFAULT_STATUS_ROWS: PlanStatus[] = [
  { name: 'A Fazer', color: '#8fa3af', category: 'open' },
  { name: 'Em Progresso', color: '#0f73ac', category: 'in_progress' },
  { name: 'Concluído', color: '#3a7f6b', category: 'done' },
]
const CATEGORY_ORDER: Record<StatusCategory, number> = { backlog: 0, open: 1, in_progress: 2, in_review: 3, done: 4, cancelled: 5 }
const CATEGORY_COLOR: Record<StatusCategory, string> = {
  backlog: '#6b7f8a', open: '#8fa3af', in_progress: '#0f73ac', in_review: '#a8761b', done: '#3a7f6b', cancelled: '#9aa7ae',
}

/** Status do ClickUp → status do projeto. Os três padrão absorvem os equivalentes. */
export function mapClickUpStatus(raw: string): PlanStatus {
  const s = raw.trim().toLowerCase()
  const titled = raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1)
  if (/^(conclu[ií]d[oa]|complete[d]?|done|closed|fechad[oa]|finalizad[oa]|entregue)$/.test(s)) return DEFAULT_STATUS_ROWS[2]
  if (/^(to ?do|a fazer|open|aberto|novo|new)$/.test(s)) return DEFAULT_STATUS_ROWS[0]
  if (/^(em (andamento|progresso)|in progress|doing|fazendo)$/.test(s)) return DEFAULT_STATUS_ROWS[1]
  if (/cancel|descartad/.test(s)) return { name: titled, color: CATEGORY_COLOR.cancelled, category: 'cancelled' }
  if (/backlog|pipeline|stand ?by|ideia/.test(s)) return { name: titled, color: CATEGORY_COLOR.backlog, category: 'backlog' }
  if (/qa|review|revis|valida|homolog|deploy|produ|aguardando|aprova|teste/.test(s)) return { name: titled, color: CATEGORY_COLOR.in_review, category: 'in_review' }
  if (/andamento|progress|execu|criação|desenvolv/.test(s)) return { name: titled, color: CATEGORY_COLOR.in_progress, category: 'in_progress' }
  return { name: titled || 'A Fazer', color: CATEGORY_COLOR.open, category: 'open' }
}

/** Tipo pela tag ou pelo título (o ClickUp não tem tipo nativo nesse export). */
export function guessTypePrefix(name: string, tags: string[]): string {
  const t = tags.map((x) => x.toLowerCase())
  const n = name.toUpperCase()
  if (t.includes('epic') || /\[EPIC|ÉPICO|\bEPIC\b/.test(n)) return 'EPIC'
  if (t.includes('bug') || /\[BUG|BUGFIX|\bBUG\b/.test(n)) return 'BUG'
  if (t.includes('user story') || /USER STORY|\[US\]|^US ?-?\d/.test(n)) return 'US'
  if (t.includes('feature') || /\[FEATURE|\[FT\]|\bFT ?\d/.test(n)) return 'FEAT'
  if (/\[IMPROVEMENT|MELHORIA/.test(n)) return 'MEL'
  if (t.includes('qa') || t.some((x) => x.startsWith('testes')) || /^QA\b|\bTESTES?\b/.test(n)) return 'QA'
  if (t.includes('documentação') || /DOCUMENTA/.test(n)) return 'DOC'
  return 'TASK'
}

const CLICKUP_PRIORITY: Record<string, TaskPriority> = { urgent: 'critical', high: 'high', normal: 'normal', low: 'low' }
const TAG_PALETTE = ['#0f73ac', '#3a7f6b', '#b3402a', '#5a6d9c', '#a8761b', '#2f9fb3', '#7a5c86', '#6b7f8a']

function clickUpToPlan(data: z.infer<typeof clickupSchema>, importerEmail: string): ImportPlan {
  const emailByMember = new Map(data.members.map((m) => [String(m.id), m.email.toLowerCase()]))
  const nameByMember = new Map(data.members.map((m) => [String(m.id), m.name]))

  // Lista solta vira projeto; listas de uma subpasta viram UM projeto com listas.
  const targets = new Map<string, { project: string; list: string | null; folder: string }>()
  for (const space of data.spaces) {
    for (const list of space.lists ?? []) targets.set(String(list.id), { project: list.name === 'List' ? space.name : list.name, list: null, folder: space.name })
    for (const folder of space.folders ?? []) {
      for (const list of folder.lists ?? []) targets.set(String(list.id), { project: list.name, list: null, folder: folder.name })
      for (const sub of folder.subfolders ?? []) {
        for (const list of sub.lists ?? []) targets.set(String(list.id), { project: sub.name, list: list.name, folder: `${folder.name} › ${sub.name}` })
      }
    }
  }

  const projects = new Map<string, PlanProject>()
  for (const task of [...data.tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    const target = targets.get(task.list_id) ?? { project: `Lista ${task.list_id}`, list: null, folder: 'sem pasta' }
    let project = projects.get(target.project)
    if (!project) {
      project = {
        name: target.project,
        description: `Importado do ClickUp (pasta "${target.folder}").`,
        startDate: null, targetDate: null,
        statuses: [...DEFAULT_STATUS_ROWS],
        types: DEFAULT_TASK_TYPES.map((t) => ({ ...t })),
        lists: [], sprints: [], tags: [], members: [], tasks: [], keepNumbers: false,
      }
      projects.set(target.project, project)
    }
    const status = mapClickUpStatus(task.status)
    if (!project.statuses.some((s) => s.name === status.name)) project.statuses.push(status)
    if (target.list && !project.lists.includes(target.list)) project.lists.push(target.list)
    for (const tag of task.tags) if (!project.tags.some((t) => t.name === tag)) project.tags.push({ name: tag, color: TAG_PALETTE[project.tags.length % TAG_PALETTE.length] })

    const assigneeEmails: string[] = []
    const assigneeNames: Record<string, string> = {}
    const missingAssignees: string[] = []
    for (const a of task.assignees) {
      const email = emailByMember.get(String(a.id))
      if (email) { assigneeEmails.push(email); assigneeNames[email] = a.name ?? nameByMember.get(String(a.id)) ?? email }
      else missingAssignees.push(a.name ?? nameByMember.get(String(a.id)) ?? String(a.id))
    }
    for (const email of assigneeEmails) if (!project.members.some((m) => m.email === email)) project.members.push({ email, role: 'member' })

    const closed = task.date_closed ? new Date(task.date_closed) : null
    project.tasks.push({
      typePrefix: guessTypePrefix(task.name, task.tags),
      title: task.name.slice(0, 500),
      description: [
        `Importado do ClickUp${task.url ? ` — ${task.url}` : ''}`,
        `Status no ClickUp: ${task.status}`,
        closed ? `Concluída no ClickUp em ${closed.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.` : null,
      ].filter(Boolean).join('\n'),
      statusName: status.name,
      listName: target.list,
      sprintName: null,
      priority: CLICKUP_PRIORITY[task.priority ?? ''] ?? 'none',
      assigneeEmails, assigneeNames, missingAssignees,
      startDate: null,
      dueDate: task.due_date ?? null,
      storyPoints: null, isMilestone: false, archivedAt: null, parentSeq: null,
      tags: task.tags, checklist: [], comments: [],
    })
  }
  for (const p of projects.values()) {
    p.statuses.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category])
    if (!p.members.some((m) => m.email === importerEmail)) p.members.unshift({ email: importerEmail, role: 'owner' })
  }
  return { format: 'clickup', projects: [...projects.values()] }
}

function toPlan(raw: unknown, importerEmail: string): ImportPlan {
  if (raw && typeof raw === 'object' && (raw as any).format === BACKUP_FORMAT) {
    const parsed = backupSchema.safeParse(raw)
    if (!parsed.success) throw new AppError(400, `Backup inválido: ${parsed.error.issues[0]?.path.join('.')} — ${parsed.error.issues[0]?.message}`, 'INVALID_BACKUP')
    return backupToPlan(parsed.data)
  }
  if (raw && typeof raw === 'object' && (raw as any).source === 'ClickUp') {
    const parsed = clickupSchema.safeParse(raw)
    if (!parsed.success) throw new AppError(400, `Export do ClickUp inválido: ${parsed.error.issues[0]?.path.join('.')} — ${parsed.error.issues[0]?.message}`, 'INVALID_BACKUP')
    return clickUpToPlan(parsed.data, importerEmail)
  }
  throw new AppError(400, 'Arquivo não reconhecido: envie um backup exportado pelo ISA ou o export do ClickUp.', 'UNKNOWN_FORMAT')
}

// ---------------------------------------------------------------------------
// Quem pode entrar no projeto
// ---------------------------------------------------------------------------

/** E-mails do arquivo → usuários ativos que usam Projetos. Os demais ficam de fora. */
async function resolvePeople(emails: string[]) {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))]
  const users = await prisma.user.findMany({
    where: { email: { in: unique, mode: 'insensitive' }, active: true, deleted_at: null },
    select: { id: true, email: true, name: true, role: true },
  })
  const eligible = new Map<string, { id: string; name: string }>()
  for (const u of users) {
    if ((await getEffectiveModules(u.id, u.role)).projects) eligible.set(u.email.toLowerCase(), { id: u.id, name: u.name })
  }
  return { eligible, missing: unique.filter((e) => !eligible.has(e)) }
}

function planEmails(plan: ImportPlan) {
  return plan.projects.flatMap((p) => [
    ...p.members.map((m) => m.email),
    ...p.tasks.flatMap((t) => [...t.assigneeEmails, ...t.comments.map((c) => c.authorEmail)]),
  ])
}

// ---------------------------------------------------------------------------
// Pré-visualizar e importar
// ---------------------------------------------------------------------------

export async function previewImport(importer: { id: string; email: string }, raw: unknown) {
  const plan = toPlan(raw, importer.email.toLowerCase())
  const { eligible, missing } = await resolvePeople(planEmails(plan))
  // Quem fica de fora aparece pelo nome (quem importa reconhece a pessoa, não o e-mail).
  const names = new Map<string, string>()
  for (const p of plan.projects) for (const t of p.tasks) for (const [e, n] of Object.entries(t.assigneeNames ?? {})) names.set(e.toLowerCase(), n)
  return {
    format: plan.format,
    projects: plan.projects.map((p) => ({
      name: p.name,
      tasks: p.tasks.length,
      statuses: p.statuses.map((s) => s.name),
      lists: p.lists,
      members: p.members.filter((m) => eligible.has(m.email.toLowerCase())).length,
    })),
    totalTasks: plan.projects.reduce((n, p) => n + p.tasks.length, 0),
    peopleFound: [...eligible.values()].map((u) => u.name),
    peopleMissing: missing.map((e) => (names.get(e) ? `${names.get(e)} (${e})` : e)),
    unmappedAssignees: [...new Set(plan.projects.flatMap((p) => p.tasks.flatMap((t) => t.missingAssignees)))],
  }
}

export async function runImport(importer: { id: string; email: string }, raw: unknown) {
  const plan = toPlan(raw, importer.email.toLowerCase())
  const { eligible } = await resolvePeople(planEmails(plan))
  const created: Array<{ id: string; name: string; tasks: number }> = []

  for (const p of plan.projects) {
    const projectId = await importProject(p, importer.id, eligible)
    created.push({ id: projectId, name: p.name, tasks: p.tasks.length })
  }
  await createAuditLog({
    userId: importer.id,
    action: 'PROJECTS_IMPORT',
    resource: 'PROJECT',
    details: { format: plan.format, projects: created.map((c) => ({ id: c.id, name: c.name, tasks: c.tasks })) },
  })
  return { format: plan.format, projects: created }
}

async function importProject(p: PlanProject, importerId: string, eligible: Map<string, { id: string; name: string }>) {
  const now = new Date()
  const userOf = (email: string) => eligible.get(email.toLowerCase())?.id
  const date = (s: string | null) => (s ? new Date(s) : null)

  return prisma.$transaction(async (tx) => {
    const projectId = randomUUID()

    // Membros: importador é dono; os demais só se usam o módulo Projetos.
    const members = new Map<string, ProjectMemberRole>([[importerId, 'owner']])
    for (const m of p.members) {
      const id = userOf(m.email)
      if (id && !members.has(id)) members.set(id, m.role === 'owner' ? 'manager' : m.role)
    }
    for (const t of p.tasks) for (const e of t.assigneeEmails) { const id = userOf(e); if (id && !members.has(id)) members.set(id, 'member') }

    const statusId = new Map(p.statuses.map((s) => [s.name, randomUUID()]))
    const typeId = new Map(p.types.map((t) => [t.prefix, randomUUID()]))
    const listId = new Map(p.lists.map((l) => [l, randomUUID()]))
    const sprintId = new Map(p.sprints.map((s) => [s.name, randomUUID()]))
    const tagId = new Map(p.tags.map((t) => [t.name, randomUUID()]))

    // Numeração: backup mantém #seq e BUG-12; ClickUp numera na ordem do arquivo.
    const typeCounter = new Map<string, number>()
    const taskRows = p.tasks.map((t, i) => {
      const seq = p.keepNumbers && t.seq ? t.seq : i + 1
      const number = p.keepNumbers && t.typeNumber ? t.typeNumber : (typeCounter.get(t.typePrefix) ?? 0) + 1
      typeCounter.set(t.typePrefix, Math.max(typeCounter.get(t.typePrefix) ?? 0, number))
      const assignees = t.assigneeEmails.map(userOf).filter((x): x is string => !!x)
      const missing = [...t.missingAssignees, ...t.assigneeEmails.filter((e) => !userOf(e)).map((e) => (t.assigneeNames?.[e] ? `${t.assigneeNames[e]} (${e})` : e))]
      const description = missing.length
        ? `${t.description ?? ''}${t.description ? '\n' : ''}Responsável no arquivo sem acesso ao módulo Projetos: ${missing.join(', ')}.`
        : t.description
      return { t, id: randomUUID(), seq, number, assignees, description }
    })
    const seqToId = new Map(taskRows.map((r) => [r.seq, r.id]))
    const maxSeq = taskRows.reduce((m, r) => Math.max(m, r.seq), 0)

    await tx.project.create({
      data: {
        id: projectId, name: p.name, description: p.description, privacy: 'restricted', owner_id: importerId,
        next_task_seq: maxSeq + 1,
        allow_multiple_assignees: taskRows.some((r) => r.assignees.length > 1),
        start_date: date(p.startDate), target_date: date(p.targetDate),
      },
    })
    await tx.projectMember.createMany({ data: [...members].map(([user_id, role]) => ({ project_id: projectId, user_id, role })) })
    await tx.projectStatus.createMany({ data: p.statuses.map((s, position) => ({ id: statusId.get(s.name)!, project_id: projectId, name: s.name, color: s.color, category: s.category, position })) })
    await tx.taskType.createMany({
      data: p.types.map((t, position) => ({
        id: typeId.get(t.prefix)!, project_id: projectId, name: t.name, prefix: t.prefix, icon: t.icon, color: t.color, position,
        next_number: (typeCounter.get(t.prefix) ?? 0) + 1,
      })),
    })
    if (p.lists.length) await tx.projectList.createMany({ data: p.lists.map((name, position) => ({ id: listId.get(name)!, project_id: projectId, name, position })) })
    if (p.sprints.length) await tx.sprint.createMany({ data: p.sprints.map((s, position) => ({ id: sprintId.get(s.name)!, project_id: projectId, name: s.name, status: s.status, start_date: date(s.startDate), end_date: date(s.endDate), position })) })
    if (p.tags.length) await tx.tag.createMany({ data: p.tags.map((t) => ({ id: tagId.get(t.name)!, project_id: projectId, name: t.name, color: t.color })) })

    await tx.task.createMany({
      data: taskRows.map(({ t, id, seq, number, assignees, description }, position) => ({
        id, project_id: projectId, seq,
        task_type_id: typeId.get(t.typePrefix)!, type_number: number, key: buildKey(t.typePrefix, number),
        status_id: statusId.get(t.statusName)!,
        list_id: t.listName ? listId.get(t.listName) ?? null : null,
        sprint_id: t.sprintName ? sprintId.get(t.sprintName) ?? null : null,
        title: t.title, description, priority: t.priority,
        assignee_id: assignees[0] ?? null, creator_id: importerId,
        start_date: date(t.startDate), due_date: date(t.dueDate),
        story_points: t.storyPoints, is_milestone: t.isMilestone, archived_at: date(t.archivedAt),
        position,
      })),
    })
    // Hierarquia depois que todas existem (a task-pai pode vir depois no arquivo).
    for (const r of taskRows) {
      const parentId = r.t.parentSeq ? seqToId.get(r.t.parentSeq) : undefined
      if (parentId && parentId !== r.id) await tx.task.update({ where: { id: r.id }, data: { parent_id: parentId } })
    }
    await tx.taskAssignee.createMany({ data: taskRows.flatMap((r) => r.assignees.map((user_id) => ({ task_id: r.id, user_id }))), skipDuplicates: true })
    await tx.taskTag.createMany({ data: taskRows.flatMap((r) => r.t.tags.filter((n) => tagId.has(n)).map((n) => ({ task_id: r.id, tag_id: tagId.get(n)! }))), skipDuplicates: true })
    await tx.checklistItem.createMany({ data: taskRows.flatMap((r) => r.t.checklist.map((c, position) => ({ task_id: r.id, text: c.text, done: c.done, position }))) })
    // Comentário de quem não está no sistema, ou de arquivo sem assinatura válida (o autor seria só
    // o que o arquivo diz), fica no nome do importador, com o autor original no texto.
    await tx.taskComment.createMany({
      data: taskRows.flatMap((r) => r.t.comments.map((c) => {
        const found = userOf(c.authorEmail)
        const author = p.commentAuthorsVerified || found === importerId ? found : undefined
        return { task_id: r.id, author_id: author ?? importerId, body: author ? c.body : `[${c.authorEmail}] ${c.body}`, created_at: new Date(c.createdAt) }
      })),
    })
    await tx.taskActivity.createMany({ data: taskRows.map((r) => ({ task_id: r.id, actor_id: importerId, type: 'created' as const, created_at: now })) })
    return projectId
  }, { timeout: 120_000, maxWait: 10_000 })
}
