import { describe, it, expect, afterAll, vi } from 'vitest'
import prisma from '../../config/prisma'
import { performance } from 'node:perf_hooks'
import { cosine, rank, similarExamples, upsertExamples, warmExamples, MIN_SCORE, LOAD_BATCH } from './examples'
import type { EmbedFn } from './embeddings'

describe('cosine/rank', () => {
  it('cosseno: igual = 1, ortogonal = 0, oposto = -1, vetor nulo = 0', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  it('rank ordena por score, corta no mínimo e limita a k', () => {
    const rows = [
      { id: '1', text: 'longe', labels: {}, embedding: [0, 1] },
      { id: '2', text: 'perto', labels: { type: 'incident' }, embedding: [1, 0.1] },
      { id: '3', text: 'meio', labels: {}, embedding: [1, 1] },
      { id: '4', text: 'outro perto', labels: {}, embedding: [1, 0.2] },
    ]
    const r = rank([1, 0], rows, 2, MIN_SCORE)
    expect(r.map(x => x.text)).toEqual(['perto', 'outro perto'])
    expect(r[0].labels).toEqual({ type: 'incident' })
    expect(rank([1, 0], rows, 10, 0.5).map(x => x.text)).toEqual(['perto', 'outro perto', 'meio'])
  })
})

// Banco real (rodar contra o 5434). Agente exclusivo do teste: limpeza só do que criou.
const AGENT = `test-rag-${Date.now()}`
const VECTORS: Record<string, number[]> = {
  'VPN não conecta': [1, 0, 0],
  'Criar usuário no AD': [0, 1, 0],
  'Impressora sem toner': [0, 0, 1],
  'VPN caiu de novo': [0.9, 0.1, 0],
}
const fakeEmbed: EmbedFn = async texts => texts.map(t => VECTORS[t])

afterAll(async () => {
  await prisma.aiExample.deleteMany({ where: { agent: AGENT } })
  await prisma.$disconnect()
})

describe('upsertExamples + similarExamples', () => {
  it('grava, atualiza sem duplicar e devolve os parecidos acima do corte', async () => {
    expect(await similarExamples(AGENT, 'VPN caiu de novo', 5, { embed: fakeEmbed })).toEqual([])

    await upsertExamples(AGENT, 'backlog', [
      { sourceId: '1', text: 'VPN não conecta', labels: { type: 'incident' } },
      { sourceId: '2', text: 'Criar usuário no AD', labels: { type: 'request' } },
    ], fakeEmbed)
    await upsertExamples(AGENT, 'backlog', [
      { sourceId: '1', text: 'VPN não conecta', labels: { type: 'incident', urgency: 'high' } },
      { sourceId: '3', text: 'Impressora sem toner', labels: { type: 'request' } },
    ], fakeEmbed)

    expect(await prisma.aiExample.count({ where: { agent: AGENT } })).toBe(3)
    const r = await similarExamples(AGENT, 'VPN caiu de novo', 5, { embed: fakeEmbed })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ text: 'VPN não conecta', labels: { type: 'incident', urgency: 'high' } })
    expect(r[0].score).toBeGreaterThan(0.9)
  })
})

