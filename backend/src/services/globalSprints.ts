import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { AppError } from '../middlewares/errorHandler'
import { assertSprintDates, createSprintSchema, updateSprintSchema } from './sprints'
import { loadProjectTime } from './taskTime'
import { sprintBurndown } from './projectInsights'
import { SYSTEM_USER_ID } from '../utils/constants'

/**
 * Calendário de sprints de um Gerente. Cada sprint global é replicado como um
 * Sprint comum (global_sprint_id preenchido) em todo projeto que segue o
 * Gerente (projects.sprint_source_id) — board, filtros, insights e backup
 * continuam lendo só `sprints`, sem saber que existe calendário global.
 */

type Actor = { sub: string; role: string }

const SYNCED_FIELDS = { name: true, status: true, start_date: true, end_date: true, position: true } as const

/** Gerente mexe no próprio calendário; admin em qualquer um. */
function assertCanManage(actor: Actor, ownerId: string) {
  if (actor.role !== 'admin' && actor.sub !== ownerId) {
    throw new AppError(403, 'Só o próprio Gerente (ou um admin) altera este calendário de sprints.', 'GLOBAL_SPRINT_FORBIDDEN')
  }
}

async function getOrThrow(id: string) {
  const sprint = await prisma.globalSprint.findUnique({ where: { id } })
  if (!sprint) throw new AppError(404, 'Sprint global não encontrado', 'NOT_FOUND')
  return sprint
}

const CHAIN_MAX_DEPTH = 10

/**
 * Calendários que a pessoa pode ver e escolher: o próprio (Gerente), os dos
 * Gerentes acima dela no organograma e os que algum projeto que ela enxerga já
 * segue. Admin: todos (null). Antes qualquer um lia — e prendia projeto — no
 * calendário de qualquer Gerente.
 */
export async function allowedCalendarOwners(userId: string): Promise<Set<string> | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, manager_id: true } })
  if (me?.role === 'admin') return null
  const owners = new Set<string>()
  if (me?.role === 'manager') owners.add(userId)
  const seen = new Set([userId])
  let next = me?.manager_id ?? null
  for (let depth = 0; next && !seen.has(next) && depth < CHAIN_MAX_DEPTH; depth++) {
    seen.add(next)
    owners.add(next)
    next = (await prisma.user.findUnique({ where: { id: next }, select: { manager_id: true } }))?.manager_id ?? null
  }
  const followed = await prisma.project.findMany({
    where: { ...(await visibleProjectsWhere(userId)), sprint_source_id: { not: null } },
    select: { sprint_source_id: true },
    distinct: ['sprint_source_id'],
  })
  for (const p of followed) owners.add(p.sprint_source_id!)
  return owners
}

async function assertCanSeeCalendar(userId: string, ownerId: string) {
  const allowed = await allowedCalendarOwners(userId)
  if (allowed && !allowed.has(ownerId)) {
    throw new AppError(403, 'Este calendário de sprints é de outro Gerente. Você vê o seu, os dos Gerentes acima de você e os que seus projetos seguem.', 'GLOBAL_SPRINT_NOT_VISIBLE')
  }
}

/** Gerentes e admins ativos cujo calendário a pessoa pode ver (e escolher nas Configurações do projeto). */
export async function listOwners(userId: string) {
  const allowed = await allowedCalendarOwners(userId)
  return prisma.user.findMany({
    where: {
      role: { in: ['manager', 'admin'] }, active: true, deleted_at: null,
      id: allowed ? { in: [...allowed].filter((id) => id !== SYSTEM_USER_ID) } : { not: SYSTEM_USER_ID },
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })
}

export async function listGlobalSprints(userId: string, ownerId: string) {
  await assertCanSeeCalendar(userId, ownerId)
  return prisma.globalSprint.findMany({ where: { owner_id: ownerId }, orderBy: { position: 'asc' } })
}

export async function createGlobalSprint(actor: Actor, ownerId: string, data: z.infer<typeof createSprintSchema>) {
  assertCanManage(actor, ownerId)
  assertSprintDates(data.startDate, data.endDate)
  return prisma.$transaction(async (tx) => {
    const count = await tx.globalSprint.count({ where: { owner_id: ownerId } })
    const sprint = await tx.globalSprint.create({
      data: {
        owner_id: ownerId,
        name: data.name,
        start_date: data.startDate ? new Date(data.startDate) : null,
        end_date: data.endDate ? new Date(data.endDate) : null,
        position: count,
      },
    })
    const followers = await tx.project.findMany({ where: { sprint_source_id: ownerId }, select: { id: true } })
    await tx.sprint.createMany({ data: followers.map((p) => copyOf(sprint, p.id)) })
    return sprint
  })
}

function copyOf(g: { id: string; name: string; status: any; start_date: Date | null; end_date: Date | null; position: number }, projectId: string): Prisma.SprintCreateManyInput {
  return { project_id: projectId, global_sprint_id: g.id, name: g.name, status: g.status, start_date: g.start_date, end_date: g.end_date, position: g.position }
}

async function saveAndPropagate(id: string, data: Prisma.GlobalSprintUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const sprint = await tx.globalSprint.update({ where: { id }, data })
    const synced = Object.fromEntries(Object.keys(SYNCED_FIELDS).map((k) => [k, (sprint as any)[k]]))
    await tx.sprint.updateMany({ where: { global_sprint_id: id }, data: synced })
    return sprint
  })
}

