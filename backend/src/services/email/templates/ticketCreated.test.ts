import { describe, it, expect } from 'vitest'
import { buildTicketCreatedTemplate } from './ticketCreated'

const base = {
  clientName: 'Ana', ticketNumber: 'INC-11200', ticketTitle: 'VPN não conecta',
  description: 'Erro 809 ao conectar', categoryName: 'Infra',
  openedAt: new Date('2026-10-27T13:05:00Z'), ticketUrl: 'http://portal/portal?ticket=ISA-11200',
}

describe('e-mail de confirmação de abertura', () => {
  it('traz número, título, data no fuso de Brasília, descrição e link', () => {
    const t = buildTicketCreatedTemplate(base)
    expect(t.subject).toBe('Chamado [INC-11200] aberto: VPN não conecta')
    for (const part of ['INC-11200', 'VPN não conecta', 'Infra', '27/10/2026, 10:05', 'Erro 809 ao conectar', 'http://portal/portal?ticket=ISA-11200']) {
      expect(t.html).toContain(part)
      expect(t.text).toContain(part)
    }
    expect(t.text).toContain('Recebemos o seu chamado')
  })

  it('escapa HTML vindo do cliente', () => {
    const t = buildTicketCreatedTemplate({ ...base, ticketTitle: '<script>x</script>', description: '<b>oi</b>' })
    expect(t.html).not.toContain('<script>x</script>')
    expect(t.html).toContain('&lt;script&gt;')
    expect(t.html).toContain('&lt;b&gt;oi&lt;/b&gt;')
  })

  it('abertura em nome do cliente muda o texto; chamado especial sai sem descrição', () => {
    const t = buildTicketCreatedTemplate({ ...base, openedOnBehalf: true, description: null, categoryName: null })
    expect(t.text).toContain('abriu um chamado em seu nome')
    expect(t.text).not.toContain('Descrição')
    expect(t.text).not.toContain('Categoria')
  })

  it('corta descrição longa', () => {
    const t = buildTicketCreatedTemplate({ ...base, description: 'a'.repeat(5000) })
    expect(t.text).toContain(`${'a'.repeat(1000)}…`)
    expect(t.text).not.toContain('a'.repeat(1001))
  })
})
