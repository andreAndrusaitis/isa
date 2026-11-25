import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { buildDocState, cleanText, docFromState, extractText, isValidUpdate, replaceContent, safeStateVector } from './docContent'

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('conteúdo Yjs', () => {
  it('monta nós do editor com marcas e atributos', () => {
    const doc = docFromState(buildDocState([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Título' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'negrito', marks: ['bold'] }, { type: 'text', text: ' fim' }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('feito')] }] },
    ]))
    const [h, p, list] = doc.getXmlFragment('default').toArray() as Y.XmlElement[]
    expect([h.nodeName, h.getAttribute('level')]).toEqual(['heading', 2])
    expect((p.get(0) as Y.XmlText).toDelta()).toEqual([{ insert: 'a ' }, { insert: 'negrito', attributes: { bold: {} } }, { insert: ' fim' }])
    expect((list.get(0) as Y.XmlElement).getAttribute('checked')).toBe(true)
    expect(extractText(doc)).toBe('Título\na negrito fim\nfeito')
  })

  it('menção entra na linha e o texto sai limpo', () => {
    const doc = docFromState(buildDocState([{ type: 'paragraph', content: [{ type: 'text', text: 'oi ' }, { type: 'mention', attrs: { id: '1', label: 'Ana' } }, { type: 'text', text: '\u0000!' }] }]))
    expect(extractText(doc)).toBe('oi Ana!')
    expect(cleanText('a\ud800b\udc00😀')).toBe('ab😀')
  })

  it('troca o conteúdo e o update leva outro documento ao mesmo estado', () => {
    const doc = docFromState(buildDocState([para('velho')]))
    const peer = docFromState(Y.encodeStateAsUpdate(doc))
    const update = replaceContent(doc, docFromState(buildDocState([para('novo'), { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'x' }] }])))
    Y.applyUpdate(peer, update)
    expect(extractText(peer)).toBe('novo\nx')
    expect(peer.getXmlFragment('default').toString()).toBe(doc.getXmlFragment('default').toString())
  })

  it('update inválido e state vector inválido são detectados', () => {
    expect(isValidUpdate(buildDocState([para('ok')]))).toBe(true)
    for (const bad of [Buffer.from('lixo'), Buffer.alloc(300, 255), Buffer.from([1, 200, 200, 200, 8, 1, 0])]) expect(isValidUpdate(bad)).toBe(false)
    expect(safeStateVector(Buffer.from('lixo lixo'))).toBeUndefined()
    expect(safeStateVector('x')).toBeUndefined()
    expect(safeStateVector(Buffer.from(Y.encodeStateVector(new Y.Doc())))).toBeDefined()
  })
})
