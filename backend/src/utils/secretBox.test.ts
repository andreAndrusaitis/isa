import { describe, expect, it } from 'vitest'
import { open, seal } from './secretBox'

describe('secretBox', () => {
  it('abre o que cifrou e nunca repete o texto cifrado', () => {
    const a = seal('segredo', 'sso.clientSecret')
    expect(a).not.toContain('segredo')
    expect(seal('segredo', 'sso.clientSecret')).not.toBe(a)
    expect(open(a, 'sso.clientSecret')).toBe('segredo')
  })

  it('não abre em outro campo, adulterado ou com marca de autenticação curta', () => {
    const a = seal('segredo', 'sso.clientSecret')
    expect(open(a, 'ai.apiKey')).toBeNull()
    const [v, iv, tag, body] = a.split('.')
    const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1)
    expect(open([v, iv, tag, flipped].join('.'), 'sso.clientSecret')).toBeNull()
    expect(open([v, iv, tag.slice(0, 6), body].join('.'), 'sso.clientSecret')).toBeNull()
    expect(open('lixo', 'sso.clientSecret')).toBeNull()
  })
})
