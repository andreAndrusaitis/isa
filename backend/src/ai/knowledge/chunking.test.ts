import { describe, it, expect } from 'vitest'
import { chunkText, MAX_WORDS, MIN_WORDS, OVERLAP_WORDS } from './chunking'

const text = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const words = (s: string) => s.split(/\s+/)

/** Palavras repetidas entre o fim de um pedaço e o começo do seguinte. */
const overlap = (a: string, b: string) => {
  const first = words(b)[0]
  return words(a).length - words(a).indexOf(first)
}

function expectSound(total: number, minOverlap = OVERLAP_WORDS) {
  const chunks = chunkText(text(total))
  for (const c of chunks) {
    expect(words(c).length).toBeGreaterThanOrEqual(MIN_WORDS)
    expect(words(c).length).toBeLessThanOrEqual(MAX_WORDS)
  }
  for (let i = 1; i < chunks.length; i++) expect(overlap(chunks[i - 1], chunks[i])).toBeGreaterThanOrEqual(minOverlap)
  // Nenhuma palavra fica de fora.
  expect(words(chunks[0])[0]).toBe('w0')
  expect(words(chunks[chunks.length - 1]).pop()).toBe(`w${total - 1}`)
  expect(new Set(chunks.flatMap(words)).size).toBe(total)
  return chunks
}

describe('chunkText', () => {
  it('texto vazio não gera pedaço', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('  \n ')).toEqual([])
  })

  it('artigo curto vira um pedaço só, mesmo abaixo de 300 palavras', () => {
    expect(chunkText('Reinicie o serviço.')).toEqual(['Reinicie o serviço.'])
    expect(chunkText(text(MAX_WORDS))).toHaveLength(1)
  })

  it('1.000 palavras geram de 2 a 4 pedaços, com 50 palavras repetidas entre eles', () => {
    const chunks = expectSound(1000)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.length).toBeLessThanOrEqual(4)
    for (let i = 1; i < chunks.length; i++) {
      expect(overlap(chunks[i - 1], chunks[i])).toBeGreaterThanOrEqual(OVERLAP_WORDS)
      expect(overlap(chunks[i - 1], chunks[i])).toBeLessThanOrEqual(OVERLAP_WORDS + 1)
    }
  })

  it('logo acima do limite, os dois pedaços ficam com 300 palavras e repetem mais de 50', () => {
    const chunks = expectSound(MAX_WORDS + 1)
    expect(chunks.map(c => words(c).length)).toEqual([300, 300])
    expect(overlap(chunks[0], chunks[1])).toBe(99)
  })

  it('respeita tamanho e sobreposição em todas as fronteiras', () => {
    for (const total of [549, 550, 551, 950, 951, 1400, 1401, 5000]) expectSound(total)
  })

  it('artigo enorme mantém todos os pedaços no tamanho, inclusive o último', () => {
    const chunks = expectSound(100_000)
    expect(words(chunks[chunks.length - 1]).length).toBeGreaterThanOrEqual(MIN_WORDS)
  })

  it('mantém as quebras de linha do original dentro do pedaço', () => {
    const paragraphs = `${text(10)}\n\n${text(600)}`
    expect(chunkText(paragraphs)[0]).toContain('\n\n')
  })
})
