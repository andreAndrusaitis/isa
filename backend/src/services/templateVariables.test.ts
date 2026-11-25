import { describe, it, expect } from 'vitest'
import { TEMPLATE_VARIABLES, EXAMPLE_VARS, EMPTY_VALUE, renderTemplate, findUnknownVariables } from './templateVariables'

describe('renderTemplate', () => {
  it.each(TEMPLATE_VARIABLES.map(v => v.key))('substitui {%s}', key => {
    expect(renderTemplate(`[{${key}}]`, { [key]: 'VALOR' })).toBe('[VALOR]')
  })

  it('variável sem valor vira "—", nunca {…}', () => {
    const all = TEMPLATE_VARIABLES.map(v => `{${v.key}}`).join(' ')
    const out = renderTemplate(all, { nome_usuario: '  ', empresa: null })
    expect(out).not.toMatch(/\{[a-z_]+\}/)
    expect(out.split(' ').every(p => p === EMPTY_VALUE)).toBe(true)
  })

  it('exemplo preenche todas e repete ocorrências', () => {
    expect(renderTemplate('{numero_chamado}/{numero_chamado}', EXAMPLE_VARS)).toBe('INC-000123/INC-000123')
  })

  it('alias antigo {nome_cliente} continua funcionando', () => {
    expect(renderTemplate('Olá {nome_cliente}', { nome_usuario: 'Ana' })).toBe('Olá Ana')
  })

  it('desconhecida fica intacta e o lint aponta', () => {
    expect(renderTemplate('{foo_bar}', EXAMPLE_VARS)).toBe('{foo_bar}')
    expect(findUnknownVariables('{foo} {nome_usuario} {nome_cliente} {foo}')).toEqual(['foo'])
  })
})
