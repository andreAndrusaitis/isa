/** Espaços de Documentos: cadastro, membros e busca de pessoas para compartilhar. */
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import type { AuditInfo } from '../utils/audit'
import { createAuditLog } from './audit'
import { cleanText } from './docContent'
import { accessibleSpacesWhere, requireSpace, type DocActor, type DocRole } from './docAccess'
import { documentsModuleUserIds, getEffectiveModules } from './moduleAccess'
import { emitSpacesChanged, emitTree, recheckDocAccess } from '../realtime/docs'

export const docText = (max: number) => z.string().transform(s => cleanText(s).trim()).pipe(z.string().max(max))
/** Emoji ou chave curta de ícone; vazio = sem ícone. */
export const docIcon = docText(16).transform(s => s || null).nullable()

const name = docText(120).refine(s => s.length > 0, 'Nome é obrigatório')
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Cor inválida').nullable()
const description = docText(500).transform(s => s || null).nullable()
const visibility = z.enum(['private', 'internal'])

export const createSpaceSchema = z.object({
  name, icon: docIcon.optional(), color: color.optional(), description: description.optional(), visibility: visibility.default('private'),
})
export const updateSpaceSchema = z.object({
  name: name.optional(), icon: docIcon.optional(), color: color.optional(), description: description.optional(),
  visibility: visibility.optional(), archived: z.literal(false).optional(), // false = desarquivar
})
export const memberRoleSchema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })

type Tx = Prisma.TransactionClient

