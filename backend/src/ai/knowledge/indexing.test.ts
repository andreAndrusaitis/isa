import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { AiError } from '../core/llm'
import type { EmbedFn } from '../core/embeddings'
import { indexArticle } from './indexing'
import { createArticle, deleteArticle, publishArticle, unpublishArticle, updateArticle } from './service'

const SUFFIX = `kbindex-${Date.now()}`
const LONG = Array.from({ length: 1000 }, (_, i) => `palavra${i}`).join(' ')
const unit = () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))
const fakeEmbed = () => vi.fn<EmbedFn>(async texts => texts.map(unit))
const failingEmbed = () => vi.fn<EmbedFn>(async () => { throw new AiError('AI_RATE_LIMITED', 'LLM 429: muitas chamadas', { status: 429 }) })
// NaN passa pela conferência de tamanho e só estoura no INSERT, já dentro da transação.
const brokenVectorEmbed = () => vi.fn<EmbedFn>(async texts => texts.map(() => [...unit().slice(1), NaN]))

let orgId: string, userId: string, catId: string
const articles: string[] = []

async function draft(content = LONG) {
  const a = await createArticle({ title: `Artigo ${SUFFIX}`, content, categoryIds: [catId] }, userId)
  articles.push(a.id)
  return a
}

async function published(content = LONG) {
  const a = await draft(content)
  await publishArticle(a.id, userId, { embed: fakeEmbed() })
  return a
}

const chunksOf = (id: string) => prisma.knowledgeChunk.findMany({ where: { article_id: id }, orderBy: { position: 'asc' } })
const statusOf = async (id: string) => (await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id } })).status

