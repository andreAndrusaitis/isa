/** Histórico de versões das páginas de Documentos. */
import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { requirePage, type DocActor } from './docAccess'
import { docFromState, replaceContent } from './docContent'
import { docText } from './docSpaces'
import { MAX_VERSIONS, mutateDoc, saveVersion } from '../realtime/docs'

export const createVersionSchema = z.object({ label: docText(120).transform(s => s || null).optional() })

const versionNotFound = () => new AppError(404, 'Versão não encontrada', 'NOT_FOUND')

export async function listVersions(actor: DocActor, pageId: string) {
  await requirePage(pageId, actor)
  return prisma.docPageVersion.findMany({
    where: { page_id: pageId },
    select: { id: true, title: true, label: true, created_at: true, created_by: { select: { id: true, name: true, avatar: true } } },
    orderBy: { created_at: 'desc' },
    take: MAX_VERSIONS,
  })
}

export async function createVersion(actor: DocActor, pageId: string, body: unknown) {
  await requirePage(pageId, actor, 'editor')
  const { label } = createVersionSchema.parse(body ?? {})
  return saveVersion(pageId, actor.id, label ?? null)
}

/** Binário do Yjs. O acesso vem da página da versão. */
export async function versionYdoc(actor: DocActor, versionId: string): Promise<Buffer> {
  const version = await prisma.docPageVersion.findUnique({ where: { id: versionId }, select: { page_id: true } })
  if (!version) throw versionNotFound()
  await requirePage(version.page_id, actor)
  return (await prisma.docPageVersion.findUniqueOrThrow({ where: { id: versionId }, select: { ydoc: true } })).ydoc
}

/** O conteúdo atual vira uma versão antes: restaurar também pode ser desfeito. */
export async function restoreVersion(actor: DocActor, pageId: string, versionId: string) {
  await requirePage(pageId, actor, 'editor')
  const version = await prisma.docPageVersion.findFirst({ where: { id: versionId, page_id: pageId }, select: { ydoc: true } })
  if (!version) throw versionNotFound()
  const backup = await saveVersion(pageId, actor.id, 'Antes de restaurar')
  const source = docFromState(version.ydoc)
  const ok = await mutateDoc(pageId, actor.id, version.ydoc.length, doc => replaceContent(doc, source))
  source.destroy()
  if (!ok) throw new AppError(413, 'A página passaria do tamanho máximo (8 MB).', 'DOC_TOO_LARGE')
  const page = await prisma.docPage.findUniqueOrThrow({ where: { id: pageId }, select: { id: true, revision: true, updated_at: true } })
  return { ...page, backup_version_id: backup.id }
}
