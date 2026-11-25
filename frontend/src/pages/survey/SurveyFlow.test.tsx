import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SurveyFlow } from './SurveyFlow'
import { SurveyTemplate } from '@/services/surveyService'

const template: SurveyTemplate = {
  id: 'tpl1',
  nome: 'Modelo Teste',
  assunto_email: 'a',
  corpo_convite_auto: 'b',
  corpo_convite_macro: 'c',
  ativo: true,
  created_at: '',
  updated_at: '',
  questions: [
    {
      id: 'q1',
      template_id: 'tpl1',
      ordem: 1,
      enunciado: 'O seu problema foi resolvido?',
      tipo: 'escolha_unica',
      obrigatoria: true,
      ativa: true,
      opcoes: [
        { id: 'o1', rotulo: 'Sim', valor: 'sim' },
        { id: 'o2', rotulo: 'Não', valor: 'nao', acao: 'reabrir_chamado' }
      ]
    },
    {
      id: 'q2',
      template_id: 'tpl1',
      ordem: 2,
      enunciado: 'testtete',
      tipo: 'escolha_multipla',
      obrigatoria: true,
      ativa: true,
      opcoes: [
        { id: 'o3', rotulo: 'testtete', valor: 't' },
        { id: 'o4', rotulo: 'stesr', valor: 's' }
      ]
    }
  ]
}

describe('SurveyFlow', () => {
  it('navega resolução → pesquisa e envia sem chamar API real (onSubmit local)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<SurveyFlow template={template} ticket={{ id: '#1000', title: 'Chamado exemplo' }} onSubmit={onSubmit} />)

    expect(screen.getByText('O seu problema foi resolvido?')).toBeTruthy()

    fireEvent.click(screen.getByText('Sim'))

    fireEvent.click(await screen.findByRole('button', { name: 'testtete' }))
    fireEvent.click(screen.getByRole('button', { name: 'stesr' }))

    fireEvent.click(screen.getByText('Enviar avaliação'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].answers).toHaveLength(2)
    expect(await screen.findByText('Muito obrigado!')).toBeTruthy()
  })

  it('leva ao fluxo de reabertura quando a opção marcada como reabrir é escolhida', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<SurveyFlow template={template} ticket={{ id: '#1000', title: 'Chamado exemplo' }} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Não'))

    expect(await screen.findByText(/Por favor, relate o que está acontecendo/)).toBeTruthy()
  })
})