export async function updateGlobalSprint(actor: Actor, id: string, data: z.infer<typeof updateSprintSchema>) {
  const atual = await getOrThrow(id)
  assertCanManage(actor, atual.owner_id)
  assertSprintDates(
    data.startDate !== undefined ? data.startDate : atual.start_date,
    data.endDate !== undefined ? data.endDate : atual.end_date,
  )
  return saveAndPropagate(id, {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.startDate !== undefined ? { start_date: data.startDate ? new Date(data.startDate) : null } : {}),
    ...(data.endDate !== undefined ? { end_date: data.endDate ? new Date(data.endDate) : null } : {}),
  })
}

/** Mesma regra do sprint de projeto: um ativo por vez no calendário, sem encerrar o outro sozinho. */
export async function startGlobalSprint(actor: Actor, id: string) {
  const sprint = await getOrThrow(id)
  assertCanManage(actor, sprint.owner_id)
  const active = await prisma.globalSprint.findFirst({ where: { owner_id: sprint.owner_id, status: 'active', id: { not: id } } })
  if (active) throw new AppError(409, 'Já existe um sprint ativo neste calendário. Encerre-o antes de iniciar outro.', 'SPRINT_ALREADY_ACTIVE')
  return saveAndPropagate(id, { status: 'active' })
}

export async function completeGlobalSprint(actor: Actor, id: string) {
  assertCanManage(actor, (await getOrThrow(id)).owner_id)
  return saveAndPropagate(id, { status: 'completed' })
}

/** Exclusão real, como no sprint de projeto: as cópias somem (cascade) e as tasks ficam sem sprint. */
export async function deleteGlobalSprint(actor: Actor, id: string) {
  assertCanManage(actor, (await getOrThrow(id)).owner_id)
  await prisma.globalSprint.delete({ where: { id } })
}

/**
 * Troca a origem dos sprints do projeto. Nada é apagado: os sprints próprios
 * ficam guardados (voltam ao escolher "próprios") e as cópias de um calendário
 * já seguido antes são reaproveitadas — só cria as que faltam.
 */
export async function setProjectSprintSource(projectId: string, ownerId: string | null, actorId?: string) {
  if (ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerId, role: { in: ['manager', 'admin'] }, deleted_at: null }, select: { id: true } })
    if (!owner) throw new AppError(400, 'O calendário escolhido não é de um Gerente.', 'INVALID_SPRINT_SOURCE')
    // Prender o projeto ao calendário de outro Gerente o deixa no controle das
    // sprints dele: só calendários que quem configura pode ver (manter o atual vale).
    const current = await prisma.project.findUnique({ where: { id: projectId }, select: { sprint_source_id: true } })
    if (actorId && current?.sprint_source_id !== ownerId) await assertCanSeeCalendar(actorId, ownerId)
  }
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id: projectId }, data: { sprint_source_id: ownerId } })
    if (ownerId) {
      const globals = await tx.globalSprint.findMany({ where: { owner_id: ownerId } })
      const existing = await tx.sprint.findMany({ where: { project_id: projectId, global_sprint_id: { in: globals.map((g) => g.id) } }, select: { global_sprint_id: true } })
      const have = new Set(existing.map((s) => s.global_sprint_id))
      await tx.sprint.createMany({ data: globals.filter((g) => !have.has(g.id)).map((g) => copyOf(g, projectId)) })
    }
    return project
  })
}

/**
 * Painel por sprint: tasks de todos os projetos (que o usuário enxerga) ligados
 * a este sprint global. Projeto sem acesso não aparece nem como contagem.
 */
export async function getGlobalSprintOverview(userId: string, id: string) {
  const sprint = await getOrThrow(id)
  await assertCanSeeCalendar(userId, sprint.owner_id)
  const copies = await prisma.sprint.findMany({
    where: { global_sprint_id: id, project: { archived_at: null, ...(await visibleProjectsWhere(userId)) } },
    select: {
      id: true,
      project: { select: { id: true, name: true, color: true } },
      tasks: {
        where: { archived_at: null },
        orderBy: [{ status: { position: 'asc' } }, { position: 'asc' }],
        select: {
          id: true, seq: true, key: true, title: true, priority: true, story_points: true, due_date: true,
          status: { select: { id: true, name: true, color: true, category: true } },
          assignee: { select: { id: true, name: true, avatar: true } },
        },
      },
    },
  })
  const projects = copies
    .map((c) => ({ ...c.project, sprint_id: c.id, tasks: c.tasks }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  // Burndown somando as cópias dos projetos visíveis (precisa de datas na sprint).
  const burndown = sprint.start_date && sprint.end_date && copies.length
    ? sprintBurndown(await loadProjectTime(copies.map((c) => c.project.id)), new Set(copies.map((c) => c.id)), { id: sprint.id, name: sprint.name, start: sprint.start_date, end: sprint.end_date })
    : null
  return { sprint, projects, burndown }
}
