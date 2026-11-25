/** Páginas de Documentos: árvore, título, mover, duplicar, busca, recentes e favoritos. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import type { AuditInfo } from '../utils/audit'
import { createAuditLog } from './audit'
import { cleanText, docFromState, encodeDoc, extractText, replaceInAttributes } from './docContent'
import { accessibleSpaceIds, requirePage, requireSpace, type DocActor } from './docAccess'
import { docIcon, docText, lockSpaces } from './docSpaces'
import { currentState, emitPageMeta, emitTree, recheckDocAccess } from '../realtime/docs'

type Tx = Prisma.TransactionClient

export const UNTITLED = 'Sem título'
const title = docText(200).transform(s => s || UNTITLED)
const position = z.number().finite()
const parentId = z.string().max(64).nullable()

export const createPageSchema = z.object({ title: title.optional(), parentId: parentId.optional(), icon: docIcon.optional(), position: position.optional() })
export const updatePageSchema = z.object({ title: title.optional(), icon: docIcon.optional() })
export const movePageSchema = z.object({ parentId: parentId.optional(), position: position.optional(), spaceId: z.string().max(64).optional() })

const PERSON = { select: { id: true, name: true, avatar: true } } as const

const TREE = {
  id: true, parent_id: true, title: true, icon: true, position: true, updated_at: true,
} satisfies Prisma.DocPageSelect

export async function listTree(actor: DocActor, spaceId: string) {
  await requireSpace(spaceId, actor)
  const rows = await prisma.docPage.findMany({
    where: { space_id: spaceId, deleted_at: null },
    select: { ...TREE, favorites: { where: { user_id: actor.id }, select: { user_id: true } } },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
  })
  return rows.map(({ favorites, ...p }) => ({ ...p, favorite: favorites.length > 0 }))
}

export async function getPage(actor: DocActor, pageId: string) {
  const { page: meta, role } = await requirePage(pageId, actor)
  const page = await prisma.docPage.findUniqueOrThrow({
    where: { id: pageId },
    select: {
      id: true, space_id: true, parent_id: true, title: true, icon: true, position: true, revision: true, created_at: true, updated_at: true,
      space: { select: { id: true, name: true, icon: true, color: true, visibility: true } },
      created_by: PERSON, updated_by: PERSON,
      favorites: { where: { user_id: actor.id }, select: { user_id: true } },
    },
  })
  const { favorites, ...rest } = page
  return { ...rest, role, favorite: favorites.length > 0, breadcrumb: await breadcrumb(meta.space_id, meta.parent_id) }
}

/** Da raiz até o pai, uma consulta só. */
async function breadcrumb(spaceId: string, parent: string | null) {
  if (!parent) return []
  return prisma.$queryRaw<{ id: string; title: string; icon: string | null }[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, title, icon, 1 AS depth FROM doc_pages WHERE id = ${parent} AND space_id = ${spaceId} AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_id, p.title, p.icon, up.depth + 1 FROM doc_pages p JOIN up ON p.id = up.parent_id
      WHERE p.space_id = ${spaceId} AND p.deleted_at IS NULL AND up.depth < 100
    )
    SELECT id, title, icon FROM up ORDER BY depth DESC`
}

async function nextPosition(tx: Tx, spaceId: string, parent: string | null) {
  const { _max } = await tx.docPage.aggregate({ where: { space_id: spaceId, parent_id: parent, deleted_at: null }, _max: { position: true } })
  return (_max.position ?? 0) + 1
}

/** Pai precisa ser página viva do mesmo espaço. */
async function assertParent(tx: Tx, spaceId: string, parent: string) {
  const row = await tx.docPage.findFirst({ where: { id: parent, space_id: spaceId, deleted_at: null }, select: { id: true } })
  if (!row) throw new AppError(400, 'A página de destino não existe neste espaço.', 'INVALID_PARENT')
}

/** Todos abaixo da página, vivos ou na lixeira. */
export async function descendants(tx: Tx, spaceId: string, pageId: string) {
  const rows = await tx.docPage.findMany({ where: { space_id: spaceId }, select: { id: true, parent_id: true, deleted_at: true } })
  const children = new Map<string, typeof rows>()
  for (const r of rows) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r])
  const out: typeof rows = []
  const seen = new Set([pageId])
  for (let queue = [pageId]; queue.length;) {
    const next = queue.flatMap(id => children.get(id) ?? []).filter(r => !seen.has(r.id))
    for (const r of next) { seen.add(r.id); out.push(r) }
    queue = next.map(r => r.id)
  }
  return out
}

export async function createPage(actor: DocActor, spaceId: string, body: unknown) {
  await requireSpace(spaceId, actor, 'editor')
  const data = createPageSchema.parse(body ?? {})
  const parent = data.parentId ?? null
  const page = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, spaceId)
    if (parent) await assertParent(tx, spaceId, parent)
    return tx.docPage.create({
      data: {
        space_id: spaceId, parent_id: parent, title: data.title ?? UNTITLED, icon: data.icon ?? null,
        position: data.position ?? await nextPosition(tx, spaceId, parent),
        created_by_id: actor.id, updated_by_id: actor.id,
      },
      select: { ...TREE, space_id: true },
    })
  })
  emitTree(spaceId, 'created', { pageId: page.id, actorId: actor.id })
  return { ...page, favorite: false }
}

export async function updatePage(actor: DocActor, pageId: string, body: unknown) {
  const { page } = await requirePage(pageId, actor, 'editor')
  const data = updatePageSchema.parse(body)
  const updated = await prisma.docPage.update({
    where: { id: pageId }, data: { ...data, updated_by_id: actor.id }, select: { ...TREE, space_id: true },
  })
  emitPageMeta(pageId, { title: updated.title, icon: updated.icon })
  emitTree(page.space_id, 'updated', { pageId, actorId: actor.id, title: updated.title, icon: updated.icon })
  return updated
}

const MIN_GAP = 1e-6

/** Muitas inserções no mesmo ponto esgotam o intervalo entre posições: renumera o nível. */
async function rebalance(tx: Tx, spaceId: string, parent: string | null) {
  const rows = await tx.docPage.findMany({
    where: { space_id: spaceId, parent_id: parent, deleted_at: null },
    select: { id: true, position: true }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
  })
  if (rows.every((r, i) => i === 0 || r.position - rows[i - 1].position >= MIN_GAP)) return
  for (const [i, r] of rows.entries()) await tx.$executeRaw`UPDATE doc_pages SET position = ${i + 1} WHERE id = ${r.id}`
}

export async function movePage(actor: DocActor, pageId: string, body: unknown, audit: AuditInfo) {
  const { page } = await requirePage(pageId, actor, 'editor')
  const data = movePageSchema.parse(body)
  const from = page.space_id
  const to = data.spaceId ?? from
  if (to !== from) await requireSpace(to, actor, 'editor')

  const moved = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, from, to)
    const now = await tx.docPage.findFirst({ where: { id: pageId, space_id: from, deleted_at: null }, select: { parent_id: true } })
    if (!now) throw new AppError(409, 'A página mudou de lugar. Recarregue e tente de novo.', 'CONFLICT')
    const parent = data.parentId !== undefined ? data.parentId : to === from ? now.parent_id : null
    const below = await descendants(tx, from, pageId)
    if (parent) {
      if (parent === pageId || below.some(d => d.id === parent)) throw new AppError(400, 'Uma página não pode ficar dentro dela mesma.', 'PAGE_CYCLE')
      await assertParent(tx, to, parent)
    }
    const pos = data.position ?? await nextPosition(tx, to, parent)
    const ids = [pageId, ...below.map(d => d.id)]
    // SQL direto: mover não conta como edição (updated_at fica).
    await tx.$executeRaw`UPDATE doc_pages SET parent_id = ${parent}, position = ${pos} WHERE id = ${pageId}`
    if (to !== from) {
      await tx.$executeRaw`UPDATE doc_pages SET space_id = ${to} WHERE id = ANY(${ids}::text[])`
      await tx.$executeRaw`UPDATE doc_attachments SET space_id = ${to} WHERE page_id = ANY(${ids}::text[])`
    }
    await rebalance(tx, to, parent)
    return { ids, page: await tx.docPage.findUniqueOrThrow({ where: { id: pageId }, select: { ...TREE, space_id: true } }) }
  }, { timeout: 20_000 })

  emitTree(from, 'moved', { pageId, actorId: actor.id })
  if (to !== from) {
    emitTree(to, 'moved', { pageId, actorId: actor.id })
    await recheckDocAccess({ pageIds: moved.ids, reason: 'moved' })
    await createAuditLog({ userId: audit.actorId, action: 'MOVE_DOC_PAGE', resource: 'DOC_PAGE', details: { pageId, fromSpaceId: from, toSpaceId: to, pages: moved.ids.length }, ip: audit.ip, userAgent: audit.userAgent })
  }
  return moved.page
}

/** Copia a página (não as filhas), logo depois da original. Os anexos ganham registro próprio. */
export async function duplicatePage(actor: DocActor, pageId: string) {
  const { page } = await requirePage(pageId, actor, 'editor')
  const state = await currentState(pageId)
  const doc = docFromState(state)
  const attachments = await prisma.docAttachment.findMany({
    where: { page_id: pageId }, select: { id: true, filename: true, mime: true, size: true, storage_key: true },
  })
  const newIds = new Map(attachments.map(a => [a.id, randomUUID()]))
  replaceInAttributes(doc, newIds)
  const ydoc = encodeDoc(doc)
  const text = extractText(doc)
  doc.destroy()

  const copy = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, page.space_id)
    const original = await tx.docPage.findFirst({ where: { id: pageId, space_id: page.space_id, deleted_at: null }, select: { parent_id: true, position: true } })
    if (!original) throw new AppError(409, 'A página mudou de lugar. Recarregue e tente de novo.', 'CONFLICT')
    const next = await tx.docPage.findFirst({
      where: { space_id: page.space_id, parent_id: original.parent_id, deleted_at: null, position: { gt: original.position } },
      orderBy: { position: 'asc' }, select: { position: true },
    })
    const created = await tx.docPage.create({
      data: {
        space_id: page.space_id, parent_id: original.parent_id, title: `${page.title.slice(0, 190)} (cópia)`, icon: page.icon,
        position: next ? (original.position + next.position) / 2 : original.position + 1,
        ydoc, content_text: text, created_by_id: actor.id, updated_by_id: actor.id,
      },
      select: { ...TREE, space_id: true },
    })
    if (attachments.length) {
      // Mesmo arquivo no storage: só é apagado quando o último registro sai.
      await tx.docAttachment.createMany({
        data: attachments.map(a => ({ ...a, id: newIds.get(a.id)!, page_id: created.id, space_id: page.space_id, created_by_id: actor.id })),
      })
    }
    await rebalance(tx, page.space_id, original.parent_id)
    return created
  }, { timeout: 20_000 })
  emitTree(page.space_id, 'created', { pageId: copy.id, actorId: actor.id })
  return { ...copy, favorite: false }
}

// ── Busca, recentes e favoritos (só espaços que a pessoa enxerga) ──

const SPACE_REF = { select: { id: true, name: true, icon: true, color: true } } as const

export async function searchPages(actor: DocActor, q: string) {
  const term = cleanText(q).trim().slice(0, 100)
  if (term.length < 2) return []
  const spaces = await accessibleSpaceIds(actor)
  if (!spaces.length) return []
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
  const rows = await prisma.$queryRaw<{ id: string; title: string; icon: string | null; updated_at: Date; space_id: string; space_name: string; space_icon: string | null; space_color: string | null; excerpt: string; at: number }[]>`
    SELECT p.id, p.title, p.icon, p.updated_at, p.space_id, s.name AS space_name, s.icon AS space_icon, s.color AS space_color,
      strpos(lower(p.content_text), lower(${term})) AS at,
      substr(p.content_text, greatest(1, strpos(lower(p.content_text), lower(${term})) - 60), 220) AS excerpt
    FROM doc_pages p JOIN doc_spaces s ON s.id = p.space_id
    WHERE p.deleted_at IS NULL AND p.space_id = ANY(${spaces}::text[])
      AND (p.title ILIKE ${pattern} OR p.content_text ILIKE ${pattern})
    ORDER BY (p.title ILIKE ${pattern}) DESC, p.updated_at DESC
    LIMIT 30`
  return rows.map(r => ({
    id: r.id, title: r.title, icon: r.icon, updated_at: r.updated_at,
    space: { id: r.space_id, name: r.space_name, icon: r.space_icon, color: r.space_color },
    snippet: `${r.at > 61 ? '…' : ''}${r.excerpt.replace(/\s+/g, ' ').trim()}${r.excerpt.length === 220 ? '…' : ''}`,
  }))
}

const LIST = { id: true, title: true, icon: true, updated_at: true, space: SPACE_REF, updated_by: PERSON } satisfies Prisma.DocPageSelect

export async function recentPages(actor: DocActor) {
  return prisma.docPage.findMany({
    where: { deleted_at: null, space_id: { in: await accessibleSpaceIds(actor) } },
    select: LIST, orderBy: { updated_at: 'desc' }, take: 20,
  })
}

export async function listFavorites(actor: DocActor) {
  const rows = await prisma.docFavorite.findMany({
    where: { user_id: actor.id, page: { deleted_at: null, space_id: { in: await accessibleSpaceIds(actor) } } },
    select: { page: { select: LIST } }, orderBy: { created_at: 'desc' },
  })
  return rows.map(r => r.page)
}

export async function setFavorite(actor: DocActor, pageId: string, favorite: boolean) {
  await requirePage(pageId, actor)
  const key = { user_id: actor.id, page_id: pageId }
  if (favorite) await prisma.docFavorite.upsert({ where: { user_id_page_id: key }, create: key, update: {} })
  else await prisma.docFavorite.deleteMany({ where: key })
  return { favorite }
}
