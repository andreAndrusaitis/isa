import { describe, it, expect } from 'vitest'
import { formatNote } from './note'
import type { TriageResult } from './triage'

const SAMPLE: TriageResult = {
  questions: [
    {
      key: 'type', options: [], probs: [0.06, 0.94], chosen: 'request', chosenLabel: 'Requisição',
      probability: 0.94, margin: 0.88, roundsAgree: true, evidence: 'criar usuários nominais',
      evidenceSource: 'texto', evidenceValid: true, confidence: 0.94, wouldApply: true,
    },
    {
      key: 'category', options: [], probs: [], chosen: 'c1', chosenLabel: 'Rede e VPN',
      probability: 0.71, margin: 0.5, roundsAgree: true, evidence: 'no firewall',
      evidenceSource: 'texto', evidenceValid: true, confidence: 0.71, wouldApply: false,
    },
  ],
  priority: { value: 'low', confidence: 0.66, wouldApply: false },
  justification: 'Pedido de criação de usuários.',
  inputTokens: 1000, outputTokens: 40,
}

describe('formatNote', () => {
  it('modo sombra: só o que precisa de revisão, sem emoji nem evidência', () => {
    const text = formatNote(SAMPLE, 'gpt-4.1-mini', 'Infra > infra')
    expect(text.split('\n')).toEqual([
      '**Triagem IA** — sem alterações (modo sombra) | Revisar: Categoria, Prioridade',
      '**Revisar:** Categoria Rede e VPN (71%); Prioridade Baixa (66%)',
      '**Por quê:** Pedido de criação de usuários.',
      'gpt-4.1-mini · triage-v4 · categoria do cliente: Infra > infra',
    ])
  })

  it('motivo da revisão por extenso, não 0%', () => {
    const [type] = SAMPLE.questions
    const text = formatNote({
      ...SAMPLE,
      questions: [
        { ...type, roundsAgree: false, confidence: 0, probability: 0.51, wouldApply: false },
        { ...type, key: 'urgency', chosenLabel: 'Alta', evidenceValid: false, confidence: 0, probability: 0.88, wouldApply: false },
      ],
      priority: { value: 'high', confidence: 0, wouldApply: false },
    }, 'm', null)
    expect(text).toContain('**Revisar:** Tipo Requisição (rodadas divergiram); Urgência Alta (sem evidência no texto); Prioridade Alta')
    expect(text).not.toContain(' 0%')
  })
})

describe('formatNote — portão', () => {
  const gate = (value: 'test' | 'reply' | 'automatic', wouldApply = true) => ({ value, probability: 0.97, margin: 0.95, roundsAgree: true, confidence: 0.97, wouldApply })
  it('teste e resposta: linha 1 diz a leitura e que nada foi aplicado', () => {
    expect(formatNote({ ...SAMPLE, gate: gate('test'), applied: [] }, 'm', null).split('\n')[0]).toBe('**Triagem IA** — parece teste, nada aplicado')
    expect(formatNote({ ...SAMPLE, gate: gate('reply'), applied: [] }, 'm', null).split('\n')[0]).toBe('**Triagem IA** — resposta/agradecimento, nada aplicado')
  })

  it('comunicado automático: classificação normal + linha do portão; portão incerto não aparece', () => {
    const text = formatNote({ ...SAMPLE, gate: gate('automatic') }, 'm', null)
    expect(text.split('\n')[0]).toContain('sem alterações (modo sombra)')
    expect(text).toContain('**Portão:** parece comunicado automático ou relatório (97%)')
    expect(formatNote({ ...SAMPLE, gate: gate('test', false) }, 'm', null)).not.toContain('Portão')
  })
})

describe('formatNote — categoria', () => {
  const [type, cat] = SAMPLE.questions
  it('categoria confiável sem subcategoria que encaixe diz o motivo', () => {
    const sub = { ...type, key: 'subcategory' as const, chosen: '__none__', chosenLabel: 'Nenhuma das opções', wouldApply: true }
    expect(formatNote({ ...SAMPLE, questions: [{ ...cat, wouldApply: true }, sub] }, 'm', null))
      .toContain('Categoria Rede e VPN (nenhuma subcategoria encaixa)')
  })

  it('categoria barrada por subcategoria incerta, e vice-versa', () => {
    const sub = { ...type, key: 'subcategory' as const, chosen: 's-vpn', chosenLabel: 'Usuários VPN', wouldApply: false }
    expect(formatNote({ ...SAMPLE, questions: [{ ...cat, wouldApply: true }, sub] }, 'm', null))
      .toContain('Categoria Rede e VPN (subcategoria incerta)')
    expect(formatNote({ ...SAMPLE, questions: [cat, { ...sub, wouldApply: true }] }, 'm', null))
      .toContain('Subcategoria Usuários VPN (categoria incerta)')
  })
})

describe('formatNote no modo apply', () => {
  const prio = { field: 'priority' as const, label: 'Prioridade', from: 'medium', fromLabel: 'Média', to: 'high', toLabel: 'Alta', confidence: 0.9 }
  const catChange = { field: 'category' as const, label: 'Categoria', from: 'c0', fromLabel: 'Infra', to: 'c1', toLabel: 'Rede e VPN', confidence: 0.9 }

  it('aplicado e sugerido em uma linha cada; sugestão não se repete em Revisar', () => {
    const text = formatNote({
      ...SAMPLE,
      questions: [{ ...SAMPLE.questions[1], wouldApply: true }],
      priority: { value: 'high', confidence: 0.9, wouldApply: true },
      applied: [prio],
      proposed: [catChange],
    }, 'gpt-4.1-mini', null)
    expect(text.split('\n')).toEqual([
      '**Triagem IA** — Aplicou: Prioridade Alta | Sugere: Categoria Rede e VPN',
      '**Aplicado:** Prioridade: Média → Alta',
      '**Sugerido:** Categoria: Infra → Rede e VPN',
      '**Por quê:** Pedido de criação de usuários.',
      'gpt-4.1-mini · triage-v4',
    ])
  })

  it('linha 1: tipo sem nº do chamado, categoria e subcategoria juntas', () => {
    const ch = (field: 'type' | 'category' | 'subcategory', label: string, toLabel: string) =>
      ({ field, label, from: 'a', fromLabel: 'x', to: 'b', toLabel, confidence: 0.9 })
    const text = formatNote({
      ...SAMPLE,
      applied: [ch('type', 'Tipo', 'Requisição (REQ-12)'), ch('category', 'Categoria', 'Rede'), ch('subcategory', 'Subcategoria', 'Wi-Fi'), prio],
    }, 'm', null)
    expect(text.split('\n')[0]).toBe('**Triagem IA** — Aplicou: Tipo Requisição · Categoria Rede › Wi-Fi · Prioridade Alta | Revisar: Categoria, Prioridade')
    expect(text).toContain('Tipo: x → Requisição (REQ-12)')
  })

  it('texto curto demais: nada aplicado', () => {
    expect(formatNote({ ...SAMPLE, lowInformation: true, applied: [] }, 'm', null).split('\n')[0])
      .toBe('**Triagem IA** — texto curto demais, nada aplicado')
  })

  it('diz quando nada mudou', () => {
    expect(formatNote({ ...SAMPLE, applied: [] }, 'm', null)).toContain('**Triagem IA** — sem alterações')
  })
})
