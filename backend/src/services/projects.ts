import { leaveProjectRoom } from '../config/socket'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { visibleProjectsWhere, isSystemAdmin } from './projectAccess'
import { getEffectiveModules } from './moduleAccess'
import { AppError } from '../middlewares/errorHandler'
import { DEFAULT_TASK_TYPES } from './taskTypeKeys'
import { setProjectSprintSource } from './globalSprints'
import { fireProjectWebhook } from './projectWebhooks'
import { releaseTicketsOfTask } from './ticketTaskLink'
import { overdueCutoff } from './projectInsights'
import { SYSTEM_USER_ID } from '../utils/constants'

const projectColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #rrggbb)').nullable().optional()

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Nome do projeto é obrigatório'),
  description: z.string().nullable().optional(),
  privacy: z.enum(['private', 'organization', 'restricted']).default('organization'),
  color: projectColor,
  startDate: z.string().datetime().nullable().optional(),
  targetDate: z.string().datetime().nullable().optional(),
})

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  privacy: z.enum(['private', 'organization', 'restricted']).optional(),
  color: projectColor,
  startDate: z.string().datetime().nullable().optional(),
  targetDate: z.string().datetime().nullable().optional(),
  /** null = sprints próprios; id do Gerente = segue o calendário global dele. */
  sprintSourceId: z.string().uuid().nullable().optional(),
})

const DEFAULT_STATUSES: Array<{ name: string; color: string; category: 'backlog' | 'open' | 'in_progress' | 'in_review' | 'done'; position: number }> = [
  { name: 'A Fazer', color: '#8fa3af', category: 'open', position: 0 },
  { name: 'Em Progresso', color: '#0f73ac', category: 'in_progress', position: 1 },
  { name: 'Concluído', color: '#3a7f6b', category: 'done', position: 2 },
]

export async function createProject(ownerId: string, data: z.infer<typeof createProjectSchema>) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        privacy: data.privacy,
        color: data.color ?? null,
        owner_id: ownerId,
        start_date: data.startDate ? new Date(data.startDate) : null,
        target_date: data.targetDate ? new Date(data.targetDate) : null,
      },
    })
    await tx.projectMember.create({
      data: { project_id: project.id, user_id: ownerId, role: 'owner' },
    })
    await tx.projectStatus.createMany({
      data: DEFAULT_STATUSES.map((s) => ({ ...s, project_id: project.id })),
    })
    await tx.taskType.createMany({
      data: DEFAULT_TASK_TYPES.map((t, position) => ({ ...t, position, project_id: project.id })),
    })
    return project
  })
}

export async function listProjectsForUser(userId: string) {
  const admin = await isSystemAdmin(userId)
  const projects = await prisma.project.findMany({
    where: { ...(await visibleProjectsWhere(userId)), archived_at: null },
    orderBy: { created_at: 'desc' },
    include: { _count: { select: { members: true } }, members: { where: { user_id: userId }, select: { role: true } } },
  })
  if (projects.length === 0) return []

  // Números do card do catálogo numa consulta só (subtasks contam como trabalho também).
  const cutoff = overdueCutoff()
  const rows = await prisma.$queryRaw<Array<{ project_id: string; total: bigint; done: bigint; open: bigint; overdue: bigint }>>`
    SELECT t."project_id",
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE s."category" = 'done') AS done,
           COUNT(*) FILTER (WHERE s."category" NOT IN ('done', 'cancelled')) AS open,
           COUNT(*) FILTER (WHERE s."category" NOT IN ('done', 'cancelled') AND t."due_date" < ${cutoff}) AS overdue
    FROM "tasks" t JOIN "project_statuses" s ON s."id" = t."status_id"
    WHERE t."project_id" IN (${Prisma.join(projects.map((p) => p.id))}) AND t."archived_at" IS NULL
    GROUP BY t."project_id"`
  const stats = new Map(rows.map((r) => [r.project_id, r]))

  // `_count` não sobrevive à camelização da resposta: achatado em campos nomeados.
  return projects.map(({ _count, members, ...project }) => {
    const r = stats.get(project.id)
    const total = Number(r?.total ?? 0)
    const done = Number(r?.done ?? 0)
    return {
      ...project,
      member_count: _count.members,
      // Visível só porque alguém da equipe do gerente participa (leitura).
      team_only: members.length === 0 && !admin,
      // Mesmo papel efetivo do GET /:id: admin conta como dono, equipe do gerente como leitor.
      my_role: admin ? 'owner' : members[0]?.role ?? 'viewer',
      total_tasks: total,
      done_tasks: done,
      open_tasks: Number(r?.open ?? 0),
      overdue_tasks: Number(r?.overdue ?? 0),
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
    }
  })
}

