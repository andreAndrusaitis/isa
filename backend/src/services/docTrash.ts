/** Lixeira de Documentos: excluir (com as filhas), restaurar, apagar de vez e limpeza automática. */
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import type { AuditInfo } from '../utils/audit'
import { logger } from '../utils/logger'
import { createAuditLog } from './audit'
import { accessibleSpaceIds, requirePage, type DocActor } from './docAccess'
import { descendants } from './docPages'
import { lockSpaces } from './docSpaces'
import { getTrashConfig } from './trash'
import { deleteAttachments } from './uploads'
import { emitTree, recheckDocAccess } from '../realtime/docs'

const DAY_MS = 24 * 3600 * 1000

export async function trashPage(actor: DocActor, pageId: string, audit: AuditInfo) {
  const { page } = await requirePage(pageId, actor, 'editor')
  const ids = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, page.space_id)
    const below = await descendants(tx, page.space_id, pageId)
    const all = [pageId, ...below.filter(d => !d.deleted_at).map(d => d.id)]
    // Mesmo instante em toda a subárvore: é o que diz, ao restaurar, o que saiu junto.
    // Texto convertido no banco: como data, o fuso da sessão deslocaria a hora.
    const now = new Date().toISOString()
    await tx.$executeRaw`UPDATE doc_pages SET deleted_at = CAST(${now} AS timestamp(3)), deleted_by_id = ${actor.id} WHERE id = ANY(${all}::text[]) AND deleted_at IS NULL`
    return all
  }, { timeout: 20_000 })
  await log(audit, 'DELETE_DOC_PAGE', { pageId, spaceId: page.space_id, pages: ids.length })
  emitTree(page.space_id, 'deleted', { pageId, actorId: actor.id })
  await recheckDocAccess({ pageIds: ids, reason: 'deleted' })
}

/** Só o topo de cada exclusão; as filhas voltam junto com ele. */
export async function listTrash(actor: DocActor) {
  const spaces = await accessibleSpaceIds(actor, 'editor')
  const [rows, config] = await Promise.all([
    prisma.docPage.findMany({
      where: { space_id: { in: spaces }, deleted_at: { not: null } },
      select: {
        id: true, parent_id: true, title: true, icon: true, deleted_at: true,
        space: { select: { id: true, name: true, icon: true, color: true } }, deleted_by: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { deleted_at: 'desc' },
      take: 1000,
    }),
    getTrashConfig(),
  ])
  const at = new Map(rows.map(r => [r.id, r.deleted_at!.getTime()]))
  const parentOf = new Map(rows.map(r => [r.id, r.parent_id]))
  const isRoot = (r: { id: string; parent_id: string | null }) => !r.parent_id || at.get(r.parent_id) !== at.get(r.id)
  const children = new Map<string, number>()
  for (const r of rows) {
    if (isRoot(r)) continue
    let top = r.id
    for (let i = 0; i < 100; i++) {
      const up = parentOf.get(top)
      if (!up || at.get(up) !== at.get(r.id)) break
      top = up
    }
    children.set(top, (children.get(top) ?? 0) + 1)
  }
  return rows.filter(isRoot).map(({ parent_id: _parent, ...r }) => ({
    ...r,
    child_count: children.get(r.id) ?? 0,
    purge_at: config.enabled ? new Date(r.deleted_at!.getTime() + config.retention_days * DAY_MS) : null,
  }))
}

export async function restorePage(actor: DocActor, pageId: string, audit: AuditInfo) {
  const { page } = await requirePage(pageId, actor, 'editor', { trashed: true })
  const restored = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, page.space_id)
    const now = await tx.docPage.findFirst({ where: { id: pageId, space_id: page.space_id, deleted_at: { not: null } }, select: { parent_id: true, deleted_at: true } })
    if (!now) throw new AppError(409, 'A página já não está na lixeira.', 'CONFLICT')
    const below = await descendants(tx, page.space_id, pageId)
    const same = below.filter(d => d.deleted_at?.getTime() === now.deleted_at!.getTime()).map(d => d.id)
    const parentAlive = now.parent_id && await tx.docPage.count({ where: { id: now.parent_id, space_id: page.space_id, deleted_at: null } })
    if (now.parent_id && !parentAlive) {
      const { _max } = await tx.docPage.aggregate({ where: { space_id: page.space_id, parent_id: null, deleted_at: null }, _max: { position: true } })
      await tx.$executeRaw`UPDATE doc_pages SET parent_id = NULL, position = ${(_max.position ?? 0) + 1} WHERE id = ${pageId}`
    }
    await tx.$executeRaw`UPDATE doc_pages SET deleted_at = NULL, deleted_by_id = NULL WHERE id = ANY(${[pageId, ...same]}::text[])`
    return tx.docPage.findUniqueOrThrow({
      where: { id: pageId },
      select: { id: true, space_id: true, parent_id: true, title: true, icon: true, position: true, updated_at: true },
    })
  }, { timeout: 20_000 })
  await log(audit, 'RESTORE_DOC_PAGE', { pageId, spaceId: page.space_id })
  emitTree(page.space_id, 'restored', { pageId, actorId: actor.id })
  return restored
}

