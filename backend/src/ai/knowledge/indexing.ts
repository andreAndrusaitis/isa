/**
 * Indexação do artigo: pedaços e vetores em knowledge_chunks.
 * O embedding roda antes da transação (chamada lenta não segura a linha) e a
 * transação troca os pedaços junto com a mudança no artigo: ou vai tudo, ou nada.
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { embed as defaultEmbed, type EmbedFn } from '../core/embeddings'
import { AiError, aiConfigured } from '../core/llm'
import { chunkText } from './chunking'

export interface IndexDeps { embed?: EmbedFn }

export interface IndexChange {
  /** Texto a indexar, quando a mudança ainda não está gravada. Sem ele, vale o conteúdo do artigo. */
  content?: string
  /** Mudança no artigo que vai na mesma transação dos pedaços. */
  apply?: (tx: Prisma.TransactionClient) => Promise<unknown>
}

const DIMENSIONS = 1536
const EMBED_BUDGET_MS = 60_000
const TX_TIMEOUT_MS = 30_000

/**
 * Trava o artigo e confirma que ele continua como foi lido. Sem isso, o que
 * aconteceu durante o embedding seria sobrescrito: artigo excluído voltaria com
 * pedaços, e texto editado sairia publicado com vetores do texto antigo.
 */
export async function lockUnchanged(tx: Prisma.TransactionClient, id: string, updatedAt: Date) {
  await tx.$queryRaw`SELECT id FROM knowledge_articles WHERE id = ${id} FOR UPDATE`
  const now = await tx.knowledgeArticle.findUnique({ where: { id }, select: { updated_at: true, deleted_at: true } })
  if (!now || now.deleted_at || now.updated_at.getTime() !== updatedAt.getTime()) {
    throw new AppError(409, 'O artigo mudou enquanto a operação rodava. Recarregue e tente de novo.', 'ARTICLE_CHANGED')
  }
}

async function embedPieces(pieces: string[], embed: EmbedFn): Promise<number[][]> {
  try {
    const vectors = await embed(pieces, { timeoutMs: EMBED_BUDGET_MS })
    if (vectors.length !== pieces.length || vectors.some(v => v.length !== DIMENSIONS)) {
      throw new AiError('AI_UNAVAILABLE', `Embedding inesperado: ${vectors.length} vetores para ${pieces.length} pedaços`)
    }
    return vectors
  } catch (err) {
    if (err instanceof AiError) throw new AppError(503, 'Não foi possível indexar o artigo agora. Nada foi alterado: tente de novo em instantes.', err.code)
    throw err
  }
}

export async function indexArticle(articleId: string, deps: IndexDeps = {}, change: IndexChange = {}) {
  if (!deps.embed && !aiConfigured()) {
    throw new AppError(503, 'A IA não está configurada: sem ela o artigo não pode ser indexado. Configure em Configurar > Provedor de IA.', 'AI_NOT_CONFIGURED')
  }
  const article = await prisma.knowledgeArticle.findFirst({ where: { id: articleId, deleted_at: null }, select: { content: true, updated_at: true } })
  if (!article) throw new AppError(404, 'Artigo não encontrado', 'NOT_FOUND')

  const pieces = chunkText(change.content ?? article.content)
  const vectors = await embedPieces(pieces, deps.embed ?? defaultEmbed)

  await prisma.$transaction(async tx => {
    await lockUnchanged(tx, articleId, article.updated_at)
    await change.apply?.(tx)
    await tx.knowledgeChunk.deleteMany({ where: { article_id: articleId } })
    const rows = pieces.map((text, position) =>
      Prisma.sql`(${randomUUID()}, ${articleId}, ${position}, ${text}, ${JSON.stringify(vectors[position])}::vector, CURRENT_TIMESTAMP)`)
    await tx.$executeRaw`INSERT INTO knowledge_chunks (id, article_id, position, text, embedding, updated_at) VALUES ${Prisma.join(rows)}`
  }, { timeout: TX_TIMEOUT_MS })
}