export async function getProjectById(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { include: { user: { select: { id: true, name: true, avatar: true } } } } },
  })
}

export async function updateProject(projectId: string, data: z.infer<typeof updateProjectSchema>, actorId?: string) {
  if (data.sprintSourceId !== undefined) await setProjectSprintSource(projectId, data.sprintSourceId, actorId)
  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.privacy !== undefined ? { privacy: data.privacy } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.startDate !== undefined ? { start_date: data.startDate ? new Date(data.startDate) : null } : {}),
      ...(data.targetDate !== undefined ? { target_date: data.targetDate ? new Date(data.targetDate) : null } : {}),
    },
  })
  // Só os nomes dos campos enviados: o destino relê o projeto se precisar do valor.
  const changed = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined)
  if (changed.length > 0) fireProjectWebhook('project.updated', projectId, actorId, { changes: changed })
  return project
}

/** Antes de arquivar, chamados ativos nas tasks do projeto voltam ao atendimento (nunca ficam com SLA pausado para sempre). */
export async function archiveProject(projectId: string, actorId: string = SYSTEM_USER_ID) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } })
  const linked = await prisma.ticket.findMany({
    where: { project_task: { project_id: projectId }, status: 'pending', pending_reason: 'pending_project', deleted_at: null },
    select: { project_task_id: true },
    distinct: ['project_task_id'],
  })
  for (const { project_task_id } of linked) {
    if (project_task_id) await releaseTicketsOfTask(project_task_id, actorId, `Projeto "${project.name}" foi arquivado — chamado volta ao atendimento.`)
  }
  return prisma.project.update({ where: { id: projectId }, data: { archived_at: new Date() } })
}

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'manager', 'member', 'viewer']).default('member'),
})

type MemberRole = 'owner' | 'manager' | 'member' | 'viewer'

// Só o dono dá/tira papel de dono; projeto nunca fica sem dono.
function assertCanTouchOwner(actorRole: MemberRole | undefined) {
  if (actorRole !== 'owner') throw new AppError(403, 'Só o dono do projeto define ou remove donos.', 'OWNER_ONLY')
}
async function assertNotLastOwner(projectId: string, userId: string) {
  const owners = await prisma.projectMember.count({ where: { project_id: projectId, role: 'owner' } })
  const isOwner = await prisma.projectMember.count({ where: { project_id: projectId, user_id: userId, role: 'owner' } })
  if (isOwner && owners <= 1) throw new AppError(400, 'O projeto precisa de pelo menos um dono. Defina outro dono antes.', 'LAST_OWNER')
}

export async function addMember(projectId: string, data: z.infer<typeof addMemberSchema>, actorRole?: MemberRole, actorId?: string) {
  if (data.role === 'owner') assertCanTouchOwner(actorRole)
  // Só entra quem pode usar o módulo: ativo, não cliente, com Projetos habilitado.
  const target = await prisma.user.findUnique({ where: { id: data.userId }, select: { name: true, role: true, active: true, deleted_at: true } })
  if (!target || !target.active || target.deleted_at || !(await getEffectiveModules(data.userId, target.role)).projects) {
    throw new AppError(400, 'Esta pessoa não tem acesso ao módulo Projetos (inativa, cliente ou módulo desligado).', 'USER_WITHOUT_PROJECTS_MODULE')
  }
  const member = await prisma.projectMember.create({
    data: { project_id: projectId, user_id: data.userId, role: data.role },
  })
  fireProjectWebhook('project.member_added', projectId, actorId, { member: { userId: data.userId, name: target.name, role: data.role } })
  return member
}

export async function listMembers(projectId: string) {
  return prisma.projectMember.findMany({
    where: { project_id: projectId },
    include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
  })
}

export async function updateMemberRole(projectId: string, userId: string, role: MemberRole, actorRole?: MemberRole) {
  assertCanTouchOwner(actorRole) // a rota já é só de dono; reforço aqui
  if (role !== 'owner') await assertNotLastOwner(projectId, userId)
  return prisma.projectMember.update({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    data: { role },
  })
}

export async function removeMember(projectId: string, userId: string, actorRole?: MemberRole, actorId?: string) {
  const target = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } }, select: { role: true, user: { select: { name: true } } } })
  if (target?.role === 'owner') {
    assertCanTouchOwner(actorRole)
    await assertNotLastOwner(projectId, userId)
  }
  await prisma.projectMember.delete({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
  })
  leaveProjectRoom(userId, projectId)
  fireProjectWebhook('project.member_removed', projectId, actorId, { member: { userId, name: target?.user.name ?? null } })
}