export async function deletePagePermanently(actor: DocActor, pageId: string, audit: AuditInfo) {
  const { page } = await requirePage(pageId, actor, 'owner', { trashed: true })
  const keys = await prisma.$transaction(async (tx) => {
    await lockSpaces(tx, page.space_id)
    const below = await descendants(tx, page.space_id, pageId)
    return deletePages(tx, [pageId, ...below.filter(d => d.deleted_at).map(d => d.id)])
  }, { timeout: 30_000 })
  await removeFiles(keys)
  await log(audit, 'PURGE_DOC_PAGE', { pageId, spaceId: page.space_id, automatic: false })
  emitTree(page.space_id, 'deleted', { pageId, actorId: actor.id })
}

/** Apaga as páginas e devolve os arquivos que ficaram sem nenhum registro (cópias dividem o mesmo). */
async function deletePages(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
  // Só blobs: data URI mora na própria linha e sai com ela.
  const rows = await tx.$queryRaw<{ storage_key: string }[]>`
    SELECT DISTINCT storage_key FROM doc_attachments WHERE page_id = ANY(${ids}::text[]) AND storage_key NOT LIKE 'data:%'`
  const keys = rows.map(r => r.storage_key)
  await tx.docPage.deleteMany({ where: { id: { in: ids }, deleted_at: { not: null } } })
  const inUse = new Set((await tx.docAttachment.findMany({ where: { storage_key: { in: keys } }, select: { storage_key: true } })).map(a => a.storage_key))
  return keys.filter(k => !inUse.has(k))
}

async function removeFiles(keys: string[]) {
  const failed = await deleteAttachments(keys)
  if (failed.length) logger.error('[Documentos] Falha ao remover arquivos do storage', { failed })
}

/** Job diário: apaga de vez o que passou da retenção da Lixeira (mesma configuração dos chamados). */
export async function purgeExpiredDocPages(): Promise<number> {
  const config = await getTrashConfig()
  if (!config.enabled) return 0
  const cutoff = new Date(Date.now() - config.retention_days * DAY_MS)
  const expired = await prisma.docPage.findMany({ where: { deleted_at: { lt: cutoff } }, select: { id: true } })
  let purged = 0
  for (let i = 0; i < expired.length; i += 100) {
    const ids = expired.slice(i, i + 100).map(p => p.id)
    try {
      await removeFiles(await prisma.$transaction(tx => deletePages(tx, ids), { timeout: 60_000 }))
      purged += ids.length
    } catch (err) {
      logger.error('[Documentos] Erro ao limpar a lixeira', { err: String(err) })
    }
  }
  if (purged) {
    await createAuditLog({ action: 'PURGE_DOC_PAGE', resource: 'DOC_PAGE', details: { pages: purged, automatic: true } })
    logger.info(`[Documentos] ${purged} página(s) excluída(s) definitivamente da lixeira`)
  }
  return purged
}

function log(audit: AuditInfo, action: string, details: Record<string, unknown>) {
  return createAuditLog({ userId: audit.actorId, action, resource: 'DOC_PAGE', details, ip: audit.ip, userAgent: audit.userAgent })
}
