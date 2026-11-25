import { describe, expect, it } from 'vitest'
import { AI_NAME, AI_SIGNATURE, signedByAi } from './persona'

describe('identidade da assistente de IA', () => {
  it('tem a grafia exata e assina com o nome', () => {
    expect(AI_NAME).toBe('Skadi')
    expect(AI_SIGNATURE).toBe('— Skadi')
  })

  it('reconhece a assinatura atual e a dos chamados já gravados', () => {
    expect(signedByAi('Bom dia!\n— Skadi')).toBe(true)
    expect(signedByAi('Bom dia!\n— Assistente ISA')).toBe(true)
    expect(signedByAi('Troquei o cabo de rede e voltou.')).toBe(false)
  })
})