/** Serializa mudanças de árvore e de membros de cada espaço (ordem fixa: sem impasse entre dois). */
export async function lockSpaces(tx: Tx, ...ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`doc_space:${id}`}))`
}

const spaceSelect = (actor: DocActor) => ({
  id: true, name: true, icon: true, color: true, description: true, visibility: true, archived_at: true, created_at: true, updated_at: true,
  created_by: { select: { id: true, name: true } },
  members: { where: { user_id: actor.id }, select: { role: true } },
  _count: { select: { members: true, pages: { where: { deleted_at: null } } } },
}) satisfies Prisma.DocSpaceSelect

type SpaceRow = Prisma.DocSpaceGetPayload<{ select: ReturnType<typeof spaceSelect> }>

function presentSpace({ members, _count, ...space }: SpaceRow, actor: DocActor) {
  const role: DocRole = actor.role === 'admin' ? 'owner' : members[0]?.role ?? 'viewer'
  return { ...space, role, is_member: members.length > 0, member_count: _count.members, page_count: _count.pages }
}

export async function listSpaces(actor: DocActor, archived = false) {
  const where: Prisma.DocSpaceWhereInput = archived
    ? { archived_at: { not: null }, ...(actor.role === 'admin' ? {} : { members: { some: { user_id: actor.id, role: 'owner' } } }) }
    : accessibleSpacesWhere(actor)
  const rows = await prisma.docSpace.findMany({ where, select: spaceSelect(actor), orderBy: { name: 'asc' } })
  return rows.map(r => presentSpace(r, actor))
}

export async function getSpace(actor: DocActor, spaceId: string) {
  // Arquivado só o dono abre (para desarquivar).
  const role = await requireSpace(spaceId, actor, 'viewer', { includeArchived: true })
  const row = await prisma.docSpace.findUniqueOrThrow({ where: { id: spaceId }, select: spaceSelect(actor) })
  if (row.archived_at && role !== 'owner') throw new AppError(404, 'Espaço não encontrado', 'NOT_FOUND')
  return presentSpace(row, actor)
}

export async function createSpace(actor: DocActor, body: unknown, audit: AuditInfo) {
  const data = createSpaceSchema.parse(body)
  const { id } = await prisma.docSpace.create({
    data: { ...data, created_by_id: actor.id, members: { create: { user_id: actor.id, role: 'owner' } } },
    select: { id: true },
  })
  await log(audit, 'CREATE_DOC_SPACE', id, { visibility: data.visibility })
  emitSpacesChanged(actor.id, id)
  return getSpace(actor, id)
}

export async function updateSpace(actor: DocActor, spaceId: string, body: unknown, audit: AuditInfo) {
  await requireSpace(spaceId, actor, 'owner', { includeArchived: true })
  const { archived, ...data } = updateSpaceSchema.parse(body)
  await prisma.docSpace.update({ where: { id: spaceId }, data: { ...data, ...(archived === false ? { archived_at: null } : {}) } })
  await log(audit, 'UPDATE_DOC_SPACE', spaceId, { fields: Object.keys({ ...data, ...(archived === false ? { archived } : {}) }) })
  // Interno → privado tira quem só lia por ser da equipe.
  if (data.visibility) await recheckDocAccess({ spaceId })
  emitTree(spaceId, 'space')
  await notifyMembers(spaceId)
  return getSpace(actor, spaceId)
}

export async function archiveSpace(actor: DocActor, spaceId: string, audit: AuditInfo) {
  await requireSpace(spaceId, actor, 'owner')
  await prisma.docSpace.update({ where: { id: spaceId }, data: { archived_at: new Date() } })
  await log(audit, 'ARCHIVE_DOC_SPACE', spaceId)
  emitTree(spaceId, 'archived')
  await recheckDocAccess({ spaceId, reason: 'archived' })
  await notifyMembers(spaceId)
}

async function notifyMembers(spaceId: string) {
  const members = await prisma.docSpaceMember.findMany({ where: { space_id: spaceId }, select: { user_id: true } })
  for (const m of members) emitSpacesChanged(m.user_id, spaceId)
}

// ── Membros ──

const MEMBER = {
  role: true, created_at: true, user: { select: { id: true, name: true, email: true, avatar: true, active: true } },
} satisfies Prisma.DocSpaceMemberSelect

export async function listMembers(actor: DocActor, spaceId: string) {
  await requireSpace(spaceId, actor)
  return prisma.docSpaceMember.findMany({ where: { space_id: spaceId }, select: MEMBER, orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }] })
}

/** Precisa sobrar um dono que ainda consiga entrar. */
async function assertNotLastOwner(tx: Tx, spaceId: string, userId: string) {
  const others = await tx.docSpaceMember.count({
    where: { space_id: spaceId, role: 'owner', user_id: { not: userId }, user: { active: true, deleted_at: null } },
  })
  if (!others) throw new AppError(409, 'O espaço precisa de pelo menos um dono. Defina outro antes.', 'LAST_OWNER')
}

export async function setMember(actor: DocActor, spaceId: string, userId: string, body: unknown, audit: AuditInfo) {
  await requireSpace(spaceId, actor, 'owner')
  const { role } = memberRoleSchema.parse(body)
  const user = await prisma.user.findFirst({ where: { id: userId, active: true, deleted_at: null, is_service_account: false }, select: { role: true } })
  if (!user) throw new AppError(404, 'Pessoa não encontrada', 'NOT_FOUND')
  const hasModule = (await getEffectiveModules(userId, user.role)).documents

  const member = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, spaceId)
    const current = await tx.docSpaceMember.findUnique({ where: { space_id_user_id: { space_id: spaceId, user_id: userId } }, select: { role: true } })
    if (!hasModule && (!current || role === 'owner')) {
      throw new AppError(400, 'Esta pessoa não tem o módulo Documentos. Libere o módulo na ficha dela antes.', 'USER_WITHOUT_MODULE')
    }
    if (current?.role === 'owner' && role !== 'owner') await assertNotLastOwner(tx, spaceId, userId)
    return tx.docSpaceMember.upsert({
      where: { space_id_user_id: { space_id: spaceId, user_id: userId } },
      create: { space_id: spaceId, user_id: userId, role },
      update: { role },
      select: MEMBER,
    })
  })
  await log(audit, 'SET_DOC_SPACE_MEMBER', spaceId, { memberId: userId, role })
  await membersChanged(spaceId, userId)
  return member
}

/** Dono tira qualquer um; qualquer membro pode sair sozinho. */
export async function removeMember(actor: DocActor, spaceId: string, userId: string, audit: AuditInfo) {
  await requireSpace(spaceId, actor, actor.id === userId ? 'viewer' : 'owner')
  await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, spaceId)
    const current = await tx.docSpaceMember.findUnique({ where: { space_id_user_id: { space_id: spaceId, user_id: userId } }, select: { role: true } })
    if (!current) throw new AppError(404, 'Esta pessoa não é membro do espaço', 'NOT_FOUND')
    if (current.role === 'owner') await assertNotLastOwner(tx, spaceId, userId)
    await tx.docSpaceMember.delete({ where: { space_id_user_id: { space_id: spaceId, user_id: userId } } })
  })
  await log(audit, 'REMOVE_DOC_SPACE_MEMBER', spaceId, { memberId: userId })
  await membersChanged(spaceId, userId)
}

async function membersChanged(spaceId: string, userId: string) {
  await recheckDocAccess({ spaceId, userId })
  emitTree(spaceId, 'members')
  emitSpacesChanged(userId, spaceId)
}

/** Pessoas com o módulo, para compartilhar. */
export async function searchPeople(q: string) {
  const term = cleanText(q).trim().slice(0, 100)
  const like = term.replace(/[\\%_]/g, '\\$&')
  return prisma.user.findMany({
    where: {
      id: { in: await documentsModuleUserIds() },
      ...(term ? { OR: [{ name: { contains: like, mode: 'insensitive' as const } }, { email: { contains: like, mode: 'insensitive' as const } }] } : {}),
    },
    select: { id: true, name: true, email: true, avatar: true },
    orderBy: { name: 'asc' },
    take: 20,
  })
}

// Só ids: título e nome de espaço privado não vão para a auditoria, que outros gestores leem.
function log(audit: AuditInfo, action: string, spaceId: string, details: Record<string, unknown> = {}) {
  return createAuditLog({ userId: audit.actorId, action, resource: 'DOC_SPACE', details: { spaceId, ...details }, ip: audit.ip, userAgent: audit.userAgent })
}
