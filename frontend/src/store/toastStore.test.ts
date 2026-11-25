import { describe, it, expect } from 'vitest'
import { readingTime } from './toastStore'

describe('readingTime', () => {
  it('mensagem curta fica o mínimo de 4s', () => {
    expect(readingTime('Salvo!')).toBe(4000)
  })
  it('explicação longa fica tempo suficiente para ser lida (limitado a 15s)', () => {
    const msg = 'Este chamado é da empresa Acme, que não está na sua carteira. Peça ao administrador para incluí-la na sua carteira (ou na do seu gerente).'
    expect(readingTime(msg)).toBeGreaterThan(8000)
    expect(readingTime('x'.repeat(1000))).toBe(15000)
  })
})