async function failure(run: Promise<unknown>): Promise<AppError> {
  const err = await run.then(() => { throw new Error('deveria ter falhado') }, e => e)
  expect(err).toBeInstanceOf(AppError)
  return err
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  userId = (await prisma.user.create({ data: { name: `Autor ${SUFFIX}`, email: `autor-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
})

afterAll(async () => {
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articles } } }) // cascata: categorias e chunks
  await prisma.category.deleteMany({ where: { id: catId } })
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('indexação do artigo', () => {
  it('publicar grava os pedaços com vetor e muda o status', async () => {
    const a = await draft()
    const embed = fakeEmbed()
    const out = await publishArticle(a.id, userId, { embed })

    expect(out.status).toBe('published')
    expect(out.published_at).toBeTruthy()
    expect(embed).toHaveBeenCalledTimes(1)

    const chunks = await chunksOf(a.id)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.length).toBeLessThanOrEqual(4)
    expect(chunks.map(c => c.position)).toEqual(chunks.map((_, i) => i))
    expect(chunks.map(c => c.text)).toEqual(embed.mock.calls[0][0])

    const dims = await prisma.$queryRaw<{ dims: number }[]>`SELECT vector_dims(embedding) AS dims FROM knowledge_chunks WHERE article_id = ${a.id}`
    expect(dims).toHaveLength(chunks.length)
    expect(dims.every(d => d.dims === 1536)).toBe(true)
  })

  it('artigo curto vira um pedaço só', async () => {
    const a = await published('Reinicie o serviço de impressão.')
    expect((await chunksOf(a.id)).map(c => c.text)).toEqual(['Reinicie o serviço de impressão.'])
  })

  it('texto do usuário é só dado no SQL', async () => {
    const hostile = `'); DELETE FROM knowledge_chunks; --`
    const a = await published(hostile)
    expect((await chunksOf(a.id)).map(c => c.text)).toEqual([hostile])
  })

  it('indexArticle sozinho troca os pedaços de um artigo publicado', async () => {
    const a = await published()
    const before = (await chunksOf(a.id)).map(c => c.id)
    await indexArticle(a.id, { embed: fakeEmbed() })
    const after = await chunksOf(a.id)
    expect(after.map(c => c.text).length).toBe(before.length)
    expect(after.some(c => before.includes(c.id))).toBe(false)
  })

  it('editar artigo publicado troca os pedaços', async () => {
    const a = await published()
    const before = (await chunksOf(a.id)).map(c => c.id)
    const embed = fakeEmbed()

    const out = await updateArticle(a.id, { content: 'Novo procedimento curto.' }, userId, { embed })

    expect(out.content).toBe('Novo procedimento curto.')
    const after = await chunksOf(a.id)
    expect(after.map(c => c.text)).toEqual(['Novo procedimento curto.'])
    expect(before).not.toContain(after[0].id)
  })

  it('só reindexa quando o conteúdo do publicado muda', async () => {
    const a = await published()
    const before = (await chunksOf(a.id)).map(c => c.id)
    const embed = fakeEmbed()

    await updateArticle(a.id, { title: `Outro ${SUFFIX}` }, userId, { embed })
    await updateArticle(a.id, { content: LONG }, userId, { embed })

    expect(embed).not.toHaveBeenCalled()
    expect((await chunksOf(a.id)).map(c => c.id)).toEqual(before)
  })

  it('editar rascunho não indexa', async () => {
    const a = await draft()
    const embed = fakeEmbed()
    await updateArticle(a.id, { content: 'Outro texto.' }, userId, { embed })
    expect(embed).not.toHaveBeenCalled()
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('despublicar remove os pedaços', async () => {
    const a = await published()
    await unpublishArticle(a.id, userId)
    expect(await statusOf(a.id)).toBe('draft')
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('excluir não deixa pedaço órfão', async () => {
    const a = await published()
    await deleteArticle(a.id, userId)
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('publicar de novo depois de despublicar reindexa', async () => {
    const a = await published()
    await unpublishArticle(a.id, userId)
    await publishArticle(a.id, userId, { embed: fakeEmbed() })
    expect((await chunksOf(a.id)).length).toBeGreaterThanOrEqual(2)
  })
})

describe('falhas na indexação', () => {
  it('Foundry fora: 503 com o code do AiError e o artigo continua rascunho', async () => {
    const a = await draft()
    const err = await failure(publishArticle(a.id, userId, { embed: failingEmbed() }))
    expect(err).toMatchObject({ statusCode: 503, code: 'AI_RATE_LIMITED' })
    expect(err.message).not.toContain('LLM 429')
    expect(await statusOf(a.id)).toBe('draft')
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('Foundry fora na edição: conteúdo e pedaços ficam como estavam', async () => {
    const a = await published()
    const before = await chunksOf(a.id)
    const err = await failure(updateArticle(a.id, { content: 'Texto novo.', title: `Novo ${SUFFIX}` }, userId, { embed: failingEmbed() }))
    expect(err).toMatchObject({ statusCode: 503, code: 'AI_RATE_LIMITED' })
    const after = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })
    expect(after).toMatchObject({ title: a.title, content: LONG, status: 'published' })
    expect(await chunksOf(a.id)).toEqual(before)
  })

  it('falha no meio da transação não deixa artigo publicado nem pedaço solto', async () => {
    const a = await draft()
    await expect(publishArticle(a.id, userId, { embed: brokenVectorEmbed() })).rejects.toThrow()
    expect(await statusOf(a.id)).toBe('draft')
    expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).published_at).toBeNull()
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('falha no meio da transação da edição devolve os pedaços antigos', async () => {
    const a = await published()
    const before = await chunksOf(a.id)
    await expect(updateArticle(a.id, { content: 'Texto novo.' }, userId, { embed: brokenVectorEmbed() })).rejects.toThrow()
    expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).content).toBe(LONG)
    expect(await chunksOf(a.id)).toEqual(before)
  })

  it('resposta com vetores a menos ou de outra dimensão é recusada antes do banco', async () => {
    const a = await draft()
    const fewer = vi.fn<EmbedFn>(async () => [unit()])
    const shorter = vi.fn<EmbedFn>(async texts => texts.map(() => [1, 2, 3]))
    for (const embed of [fewer, shorter]) {
      const err = await failure(publishArticle(a.id, userId, { embed }))
      expect(err).toMatchObject({ statusCode: 503, code: 'AI_UNAVAILABLE' })
    }
    expect(await statusOf(a.id)).toBe('draft')
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('artigo excluído enquanto o embedding roda não volta nem deixa órfão', async () => {
    const a = await draft()
    const embed = vi.fn<EmbedFn>(async texts => {
      await deleteArticle(a.id, userId)
      return texts.map(unit)
    })
    const err = await failure(publishArticle(a.id, userId, { embed }))
    expect(err).toMatchObject({ statusCode: 409, code: 'ARTICLE_CHANGED' })
    expect(await statusOf(a.id)).toBe('draft')
    expect(await chunksOf(a.id)).toEqual([])
  })

  it('edição enquanto o embedding roda não publica pedaços do texto antigo', async () => {
    const a = await draft()
    const embed = vi.fn<EmbedFn>(async texts => {
      await updateArticle(a.id, { content: 'Texto que chegou depois.' }, userId)
      return texts.map(unit)
    })
    const err = await failure(publishArticle(a.id, userId, { embed }))
    expect(err).toMatchObject({ statusCode: 409, code: 'ARTICLE_CHANGED' })
    expect(await statusOf(a.id)).toBe('draft')
    expect(await chunksOf(a.id)).toEqual([])
  })
})
