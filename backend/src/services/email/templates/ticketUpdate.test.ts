import { describe, it, expect } from 'vitest'
import { buildTicketUpdateTemplate } from './ticketUpdate'
import { summarizeUpdates } from '../ticketUpdateDigest'

describe('buildTicketUpdateTemplate', () => {
  const base = {
    clientName: 'Ana <b>',
    ticketNumber: '#1001',
    ticketTitle: 'VPN caiu',
    status: { from: 'in_progress', to: 'resolved' },
    replies: [] as string[],
    resolutionDetails: 'Certificado renovado',
    ticketUrl: 'https://app/portal?ticket=abc',
  }

  it('descreve a transição, a resolução e linka o chamado', () => {
    const t = buildTicketUpdateTemplate(base)
    expect(t.subject).toBe('Chamado [#1001]: Resolvido')
    expect(t.html).toContain('Em atendimento')
    expect(t.html).toContain('Certificado renovado')
    expect(t.html).toContain('href="https://app/portal?ticket=abc"')
    expect(t.text).toContain('https://app/portal?ticket=abc')
  })

  it('junta status e respostas no mesmo e-mail, escapando HTML', () => {
    const t = buildTicketUpdateTemplate({ ...base, replies: ['<script>x</script>', 'segunda'] })
    expect(t.html).toContain('2 novas respostas')
    expect(t.html).toContain('&lt;script&gt;')
    expect(t.html).not.toContain('<script>')
    expect(t.html).toContain('Ana &lt;b&gt;')
  })

  it('só respostas: assunto de resposta, sem bloco de status', () => {
    const t = buildTicketUpdateTemplate({ ...base, status: null, replies: ['oi'] })
    expect(t.subject).toBe('Chamado [#1001]: nova resposta')
    expect(t.html).not.toContain('Certificado renovado')
  })

  it('lista os anexos; o que não coube no e-mail aparece como disponível no chamado', () => {
    const t = buildTicketUpdateTemplate({ ...base, status: null, replies: ['Segue'], attachments: [{ name: 'relatorio.pdf', attached: true }, { name: 'video<1>.mp4', attached: false }] })
    expect(t.html).toContain('2 anexos')
    expect(t.html).toContain('relatorio.pdf')
    expect(t.html).toContain('video&lt;1&gt;.mp4 <span style="color: #4f616b;">(disponível no chamado)</span>')
    expect(t.html).not.toContain('Os arquivos estão anexados a este e-mail.')
    expect(t.text).toContain('- relatorio.pdf\n- video<1>.mp4 (disponível no chamado)')
    const only = buildTicketUpdateTemplate({ ...base, status: null, replies: [], attachments: [{ name: 'a.png', attached: true }] })
    expect(only.subject).toBe(`Chamado [${base.ticketNumber}]: novo anexo`)
    expect(only.html).toContain('Os arquivos estão anexados a este e-mail.')
  })

  it('mostra motivo só em pendente', () => {
    const t = buildTicketUpdateTemplate({ ...base, status: { from: 'open', to: 'pending' }, pendingReason: 'pending_user' })
    expect(t.html).toContain('Aguardando retorno seu')
  })
})

describe('summarizeUpdates', () => {
  it('colapsa várias mudanças de status do primeiro "de" ao último "para"', () => {
    const s = summarizeUpdates([
      { kind: 'reply', text: 'a' },
      { kind: 'status', from: 'open', to: 'in_progress' },
      { kind: 'reply', text: 'b' },
      { kind: 'status', from: 'in_progress', to: 'resolved' },
    ])
    expect(s.status).toEqual({ from: 'open', to: 'resolved' })
    expect(s.replies).toEqual(['a', 'b'])
  })

  it('anexo da resposta vai na lista; "Anexo adicional: x" não repete como resposta e dá o nome do arquivo', () => {
    const s = summarizeUpdates([
      { kind: 'reply', text: 'Segue o relatório', attachment: 'tickets/2026/11/a.pdf' },
      { kind: 'reply', text: 'Anexo adicional: print do erro.png', attachment: 'tickets/2026/11/b.png' },
      { kind: 'reply', text: 'sem anexo' },
    ])
    expect(s.replies).toEqual(['Segue o relatório', 'sem anexo'])
    expect(s.attachments).toEqual([
      { value: 'tickets/2026/11/a.pdf', name: null },
      { value: 'tickets/2026/11/b.png', name: 'print do erro.png' },
    ])
  })

  it('ignora status que voltou ao mesmo lugar', () => {
    const s = summarizeUpdates([
      { kind: 'status', from: 'resolved', to: 'open' },
      { kind: 'status', from: 'open', to: 'resolved' },
    ])
    expect(s.status).toBeNull()
  })
})
