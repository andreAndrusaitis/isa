import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { AiError } from '../core/llm'
import type { EmbedFn } from '../core/embeddings'
import { searchChunks } from './search'

const SUFFIX = `kbsearch-${Date.now()}`

// Vetor unitário no plano das duas primeiras posições: contra a pergunta (ângulo 0),
// a distância de cosseno é 1 - cos(ângulo) e o score esperado é cos(ângulo).
const at = (degrees: number) => {
  const v = new Array<number>(1536).fill(0)
  v[0] = Math.cos((degrees * Math.PI) / 180)
  v[1] = Math.sin((degrees * Math.PI) / 180)
  return v
}
const embedAt = (degrees = 0) => vi.fn<EmbedFn>(async texts => texts.map(() => at(degrees)))

const orgs: string[] = [], users: string[] = [], cats: string[] = [], slas: string[] = [], articles: string[] = []
let authorId: string

async function plan(name: string, categoryIds: string[]) {
  const tier = `${name}-${SUFFIX}`
  const sla = await prisma.slaConfig.create({ data: { tier, incident_first_response_hours: 1, incident_resolution_hours: 4 } })
  slas.push(sla.id)
  if (categoryIds.length) await prisma.planCategory.createMany({ data: categoryIds.map(category_id => ({ sla_config_id: sla.id, category_id })) })
  return tier
}

async function category(name: string, active = true) {
  const c = await prisma.category.create({ data: { name: `${name} ${SUFFIX}`, active } })
  cats.push(c.id)
  return c.id
}

async function org(name: string, tier: string, extra: { active?: boolean; deleted_at?: Date; expires_at?: Date } = {}) {
  const o = await prisma.organization.create({ data: { name: `${name} ${SUFFIX}`, tier, ...extra } })
  orgs.push(o.id)
  return o.id
}

