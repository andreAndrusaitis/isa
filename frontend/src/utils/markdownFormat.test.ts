import { describe, it, expect } from 'vitest'
import { applyMarkdown, type MarkdownAction } from './markdownFormat'

/** Aplica a ação e devolve o texto final e o trecho que ficou selecionado. */
function run(value: string, start: number, end: number, action: MarkdownAction) {
  const e = applyMarkdown(value, start, end, action)
  const text = value.slice(0, e.from) + e.text + value.slice(e.to)
  return { text, selected: text.slice(e.selStart, e.selEnd) }
}

describe('applyMarkdown', () => {
  it('coloca negrito no texto selecionado e mantém a seleção nele', () => {
    expect(run('um texto aqui', 3, 8, 'bold')).toEqual({ text: 'um **texto** aqui', selected: 'texto' })
  })

  it('sem seleção, insere um exemplo já selecionado para digitar por cima', () => {
    expect(run('', 0, 0, 'italic')).toEqual({ text: '_texto em itálico_', selected: 'texto em itálico' })
  })

  it('deixa os espaços da seleção fora das marcas', () => {
    expect(run('um texto aqui', 2, 9, 'bold').text).toBe('um **texto** aqui')
  })

  it('clicar de novo desfaz, com a seleção dentro ou em volta das marcas', () => {
    expect(run('um **texto** aqui', 5, 10, 'bold')).toEqual({ text: 'um texto aqui', selected: 'texto' })
    expect(run('um **texto** aqui', 3, 12, 'bold')).toEqual({ text: 'um texto aqui', selected: 'texto' })
  })

  it('transforma várias linhas em lista, pulando as vazias', () => {
    expect(run('a\n\nb', 0, 4, 'bullet').text).toBe('- a\n\n- b')
  })

  it('numera a lista e desfaz no segundo clique', () => {
    const lista = run('a\nb', 0, 3, 'numbered').text
    expect(lista).toBe('1. a\n2. b')
    expect(run(lista, 0, lista.length, 'numbered').text).toBe('a\nb')
  })

  it('aplica na linha do cursor quando não há seleção', () => {
    expect(run('um\ndois\ntrês', 4, 4, 'heading').text).toBe('um\n## dois\ntrês')
  })

  it('troca um tipo de linha por outro, sem acumular marcas', () => {
    expect(run('- item', 0, 6, 'quote').text).toBe('> item')
  })

  it('link usa a seleção como texto e deixa o endereço pronto para digitar', () => {
    expect(run('veja aqui', 5, 9, 'link')).toEqual({ text: 'veja [aqui](https://)', selected: 'https://' })
  })

  it('endereço selecionado vira o destino do link', () => {
    expect(run('https://example.com', 0, 19, 'link')).toEqual({ text: '[texto do link](https://example.com)', selected: 'texto do link' })
  })
})
