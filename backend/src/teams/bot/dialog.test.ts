import { describe, expect, it } from 'vitest'
import { dialogContinue, MESSAGE_ACTION_COMMAND, openFormAction, prefillFromMessage, ticketDialogUrl } from './dialog'

const portal = 'https://portal.test/'

describe('ticketDialogUrl', () => {
  it('abre o wizard do portal em modo dialog do Teams', () => {
    expect(ticketDialogUrl(portal)).toBe('https://portal.test/solicitacoes?teams=1&dialog=1')
  })

  it('preenche título e descrição como texto puro, codificados e cortados', () => {
    const url = new URL(ticketDialogUrl(portal, { titulo: '<b>VPN</b> & Wi-Fi', descricao: `linha 1<br>linha 2 ${'x'.repeat(3000)}` }))
    expect(url.pathname).toBe('/solicitacoes')
    expect(url.searchParams.get('teams')).toBe('1')
    expect(url.searchParams.get('dialog')).toBe('1')
    expect(url.searchParams.get('titulo')).toBe('VPN & Wi-Fi')
    const descricao = url.searchParams.get('descricao')!
    expect(descricao.startsWith('linha 1 linha 2 x')).toBe(true)
    expect(descricao.length).toBeLessThanOrEqual(1500)
    expect(url.toString()).not.toContain('<')
  })
})

describe('extensão de mensagem', () => {
  it('usa o assunto como título e o corpo HTML como descrição', () => {
    const prefill = prefillFromMessage({
      subject: 'Impressora parada',
      body: { contentType: 'html', content: '<div>A impressora do 3º andar</div><div>não imprime &amp; pisca</div>' },
    })
    expect(prefill).toEqual({ titulo: 'Impressora parada', descricao: 'A impressora do 3º andar não imprime & pisca' })
  })

  it('sem assunto, o título é o começo da mensagem', () => {
    const prefill = prefillFromMessage({ body: { content: `Outlook não abre ${'desde ontem '.repeat(20)}` } })
    expect(prefill.titulo!.startsWith('Outlook não abre')).toBe(true)
    expect(prefill.titulo!.length).toBeLessThanOrEqual(120)
  })

  it('mensagem vazia não quebra', () => {
    expect(prefillFromMessage(undefined)).toEqual({ titulo: null, descricao: null })
  })

  it('o comando do manifesto é o mesmo tratado pelo bot', () => {
    expect(MESSAGE_ACTION_COMMAND).toBe('abrirChamadoDaMensagem')
  })
})

describe('respostas do dialog', () => {
  it('task continue com a URL', () => {
    expect(dialogContinue('https://x/y')).toEqual({
      task: { type: 'continue', value: { title: 'Abrir chamado', url: 'https://x/y', fallbackUrl: 'https://x/y', height: 'large', width: 'large' } },
    })
  })

  it('botão "Abrir pelo formulário" dispara task/fetch sem levar os inputs do card', () => {
    const action = openFormAction({ titulo: 'VPN' })
    expect(action).toMatchObject({ type: 'Action.Submit', title: 'Abrir pelo formulário', associatedInputs: 'none' })
    expect(action.data).toEqual({ msteams: { type: 'task/fetch' }, acao: 'formulario', titulo: 'VPN' })
  })
})