async function user(name: string, orgId: string | null, extra: { active?: boolean; deleted_at?: Date } = {}) {
  const u = await prisma.user.create({
    data: { name: `${name} ${SUFFIX}`, email: `${name}-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId, ...extra },
  })
  users.push(u.id)
  return u.id
}

interface ArticleSpec { categoryIds: string[]; angles: (number | null)[]; status?: 'draft' | 'published'; deleted?: boolean }

/** Grava direto no banco: o filtro da busca tem de valer mesmo se sobrar trecho de artigo que saiu de publicado. */
async function article(title: string, spec: ArticleSpec) {
  const a = await prisma.knowledgeArticle.create({
    data: {
      title: `${title} ${SUFFIX}`, content: title, status: spec.status ?? 'published',
      deleted_at: spec.deleted ? new Date() : null,
      created_by_id: authorId, updated_by_id: authorId,
      categories: { create: spec.categoryIds.map(category_id => ({ category_id })) },
    },
  })
  articles.push(a.id)
  for (const [position, angle] of spec.angles.entries()) {
    const vector = angle === null ? null : JSON.stringify(at(angle))
    await prisma.$executeRaw`
      INSERT INTO knowledge_chunks (id, article_id, position, text, embedding, updated_at)
      VALUES (${randomUUID()}, ${a.id}, ${position}, ${`${title} trecho ${position}`}, ${vector}::vector, CURRENT_TIMESTAMP)`
  }
  return a.id
}

const ids = (hits: { articleId: string }[]) => hits.map(h => h.articleId)

let catA: string, catA2: string, catB: string, catBlocked: string, catOff: string
let tierA: string, userA: string, userB: string, orgAId: string

beforeAll(async () => {
  catA = await category('A')
  catA2 = await category('A2')
  catB = await category('B')
  catBlocked = await category('Bloqueada')
  catOff = await category('Inativa', false)

  tierA = await plan('a', [catA, catA2, catBlocked, catOff])
  const tierB = await plan('b', [catB, catBlocked])

  orgAId = await org('Empresa A', tierA)
  const orgBId = await org('Empresa B', tierB)
  await prisma.orgCategoryBlock.create({ data: { org_id: orgAId, category_id: catBlocked } })

  userA = await user('usuario-a', orgAId)
  userB = await user('usuario-b', orgBId)
  authorId = await user('autor', orgAId)
})

afterAll(async () => {
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articles } } }) // cascata: categorias e chunks
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } })
  await prisma.slaConfig.deleteMany({ where: { id: { in: slas } } })
  await prisma.category.deleteMany({ where: { id: { in: cats } } })
  await prisma.$disconnect()
})

describe('searchChunks: o que cada empresa vê', () => {
  it('onlyCategoryIds estreita a busca, nunca amplia; lista vazia não acha nada e não gasta embedding', async () => {
    const inA = await article('Em A', { categoryIds: [catA], angles: [0] })
    const inA2 = await article('Em A2', { categoryIds: [catA2], angles: [0] })

    const narrowed = ids(await searchChunks('impressora', userA, { embed: embedAt(), onlyCategoryIds: [catA2] }))
    expect(narrowed).toContain(inA2)
    expect(narrowed).not.toContain(inA)

    const embed = embedAt()
    expect(await searchChunks('impressora', userA, { embed, onlyCategoryIds: [catB] })).toEqual([])
    expect(await searchChunks('impressora', userA, { embed, onlyCategoryIds: [] })).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })

  it('empresa nunca recebe trecho de artigo só de categoria de outro plano', async () => {
    const fromA = await article('Só de A', { categoryIds: [catA], angles: [30] })
    const fromB = await article('Só de B', { categoryIds: [catB], angles: [0] })

    const a = ids(await searchChunks('impressora', userA, { embed: embedAt() }))
    const b = ids(await searchChunks('impressora', userB, { embed: embedAt() }))

    expect(a).toContain(fromA)
    expect(a).not.toContain(fromB)
    expect(b).toContain(fromB)
    expect(b).not.toContain(fromA)
  })

  it('bloqueio vale só para a empresa bloqueada', async () => {
    const blocked = await article('Bloqueado', { categoryIds: [catBlocked], angles: [0] })

    expect(ids(await searchChunks('impressora', userA, { embed: embedAt() }))).not.toContain(blocked)
    expect(ids(await searchChunks('impressora', userB, { embed: embedAt() }))).toContain(blocked)
  })

  it('rascunho, excluído e artigo só de categoria inativa nunca aparecem', async () => {
    const draft = await article('Rascunho', { categoryIds: [catA], angles: [0], status: 'draft' })
    const deleted = await article('Excluído', { categoryIds: [catA], angles: [0], deleted: true })
    const inactive = await article('Inativa', { categoryIds: [catOff], angles: [0] })

    const found = ids(await searchChunks('impressora', userA, { embed: embedAt() }))
    expect(found).not.toContain(draft)
    expect(found).not.toContain(deleted)
    expect(found).not.toContain(inactive)
  })

  it('ativa e permitida precisam ser a mesma categoria', async () => {
    // Inativa do plano de A + ativa do plano de B: duas meias condições não abrem o artigo para A.
    const mixed = await article('Misto', { categoryIds: [catOff, catB], angles: [0] })

    expect(ids(await searchChunks('impressora', userA, { embed: embedAt() }))).not.toContain(mixed)
    expect(ids(await searchChunks('impressora', userB, { embed: embedAt() }))).toContain(mixed)
  })

  it('artigo em várias categorias aparece para quem pode ver só uma delas', async () => {
    const shared = await article('Compartilhado', { categoryIds: [catA, catB], angles: [0] })

    expect(ids(await searchChunks('impressora', userA, { embed: embedAt() }))).toContain(shared)
    expect(ids(await searchChunks('impressora', userB, { embed: embedAt() }))).toContain(shared)
  })

  it('categoria inativa não derruba o artigo que tem outra ativa e permitida', async () => {
    const partly = await article('Meio ativo', { categoryIds: [catOff, catA], angles: [0] })

    expect(ids(await searchChunks('impressora', userA, { embed: embedAt() }))).toContain(partly)
  })
})

describe('searchChunks: resultado', () => {
  let cat: string, userId: string

  beforeAll(async () => {
    cat = await category('Resultado')
    const cat2 = await category('Resultado 2')
    userId = await user('resultado', await org('Empresa Resultado', await plan('resultado', [cat, cat2])))
    await article('Duas categorias', { categoryIds: [cat, cat2], angles: [10] })
    await article('Vários trechos', { categoryIds: [cat], angles: [60, 20, 40, 30, 50, 70, 80] })
    await article('Sem vetor', { categoryIds: [cat], angles: [null] })
  })

  it('ordena por similaridade, limita a 5 e não duplica artigo de duas categorias', async () => {
    const hits = await searchChunks('impressora', userId, { embed: embedAt() })

    expect(hits.map(h => h.text)).toEqual([
      'Duas categorias trecho 0',
      'Vários trechos trecho 1',
      'Vários trechos trecho 3',
      'Vários trechos trecho 2',
      'Vários trechos trecho 4',
    ])
  })

  it('devolve artigo, título, texto, posição e score = 1 - distância', async () => {
    const [first, second] = await searchChunks('impressora', userId, { embed: embedAt() })

    expect(first.title).toBe(`Duas categorias ${SUFFIX}`)
    expect(articles).toContain(first.articleId)
    expect(first.position).toBe(0)
    expect(first.score).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 5)
    expect(second.position).toBe(1)
    expect(second.score).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 5)
  })

  it('o score acompanha a pergunta', async () => {
    const [exact] = await searchChunks('impressora', userId, { embed: embedAt(10) })
    expect(exact.text).toBe('Duas categorias trecho 0')
    expect(exact.score).toBeCloseTo(1, 5)
  })

  it('trecho sem vetor não aparece', async () => {
    const hits = await searchChunks('impressora', userId, { embed: embedAt() })
    expect(hits.map(h => h.text)).not.toContain('Sem vetor trecho 0')
  })

  it('manda só a pergunta ao embed, com o orçamento pedido', async () => {
    const embed = embedAt()
    await searchChunks('impressora', userId, { embed, timeoutMs: 1234 })

    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed).toHaveBeenCalledWith(['impressora'], { timeoutMs: 1234 })
  })

  it.each([
    `O'Brien disse "impressora" \\ parou`,
    `'; DROP TABLE knowledge_chunks; --`,
    `$1::vector) OR 1=1 --`,
  ])('pergunta hostil não quebra: %s', async question => {
    const embed = embedAt()
    expect(await searchChunks(question, userId, { embed })).toHaveLength(5)
    expect(embed).toHaveBeenCalledWith([question], expect.anything())
  })

  it('trechos proibidos mais próximos não escondem os permitidos', async () => {
    // Mais vizinhos que o hnsw.ef_search padrão (40): sem a varredura iterativa,
    // o índice só entregaria proibidos e o filtro devolveria menos linhas.
    const near = await category('Vizinha')
    const far = await category('Distante')
    await plan('vizinho', [near])
    const lonely = await user('filtrado', await org('Empresa Filtrada', await plan('filtrado', [far])))
    await article('Proibido', { categoryIds: [near], angles: Array.from({ length: 60 }, (_, i) => i / 100) })
    const allowed = await article('Permitido', { categoryIds: [far], angles: [80, 81, 82, 83, 84, 85] })

    const hits = await searchChunks('impressora', lonely, { embed: embedAt() })

    expect(ids(hits)).toEqual(new Array(5).fill(allowed))
    expect(hits.map(h => h.position)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('searchChunks: fail-closed', () => {
  async function expectEmpty(userId: string, question = 'impressora') {
    const embed = embedAt()
    expect(await searchChunks(question, userId, { embed })).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  }

  beforeAll(async () => {
    // Conteúdo visível pela categoria: quem aparecer vazio aqui está vazio pela regra, não por falta de artigo.
    await article('Base', { categoryIds: [catA], angles: [0] })
  })

  it('usuário inativo', async () => {
    await expectEmpty(await user('inativo', orgAId, { active: false }))
  })

  it('usuário excluído', async () => {
    await expectEmpty(await user('excluido', orgAId, { deleted_at: new Date() }))
  })

  it('usuário sem empresa', async () => {
    await expectEmpty(await user('sem-empresa', null))
  })

  it('usuário que não existe', async () => {
    await expectEmpty(randomUUID())
  })

  it('empresa excluída', async () => {
    await expectEmpty(await user('org-excluida', await org('Excluída', tierA, { deleted_at: new Date() })))
  })

  it('empresa inativa', async () => {
    await expectEmpty(await user('org-inativa', await org('Inativa', tierA, { active: false })))
  })

  it('plano vencido devolve vazio, não 403', async () => {
    await expectEmpty(await user('org-vencida', await org('Vencida', tierA, { expires_at: new Date(Date.now() - 86_400_000) })))
  })

  it('plano sem categoria', async () => {
    await expectEmpty(await user('plano-vazio', await org('Plano vazio', await plan('vazio', []))))
  })

  it('todas as categorias do plano bloqueadas para a empresa', async () => {
    const only = await category('Única')
    const orgId = await org('Tudo bloqueado', await plan('unico', [only]))
    await prisma.orgCategoryBlock.create({ data: { org_id: orgId, category_id: only } })
    await expectEmpty(await user('tudo-bloqueado', orgId))
  })

  it('pergunta em branco não gasta embedding', async () => {
    await expectEmpty(userA, '   ')
  })
})

describe('searchChunks: falha do embedding', () => {
  it('erro da IA chega a quem chamou', async () => {
    const embed = vi.fn<EmbedFn>(async () => { throw new AiError('AI_TIMEOUT', 'LLM timeout') })
    await expect(searchChunks('impressora', userA, { embed })).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
  })

  it.each([
    ['tamanho errado', [[1, 0, 0]]],
    ['nenhum vetor', []],
    ['NaN', [[...at(0).slice(1), NaN]]],
  ])('vetor inesperado vira AI_UNAVAILABLE: %s', async (_, vectors) => {
    const embed = vi.fn<EmbedFn>(async () => vectors)
    await expect(searchChunks('impressora', userA, { embed })).rejects.toMatchObject({ name: 'AiError', code: 'AI_UNAVAILABLE' })
  })

  it('sem IA configurada falha como IA indisponível', async () => {
    const { AZURE_AI_ENDPOINT, AZURE_AI_KEY } = env
    env.AZURE_AI_ENDPOINT = undefined
    env.AZURE_AI_KEY = undefined
    try {
      await expect(searchChunks('impressora', userA)).rejects.toMatchObject({ name: 'AiError', code: 'AI_UNAVAILABLE' })
    } finally {
      env.AZURE_AI_ENDPOINT = AZURE_AI_ENDPOINT
      env.AZURE_AI_KEY = AZURE_AI_KEY
    }
  })
})
