import { describe, expect, it } from 'vitest'
import { parseLearnResponse, toPtBr } from './learn'

const body = (results: unknown[]) =>
  `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({ results }) }] } })}`

const doc = { title: 'Solucionar problemas do Outlook', contentUrl: 'https://learn.microsoft.com/en-us/troubleshoot/outlook/x', content: 'passos' }
const answer = { title: 'Não recebo e-mails - Microsoft Q&A', contentUrl: 'https://learn.microsoft.com/answers/a/12670014', content: 'resposta aceita' }

describe('parseLearnResponse', () => {
  it('por padrão só documentação, com URL em pt-br', () => {
    expect(parseLearnResponse(body([answer, doc]))).toEqual([
      { title: doc.title, url: 'https://learn.microsoft.com/pt-br/troubleshoot/outlook/x', content: 'passos' },
    ])
  })

  it('com includeAnswers aceita o Microsoft Q&A na URL original (dúvidas do dia a dia quase sempre caem lá)', () => {
    const docs = parseLearnResponse(body([answer, doc]), { includeAnswers: true })
    expect(docs.map(d => d.url)).toEqual(['https://learn.microsoft.com/answers/a/12670014', 'https://learn.microsoft.com/pt-br/troubleshoot/outlook/x'])
  })

  it('fora do Learn nunca entra', () => {
    expect(parseLearnResponse(body([{ ...answer, contentUrl: 'https://exemplo.com/answers/1' }]), { includeAnswers: true })).toEqual([])
    expect(toPtBr('https://exemplo.com/x')).toBeNull()
  })
})
