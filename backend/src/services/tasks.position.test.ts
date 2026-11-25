import { describe, it, expect } from 'vitest'
import { updateTaskSchema } from './tasks'

describe('updateTaskSchema — campo position', () => {
  it('aceita position como número opcional', () => {
    const result = updateTaskSchema.safeParse({ position: 3 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.position).toBe(3)
  })

  it('continua opcional (não quebra payloads existentes)', () => {
    const result = updateTaskSchema.safeParse({ title: 'Nova task' })
    expect(result.success).toBe(true)
  })
})
