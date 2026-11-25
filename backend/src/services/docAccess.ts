import { Prisma, type DocSpaceRole } from '@prisma/client'
import prisma from '../config/prisma'
import { can } from '../access/can'
import { AppError } from '../middlewares/errorHandler'
import { getEffectiveModules } from './moduleAccess'

/**
 * Regra de acesso a Documentos: o papel vem do espaço e vale para todas as páginas dele.
 * Membro usa o próprio papel; admin é dono de tudo; espaço interno é leitura para quem
 * tem o módulo; o resto não existe (404). Espaço arquivado fecha para todos.
 */
export type DocRole = DocSpaceRole
export interface DocActor { id: string; role: string }

const RANK: Record<DocRole, number> = { viewer: 1, editor: 2, owner: 3 }
export const atLeast = (role: DocRole | null | undefined, min: DocRole) => !!role && RANK[role] >= RANK[min]

const spaceNotFound = () => new AppError(404, 'Espaço não encontrado', 'NOT_FOUND')
const pageNotFound = () => new AppError(404, 'Página não encontrada', 'NOT_FOUND')

/** Pessoa com o módulo ligado agora; null = sem acesso. Para o tempo real, que não passa pelo requireCap. */
export async function docActor(userId: string): Promise<DocActor | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true, deleted_at: true } })
  if (!user || !user.active || user.deleted_at) return null
  const modules = await getEffectiveModules(userId, user.role)
  return can({ sub: userId, role: user.role, modules }, 'documents.use') ? { id: userId, role: user.role } : null
}

type SpaceForRole = { visibility: string; members: { role: DocRole }[] }

function roleOf(space: SpaceForRole, actor: DocActor): DocRole | null {
  if (actor.role === 'admin') return 'owner'
  if (space.members.length) return space.members[0].role
  return space.visibility === 'internal' ? 'viewer' : null
}

/** Papel efetivo no espaço; null = sem acesso, inexistente ou arquivado. */
export async function effectiveSpaceRole(spaceId: string, actor: DocActor, opts: { includeArchived?: boolean } = {}): Promise<DocRole | null> {
  const space = await prisma.docSpace.findUnique({
    where: { id: spaceId },
    select: { visibility: true, archived_at: true, members: { where: { user_id: actor.id }, select: { role: true } } },
  })
  if (!space || (space.archived_at && !opts.includeArchived)) return null
  return roleOf(space, actor)
}

/** Espaço com papel mínimo. Sem acesso = 404; papel menor = 403. */
export async function requireSpace(spaceId: string, actor: DocActor, min: DocRole = 'viewer', opts: { includeArchived?: boolean } = {}): Promise<DocRole> {
  const role = await effectiveSpaceRole(spaceId, actor, opts)
  if (!role) throw spaceNotFound()
  if (!atLeast(role, min)) throw new AppError(403, 'Sem permissão nesta ação', 'FORBIDDEN')
  return role
}

export const PAGE_META = {
  id: true, space_id: true, parent_id: true, title: true, icon: true, position: true, revision: true,
  created_by_id: true, updated_by_id: true, created_at: true, updated_at: true, deleted_at: true,
} satisfies Prisma.DocPageSelect
export type PageMeta = Prisma.DocPageGetPayload<{ select: typeof PAGE_META }>

/** Página (sem o conteúdo) com papel mínimo. `trashed` escolhe entre viva e na lixeira. */
export async function requirePage(pageId: string, actor: DocActor, min: DocRole = 'viewer', opts: { trashed?: boolean } = {}): Promise<{ page: PageMeta; role: DocRole }> {
  const page = await prisma.docPage.findUnique({ where: { id: pageId }, select: PAGE_META })
  if (!page || !!page.deleted_at !== !!opts.trashed) throw pageNotFound()
  const role = await effectiveSpaceRole(page.space_id, actor)
  if (!role) throw pageNotFound()
  if (!atLeast(role, min)) throw new AppError(403, 'Sem permissão nesta ação', 'FORBIDDEN')
  return { page, role }
}

/** Papel na página viva; null = sem acesso. Não lança (tempo real). */
export async function pageRole(pageId: string, actor: DocActor): Promise<{ role: DocRole; spaceId: string } | null> {
  const page = await prisma.docPage.findUnique({ where: { id: pageId }, select: { space_id: true, deleted_at: true } })
  if (!page || page.deleted_at) return null
  const role = await effectiveSpaceRole(page.space_id, actor)
  return role ? { role, spaceId: page.space_id } : null
}

/** Espaços ativos que a pessoa enxerga (`min` = editor/owner restringe ao papel). */
export function accessibleSpacesWhere(actor: DocActor, min: DocRole = 'viewer'): Prisma.DocSpaceWhereInput {
  if (actor.role === 'admin') return { archived_at: null }
  const roles = (Object.keys(RANK) as DocRole[]).filter(r => atLeast(r, min))
  const member: Prisma.DocSpaceWhereInput = { members: { some: { user_id: actor.id, role: { in: roles } } } }
  return { archived_at: null, ...(min === 'viewer' ? { OR: [{ visibility: 'internal' }, member] } : member) }
}

export async function accessibleSpaceIds(actor: DocActor, min: DocRole = 'viewer'): Promise<string[]> {
  return (await prisma.docSpace.findMany({ where: accessibleSpacesWhere(actor, min), select: { id: true } })).map(s => s.id)
}
