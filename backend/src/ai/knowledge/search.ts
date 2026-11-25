/**
 * Busca de trechos da base. O acesso segue empresa, plano e categoria, menos os
 * bloqueios da empresa; quem não passa recebe lista vazia sem gastar embedding.
 * Um artigo em várias categorias aparece para quem pode ver ao menos uma delas.
 */
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { getAvailableCategoriesForUser } from '../../services/categories'
import { embed as defaultEmbed, type EmbedFn } from '../core/embeddings'
import { AiError, aiConfigured } from '../core/llm'

export interface SearchDeps {
  embed?: EmbedFn
  /** Orçamento em ms repassado ao embed. */
  timeoutMs?: number
  /** Estreita a busca a estas categorias, dentro das que o usuário já vê; nunca amplia. */
  onlyCategoryIds?: string[]
}

export interface ChunkHit {
  articleId: string
  title: string
  text: string
  position: number
  /** 1 - distância de cosseno: 1 é o mesmo sentido do vetor da pergunta. */
  score: number
}

const DIMENSIONS = 1536
const LIMIT = 5

/**
 * getAvailableCategoriesForUser olha só empresa e plano: não sabe de usuário
 * inativo ou excluído nem de empresa inativa ou excluída, e plano vencido é
 * exceção. Aqui tudo isso vira "nenhuma categoria".
 */
export async function allowedCategories(userId: string): Promise<{ id: string; name: string }[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, deleted_at: true, org: { select: { active: true, deleted_at: true } } },
  })
  if (!user?.active || user.deleted_at || !user.org?.active || user.org.deleted_at) return []

  try {
    return await getAvailableCategoriesForUser(userId)
  } catch (err) {
    if (err instanceof AppError && err.code === 'SLA_PLAN_EXPIRED') return []
    throw err
  }
}

async function embedQuestion(question: string, deps: SearchDeps): Promise<number[]> {
  if (!deps.embed && !aiConfigured()) throw new AiError('AI_UNAVAILABLE', 'IA não configurada: configure em Configurar > Provedor de IA')
  const [vector, ...rest] = await (deps.embed ?? defaultEmbed)([question], { timeoutMs: deps.timeoutMs })
  if (vector?.length !== DIMENSIONS || rest.length || !vector.every(Number.isFinite)) {
    throw new AiError('AI_UNAVAILABLE', 'Embedding inesperado para a pergunta')
  }
  return vector
}

export async function searchChunks(question: string, userId: string, deps: SearchDeps = {}): Promise<ChunkHit[]> {
  if (!question.trim()) return []
  const allowed = (await allowedCategories(userId)).map(c => c.id)
  const categoryIds = deps.onlyCategoryIds ? allowed.filter(id => deps.onlyCategoryIds!.includes(id)) : allowed
  if (!categoryIds.length) return []

  const vector = JSON.stringify(await embedQuestion(question, deps))

  const rows = await prisma.$transaction(async tx => {
    // Sem isto o HNSW para nos vizinhos mais próximos: se forem de outra empresa, o filtro
    // os descarta e sobram menos de 5 linhas. Sem o índice (db push), o SET não muda nada.
    await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`
    return tx.$queryRaw<(Omit<ChunkHit, 'score'> & { distance: number })[]>`
      SELECT c.article_id AS "articleId", a.title, c.text, c.position, c.embedding <=> ${vector}::vector AS distance
      FROM knowledge_chunks c
      JOIN knowledge_articles a ON a.id = c.article_id
      WHERE a.status = 'published'
        AND a.deleted_at IS NULL
        AND c.embedding IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM knowledge_article_categories ac
          JOIN categories cat ON cat.id = ac.category_id
          WHERE ac.article_id = a.id
            AND cat.active
            AND ac.category_id = ANY(${categoryIds}::text[])
        )
      ORDER BY distance
      LIMIT ${LIMIT}`
  })

  return rows.map(({ distance, ...hit }) => ({ ...hit, score: 1 - distance }))
}
