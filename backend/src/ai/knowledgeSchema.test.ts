import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'

const SUFFIX = `kbschema-${Date.now()}`
const vector = (hot: number) => `[${Array.from({ length: 1536 }, (_, i) => (i === hot ? 1 : 0)).join(',')}]`

let orgId: string, userId: string, catA: string, catB: string
const articles: string[] = []
const interactions: string[] = []
const tickets: string[] = []

async function newArticle(title: string): Promise<string> {
  const { id } = await prisma.knowledgeArticle.create({
    data: { title: `${title} ${SUFFIX}`, content: 'Reinicie o serviço de impressão.', created_by_id: userId, updated_by_id: userId },
  })
  articles.push(id)
  return id
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  userId = (await prisma.user.create({ data: { name: `Autor ${SUFFIX}`, email: `autor-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  catA = (await prisma.category.create({ data: { name: `A ${SUFFIX}` } })).id
  catB = (await prisma.category.create({ data: { name: `B ${SUFFIX}` } })).id
})

afterAll(async () => {
  await prisma.aiInteraction.deleteMany({ where: { id: { in: interactions } } })
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } })
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articles } } }) // cascata: categorias e chunks
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB] } } })
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('tabelas da base de conhecimento', () => {
  it('artigo nasce rascunho, ligado à categoria, com chunk e vetor gravado por SQL cru', async () => {
    const articleId = await newArticle('Impressora')
    const article = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: articleId } })
    expect(article).toMatchObject({ status: 'draft', source_filename: null, published_at: null, deleted_at: null })

    await prisma.knowledgeArticleCategory.create({ data: { article_id: articleId, category_id: catA } })
    const near = await prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 0, text: 'perto' } })
    const far = await prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 1, text: 'longe' } })
    await prisma.$executeRaw`UPDATE knowledge_chunks SET embedding = ${vector(0)}::vector WHERE id = ${near.id}`
    await prisma.$executeRaw`UPDATE knowledge_chunks SET embedding = ${vector(1)}::vector WHERE id = ${far.id}`

    const rows = await prisma.$queryRaw<{ id: string; dims: number }[]>`
      SELECT id, vector_dims(embedding) AS dims FROM knowledge_chunks
      WHERE article_id = ${articleId} ORDER BY embedding <=> ${vector(0)}::vector`
    expect(rows).toEqual([{ id: near.id, dims: 1536 }, { id: far.id, dims: 1536 }])
  })

  it('recusa vetor com dimensão diferente de 1536', async () => {
    const articleId = await newArticle('Dimensão')
    const chunk = await prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 0, text: 'x' } })
    await expect(prisma.$executeRaw`UPDATE knowledge_chunks SET embedding = '[1,2,3]'::vector WHERE id = ${chunk.id}`).rejects.toThrow(/1536/)
  })

  it('par artigo+categoria e artigo+posição são únicos', async () => {
    const articleId = await newArticle('Únicos')
    await prisma.knowledgeArticleCategory.create({ data: { article_id: articleId, category_id: catA } })
    await prisma.knowledgeArticleCategory.create({ data: { article_id: articleId, category_id: catB } })
    await expect(prisma.knowledgeArticleCategory.create({ data: { article_id: articleId, category_id: catA } })).rejects.toThrow(/Unique constraint/)

    await prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 0, text: 'a' } })
    await expect(prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 0, text: 'b' } })).rejects.toThrow(/Unique constraint/)
  })

  it('apagar o artigo leva categorias e chunks junto', async () => {
    const articleId = await newArticle('Cascata')
    await prisma.knowledgeArticleCategory.create({ data: { article_id: articleId, category_id: catA } })
    await prisma.knowledgeChunk.create({ data: { article_id: articleId, position: 0, text: 'a' } })

    await prisma.knowledgeArticle.delete({ where: { id: articleId } })

    expect(await prisma.knowledgeArticleCategory.count({ where: { article_id: articleId } })).toBe(0)
    expect(await prisma.knowledgeChunk.count({ where: { article_id: articleId } })).toBe(0)
  })

  it('interação existe sem chamado, com os padrões de relatório', async () => {
    const articleId = await newArticle('Interação')
    const row = await prisma.aiInteraction.create({
      data: { user_id: userId, question: 'Como limpo a fila da impressora?', sources: [{ article_id: articleId, title: 'Impressora' }] },
    })
    interactions.push(row.id)
    expect(row).toMatchObject({
      ticket_id: null, org_id: null, answer: null, confidence: null, feedback: null, accepted: false,
      sources: [{ article_id: articleId, title: 'Impressora' }],
    })

    const updated = await prisma.aiInteraction.update({
      where: { id: row.id },
      data: { answer: 'Reinicie o spooler.', confidence: 0.91, feedback: 'not_useful', accepted: true, org_id: orgId },
    })
    expect(updated).toMatchObject({ confidence: 0.91, feedback: 'not_useful', accepted: true, org_id: orgId })
  })

  // A lixeira expurga chamados com DELETE de verdade: a interação fica para o relatório.
  it('expurgar o chamado mantém a interação, sem o vínculo', async () => {
    const ticketId = `KBS-${Date.now()}`
    await prisma.ticket.create({
      data: {
        id: ticketId, title: 'Impressora', description: 'parada', user_id: userId, org_id: orgId, category_id: catA,
        priority: 'medium', display_number: `INC-7${Date.now() % 100000}`, sla_deadline: new Date(Date.now() + 864e5),
      },
    })
    tickets.push(ticketId)
    const row = await prisma.aiInteraction.create({ data: { ticket_id: ticketId, user_id: userId, question: 'q', sources: [] } })
    interactions.push(row.id)

    await prisma.ticket.delete({ where: { id: ticketId } })

    expect((await prisma.aiInteraction.findUniqueOrThrow({ where: { id: row.id } })).ticket_id).toBeNull()
  })
})
