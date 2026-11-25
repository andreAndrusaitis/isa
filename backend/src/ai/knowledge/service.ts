/** Regras dos artigos da base de conhecimento. Artigo excluído (deleted_at) não existe para a API. */
import { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { readUploadedFile } from './importing'
import { indexArticle, lockUnchanged, type IndexDeps } from './indexing'
import type { CreateInput, ImportInput, ListQuery, UpdateInput } from './schemas'

const WITH_CATEGORIES = {
  categories: { select: { category: { select: { id: true, name: true, active: true } } } },
} satisfies Prisma.KnowledgeArticleInclude

// O conteúdo pode ter centenas de KB: fica só no GET /:id.
const SUMMARY = {
  id: true, title: true, status: true, source_filename: true, created_by_id: true, updated_by_id: true,
  published_at: true, deleted_at: true, created_at: true, updated_at: true, ...WITH_CATEGORIES,
} satisfies Prisma.KnowledgeArticleSelect

type CategoryRef = { id: string; name: string; active: boolean }

const present = <T extends { categories: { category: CategoryRef }[] }>({ categories, ...article }: T) =>
  ({ ...article, categories: categories.map(c => c.category) })

async function findArticle(id: string) {
  const article = await prisma.knowledgeArticle.findFirst({ where: { id, deleted_at: null }, include: WITH_CATEGORIES })
  if (!article) throw new AppError(404, 'Artigo não encontrado', 'NOT_FOUND')
  return article
}

async function findCategories(ids: string[]) {
  const found = await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } })
  const missing = ids.filter(id => !found.some(c => c.id === id))
  if (missing.length) throw new AppError(400, 'Categoria não encontrada', 'INVALID_CATEGORY', { categoryIds: missing })
  return found
}

// Artigo sem categoria ativa não alcança ninguém pelo eixo empresa, plano, categoria.
function assertActiveCategory(categories: CategoryRef[]) {
  if (categories.some(c => c.active)) return
  throw new AppError(422, 'O artigo precisa de ao menos uma categoria ativa para ficar publicado', 'NO_ACTIVE_CATEGORY', {
    categoryIds: ['Vincule ao menos uma categoria ativa'],
  })
}

export async function createArticle({ title, content, categoryIds = [] }: CreateInput, userId: string, sourceFilename?: string) {
  await findCategories(categoryIds)
  const article = await prisma.knowledgeArticle.create({
    data: {
      title, content, source_filename: sourceFilename, created_by_id: userId, updated_by_id: userId,
      categories: { create: categoryIds.map(category_id => ({ category_id })) },
    },
    include: WITH_CATEGORIES,
  })
  return present(article)
}

/** Importar nunca publica: o admin revisa o texto extraído e escolhe as categorias. */
export async function importArticle({ fileName, dataUri }: ImportInput, userId: string) {
  const { name, title, content } = await readUploadedFile(fileName, dataUri)
  return createArticle({ title, content }, userId, name)
}

export async function listArticles({ page, pageSize, status, categoryId }: ListQuery) {
  const where: Prisma.KnowledgeArticleWhereInput = {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(categoryId ? { categories: { some: { category_id: categoryId } } } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.knowledgeArticle.count({ where }),
    prisma.knowledgeArticle.findMany({
      where,
      select: SUMMARY,
      orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { data: rows.map(present), total, page, pageSize }
}

export async function getArticle(id: string) {
  return present(await findArticle(id))
}

export async function updateArticle(id: string, { title, content, categoryIds }: UpdateInput, userId: string, deps: IndexDeps = {}) {
  const article = await findArticle(id)
  const categories = categoryIds && await findCategories(categoryIds)
  if (categories && article.status === 'published') assertActiveCategory(categories)

  const write = (tx: Prisma.TransactionClient) => tx.knowledgeArticle.update({
    where: { id },
    data: {
      title, content, updated_by_id: userId,
      ...(categoryIds ? { categories: { deleteMany: {}, create: categoryIds.map(category_id => ({ category_id })) } } : {}),
    },
  })

  if (article.status === 'published' && content !== undefined && content !== article.content) {
    await indexArticle(id, deps, { content, apply: write })
  } else {
    await prisma.$transaction(async tx => {
      await lockUnchanged(tx, id, article.updated_at)
      await write(tx)
    })
  }
  return getArticle(id)
}

export async function publishArticle(id: string, userId: string, deps: IndexDeps = {}) {
  const article = await findArticle(id)
  if (article.status === 'published') throw new AppError(409, 'O artigo já está publicado', 'ALREADY_PUBLISHED')
  assertActiveCategory(article.categories.map(c => c.category))
  await indexArticle(id, deps, {
    apply: tx => tx.knowledgeArticle.update({ where: { id }, data: { status: 'published', published_at: new Date(), updated_by_id: userId } }),
  })
  return getArticle(id)
}

export async function unpublishArticle(id: string, userId: string) {
  const article = await findArticle(id)
  if (article.status !== 'published') throw new AppError(409, 'O artigo não está publicado', 'NOT_PUBLISHED')
  await prisma.$transaction(async tx => {
    await tx.knowledgeArticle.update({ where: { id }, data: { status: 'draft', published_at: null, updated_by_id: userId } })
    await tx.knowledgeChunk.deleteMany({ where: { article_id: id } })
  })
  return getArticle(id)
}

export async function deleteArticle(id: string, userId: string) {
  const article = await findArticle(id)
  await prisma.$transaction(async tx => {
    await tx.knowledgeArticle.update({ where: { id }, data: { deleted_at: new Date(), updated_by_id: userId } })
    await tx.knowledgeChunk.deleteMany({ where: { article_id: id } })
  })
  return article
}