describe('cache do índice (single-flight)', () => {
  const AGENT2 = `${AGENT}-sf`
  // spyOn puro no delegate do Prisma devolve undefined e o mockRestore o quebra:
  // repassa ao original capturado e não restaura (contagem filtrada pelo agente).
  const spy = (m: 'findMany' | 'count') => {
    const orig = (prisma.aiExample as any)[m]
    return vi.spyOn(prisma.aiExample, m).mockImplementation(((a: any) => orig(a)) as any)
  }
  const findMany = spy('findMany')
  const count = spy('count')
  const callsFor = (s: typeof findMany | typeof count, agent: string) =>
    s.mock.calls.filter(([a]) => (a as any)?.where?.agent === agent).length
  afterAll(async () => { await prisma.aiExample.deleteMany({ where: { agent: AGENT2 } }) })

  it('N chamadas simultâneas com cache frio carregam a tabela 1 vez; só recarrega quando o count muda', async () => {
    await upsertExamples(AGENT2, 'backlog', [
      { sourceId: '1', text: 'VPN não conecta', labels: { type: 'incident' } },
      { sourceId: '2', text: 'Criar usuário no AD', labels: { type: 'request' } },
    ], fakeEmbed)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const calls = () => callsFor(findMany, AGENT2)
      const counts = () => callsFor(count, AGENT2)

      const all = await Promise.all(Array.from({ length: 10 }, () => similarExamples(AGENT2, 'VPN caiu de novo', 5, { embed: fakeEmbed })))
      expect(all.every(r => r[0]?.text === 'VPN não conecta')).toBe(true)
      expect(calls()).toBe(1)
      expect(counts()).toBe(1)

      // Dentro da janela de checagem: nem count nem findMany.
      await Promise.all(Array.from({ length: 10 }, () => similarExamples(AGENT2, 'VPN caiu de novo', 5, { embed: fakeEmbed })))
      expect(counts()).toBe(1)

      // Passada a janela, count igual: 1 checagem compartilhada, sem recarga.
      vi.setSystemTime(Date.now() + 31_000)
      await Promise.all(Array.from({ length: 10 }, () => similarExamples(AGENT2, 'VPN caiu de novo', 5, { embed: fakeEmbed })))
      expect(counts()).toBe(2)
      expect(calls()).toBe(1)

      // Count mudou (gravado por "outro processo", sem invalidar o cache): recarrega 1 vez.
      await prisma.aiExample.create({ data: { agent: AGENT2, source: 'ticket', source_id: 'x', text: 'VPN caiu de novo', labels: {}, embedding: [0.9, 0.1, 0] } })
      vi.setSystemTime(Date.now() + 31_000)
      const r = await Promise.all(Array.from({ length: 10 }, () => similarExamples(AGENT2, 'VPN caiu de novo', 5, { embed: fakeEmbed })))
      expect(calls()).toBe(2)
      expect(r[0][0].text).toBe('VPN caiu de novo')
    } finally { vi.useRealTimers() }
  })

  it('carga em lotes não trava o event loop e o índice (Float32Array) ranqueia certo', async () => {
    const AGENT3 = `${AGENT}-lotes`
    const N = 2 * LOAD_BATCH + 20 // 3 lotes, o último parcial
    try {
      // Vetores aleatórios de 1536 dims gerados no Postgres (createMany pelo Prisma levava segundos).
      await prisma.$executeRaw`
        INSERT INTO ai_examples (id, agent, source, source_id, text, labels, embedding)
        SELECT gen_random_uuid()::text, ${AGENT3}, 'backlog', i::text, 'ex ' || i, jsonb_build_object('i', i),
               ARRAY(SELECT random() - 0.5 FROM generate_series(1, 1536) WHERE i IS NOT NULL)
        FROM generate_series(0, ${N - 1}) i`

      // Maior intervalo sem tick de um timer de 10 ms durante a carga = maior trava do event loop.
      let last = performance.now(), maxGap = 0
      const t = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n }, 10)
      try {
        expect(await warmExamples(AGENT3)).toBe(N)
        maxGap = Math.max(maxGap, performance.now() - last)
      } finally { clearInterval(t) }

      expect(callsFor(findMany, AGENT3)).toBe(Math.ceil(N / LOAD_BATCH))
      expect(maxGap).toBeLessThan(200)

      const { embedding } = await prisma.aiExample.findFirstOrThrow({ where: { agent: AGENT3, source_id: '77' } })
      const r = await similarExamples(AGENT3, 'q', 1, { embed: async () => [embedding] })
      expect(r[0]).toMatchObject({ text: 'ex 77', labels: { i: 77 } })
      expect(r[0].score).toBeCloseTo(1, 5)
    } finally { await prisma.aiExample.deleteMany({ where: { agent: AGENT3 } }) }
  }, 60_000)

  it('agente sem exemplos não carrega a tabela', async () => {
    expect(await warmExamples(`${AGENT}-vazio`)).toBe(0)
    expect(callsFor(findMany, `${AGENT}-vazio`)).toBe(0)
    expect(callsFor(count, `${AGENT}-vazio`)).toBe(1)
  })
})
