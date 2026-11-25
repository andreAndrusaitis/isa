import { describe, it, expect } from 'vitest'
import { contextMessages, examplesBlock, justificationMessages, parseJustification } from './prompt'
import type { Evidence } from '../../core/ticketEvidence'

const e: Evidence = { text: 'Título: Teams caiu', userCategory: 'Teams Geral', fileNames: [], images: [] }

describe('prompt', () => {
  it('contexto = sistema + evidência', () => {
    const m = contextMessages(e, false)
    expect(m.map(x => x.role)).toEqual(['system', 'user'])
    expect((m[1].content as any[])[0].text).toContain('Título: Teams caiu')
  })

  it('com exemplos, o bloco few-shot vem depois da evidência com rótulos em português', () => {
    const m = contextMessages(e, false, [
      { id: 'e1', text: 'Teams não abre', labels: { type: 'incident', urgency: 'high', impact: 'low', tema: 'teams' }, score: 0.8 },
      { id: 'e2', text: 'Licença Teams', labels: { type: null, urgency: 'low', impact: 'low' }, score: 0.6 },
    ])
    expect(m.map(x => x.role)).toEqual(['system', 'user', 'user'])
    expect(m[2].content).toBe(
      'Chamados parecidos já classificados por analistas (referência, não regra):\n' +
      '- "Teams não abre" → tipo: Incidente; urgência: Alta; impacto: Baixo\n' +
      '- "Licença Teams" → urgência: Baixa; impacto: Baixo',
    )
    expect(contextMessages(e, false, [])).toHaveLength(2)
    expect(examplesBlock([])).toContain('referência, não regra')
  })

  it('justificativa pede JSON com trecho literal por pergunta', () => {
    const m = justificationMessages(e, [{ key: 'type', question: 'Qual é o tipo deste chamado?', answer: 'Incidente' }])
    expect(m[2].content).toContain('- type (Qual é o tipo deste chamado?): Incidente')
    expect(m[2].content).toContain('JSON')
  })

  it('parseJustification aceita chaves traduzidas pelo modelo (tipo, urgência)', () => {
    const j = parseJustification('{"justificativa":"ok","evidencias":{"tipo":{"trecho":"caiu"},"Urgência":{"trecho":"urgente"},"impact":{"trecho":"todos"}}}')
    expect(Object.keys(j.evidencias).sort()).toEqual(['impact', 'type', 'urgency'])
  })

  it('justificativa lista as chaves exatas que o JSON deve usar', () => {
    const m = justificationMessages(e, [{ key: 'type', question: 'q', answer: 'a' }, { key: 'urgency', question: 'q', answer: 'a' }])
    expect(m[m.length - 1].content).toContain('use exatamente estas chaves, sem traduzir: type, urgency')
  })

  it('parseJustification tolera JSON inválido', () => {
    expect(parseJustification('não é json')).toEqual({ justificativa: '', evidencias: {} })
    expect(parseJustification('{"justificativa":"ok","evidencias":{"type":{"trecho":"caiu","fonte":"texto"}}}'))
      .toEqual({ justificativa: 'ok', evidencias: { type: { trecho: 'caiu', fonte: 'texto' } } })
  })
})
