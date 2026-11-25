export const MIN_WORDS = 300
export const MAX_WORDS = 500
export const OVERLAP_WORDS = 50

/**
 * Divide em pedaços iguais de 300 a 500 palavras, cada um repetindo ao menos 50
 * do anterior; até 500 palavras vira um pedaço só. O texto sai do original, com
 * as quebras de linha, para a resposta da IA citar o trecho como foi escrito.
 *
 * Entre 501 e 549 palavras, dois pedaços de 300 só cabem repetindo mais de 50:
 * ali o tamanho mínimo vence a sobreposição exata.
 */
export function chunkText(content: string): string[] {
  const words = [...content.matchAll(/\S+/g)]
  if (!words.length) return []
  if (words.length <= MAX_WORDS) return [content.trim()]

  const pieces = Math.ceil((words.length - OVERLAP_WORDS) / (MAX_WORDS - OVERLAP_WORDS))
  const size = Math.max(MIN_WORDS, Math.ceil((words.length + OVERLAP_WORDS * (pieces - 1)) / pieces))

  return Array.from({ length: pieces }, (_, i) => {
    // Inícios distribuídos: o resto da divisão não sobra para o último pedaço.
    const start = Math.floor(i * (words.length - size) / (pieces - 1))
    const last = words[start + size - 1]
    return content.slice(words[start].index, last.index + last[0].length)
  })
}
