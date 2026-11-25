import { Prisma, ProjectMemberRole } from '@prisma/client'
import prisma from '../config/prisma'

/**
 * Regra de acesso a projetos: membros veem os seus; o admin vê e
 * gerencia todos, como owner, mesmo sem vínculo. O Gerente (role manager)
 * também vê, só leitura (viewer), os projetos em que alguém da equipe dele
 * (organograma, todos os níveis) é membro.
 */
async function systemRole(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role ?? null
}

export async function isSystemAdmin(userId: string) {
  return (await systemRole(userId)) === 'admin'
}

// shortcut: 1 consulta por nível (máx. TEAM_MAX_DEPTH); cachear por request se virar gargalo.
const TEAM_MAX_DEPTH = 6

/** Todos abaixo do gerente pelo manager_id, em qualquer nível; protege contra ciclo. */
export async function teamUserIds(managerId: string): Promise<string[]> {
  const seen = new Set<string>([managerId])
  let frontier = [managerId]
  for (let depth = 0; depth < TEAM_MAX_DEPTH && frontier.length > 0; depth++) {
    const next = await prisma.user.findMany({ where: { manager_id: { in: frontier }, deleted_at: null }, select: { id: true } })
    frontier = next.map((u) => u.id).filter((id) => !seen.has(id))
    for (const id of frontier) seen.add(id)
  }
  seen.delete(managerId)
  return [...seen]
}

/** Filtro de Project para "projetos que o usuário enxerga". Um único campo (members) para combinar com outros filtros. */
export async function visibleProjectsWhere(userId: string): Promise<Prisma.ProjectWhereInput> {
  const role = await systemRole(userId)
  if (role === 'admin') return {}
  if (role !== 'manager') return { members: { some: { user_id: userId } } }
  const team = await teamUserIds(userId)
  return { members: { some: { user_id: team.length ? { in: [userId, ...team] } : userId } } }
}

/** Papel efetivo no projeto; null = sem acesso (inclui projeto inexistente). */
export async function effectiveProjectRole(projectId: string, userId: string): Promise<ProjectMemberRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    select: { role: true },
  })
  if (member) return member.role
  const role = await systemRole(userId)
  if (role === 'admin') return (await prisma.project.count({ where: { id: projectId } })) ? 'owner' : null
  if (role !== 'manager') return null
  const team = await teamUserIds(userId)
  if (team.length === 0) return null
  const viaTeam = await prisma.projectMember.count({ where: { project_id: projectId, user_id: { in: team } } })
  return viaTeam > 0 ? 'viewer' : null
}
