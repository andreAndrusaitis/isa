import { describe, it, expect } from 'vitest'
import { env } from './env'

describe('ambiente de testes', () => {
  it('a suíte nunca chama a IA real', () => {
    expect(env.AI_TRIAGE_MODE).toBe('off')
    expect(env.AI_INTAKE_MODE).toBe('off')
  })
})
