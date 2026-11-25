import { describe, it, expect, vi } from 'vitest'
import { SurveyController } from './survey'
import { SurveyService } from '../services/survey'

describe('SurveyController.addQuestion', () => {
  it('aceita estilo e descricao nulos (payload do frontend para tipos sem escala)', async () => {
    const addQuestionSpy = vi.spyOn(SurveyService, 'addQuestion').mockResolvedValue({ id: 'q1' } as any)
    const req = {
      params: { id: 'tpl1' },
      body: {
        enunciado: 'Como você avalia?',
        descricao: null,
        tipo: 'escolha_multipla',
        estilo: null,
        obrigatoria: true,
        ativa: true,
        opcoes: [
          { rotulo: 'testtete', valor: 't' },
          { rotulo: 'stesr', valor: 's' }
        ]
      }
    } as any
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    const res = { status } as any
    const next = vi.fn()

    await SurveyController.addQuestion(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(201)
    expect(addQuestionSpy).toHaveBeenCalledWith('tpl1', expect.objectContaining({ estilo: undefined, descricao: undefined }))
    addQuestionSpy.mockRestore()
  })
})
