import { useState } from 'react'
import {
  SurveyTemplate,
  SurveyQuestion,
  SurveyAnswerSubmit,
  SurveyResponseSubmit
} from '@/services/surveyService'
import { QuestionRenderer } from './QuestionRenderer'
import { FileDrop } from '@/areas/chamados/detail/FileDrop'
import { Btn, LogoMark } from '@/components/ui'
import '@/areas/chamados/chamados.css'
import './survey.css'

// Determines whether a given answer carries a non-empty value
function hasAnswer(a: SurveyAnswerSubmit | undefined): boolean {
  if (!a) return false
  if (typeof a.valor_texto === 'string' && a.valor_texto.trim().length > 0) return true
  if (typeof a.valor_numero === 'number' && !Number.isNaN(a.valor_numero)) return true
  if (Array.isArray(a.valores_opcao) && a.valores_opcao.length > 0) return true
  return false
}

/**
 * Renders the interactive survey-answering flow (resolução → pesquisa → reabertura + telas
 * finais). Extracted from SurveyAnswerPage so it can be reused for the admin preview, which
 * feeds a locally-loaded template and never actually calls the submit API.
 */
export function SurveyFlow({
  template,
  ticket,
  onSubmit
}: {
  template: SurveyTemplate
  ticket: { id: string; title: string }
  onSubmit: (payload: SurveyResponseSubmit) => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [successReopen, setSuccessReopen] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const questions: SurveyQuestion[] = (template.questions || [])
    .filter((q) => q.ativa)
    .sort((a, b) => a.ordem - b.ordem)

  const resolutionQuestion = questions.find(q =>
    q.opcoes?.some(o => o.acao === 'reabrir_chamado')
  )

  const [step, setStep] = useState<'resolution' | 'survey' | 'reopen'>(
    resolutionQuestion ? 'resolution' : 'survey'
  )

  const [answers, setAnswers] = useState<Record<string, SurveyAnswerSubmit>>({})
  const [reopenReason, setReopenReason] = useState('')
  const [reopenFile, setReopenFile] = useState<File | null>(null)

  const updateAnswer = (a: SurveyAnswerSubmit) =>
    setAnswers((prev) => ({ ...prev, [a.question_id]: a }))

  // Reopen mode is active when any selected option carries acao === 'reabrir_chamado'.
  const reopenActive = questions.some((q) => {
    const ans = answers[q.id]
    if (!ans?.valores_opcao?.length) return false
    return ans.valores_opcao.some((v) =>
      q.opcoes?.some((o) => o.valor === v && o.acao === 'reabrir_chamado')
    )
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)

    if (reopenActive) {
      if (reopenReason.trim().length < 10) {
        setValidationError('Por favor, descreva o motivo da reabertura (mínimo de 10 caracteres).')
        return
      }
    } else {
      const missing = questions.filter((q) => q.obrigatoria && !hasAnswer(answers[q.id]))
      if (missing.length > 0) {
        setValidationError('Por favor, responda todas as perguntas obrigatórias (marcadas com *).')
        return
      }
    }

    setSubmitting(true)
    try {
      if (reopenActive) {
        let attachmentUrl: string | undefined = undefined
        if (reopenFile) {
          attachmentUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(reopenFile)
          })
        }
        await onSubmit({
          answers: Object.values(answers),
          reopen_reason: reopenReason,
          reopen_attachment: attachmentUrl
        })
        setSuccessReopen(true)
      } else {
        await onSubmit({ answers: Object.values(answers) })
      }
      setSuccess(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao enviar a pesquisa.')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <div className="survey">
        <h1>Ops! Pesquisa indisponível</h1>
        <p className="survey-sub">{error}</p>
      </div>
    )
  }

  if (success) {
    return (
      <div className="survey">
        <h1>{successReopen ? 'Chamado reaberto' : 'Muito obrigado!'}</h1>
        <p className="survey-sub">
          {successReopen
            ? 'Lamentamos que o seu problema não tenha sido solucionado. O chamado foi reaberto com sucesso e o analista responsável foi notificado para dar continuidade ao atendimento. Você já pode acompanhar a evolução pelo portal de atendimento.'
            : 'Sua avaliação foi registrada com sucesso. Seu feedback é de extrema importância para continuarmos melhorando a qualidade do nosso atendimento.'}
        </p>
      </div>
    )
  }

  const reasonLength = reopenReason.trim().length
  const back = resolutionQuestion && <button type="button" className="survey-back" onClick={() => setStep('resolution')}>&larr; Voltar</button>

  return (
    <div className="survey">
      <div className="survey-head">
        <LogoMark size={36} />
        <div>
          <h1>Pesquisa de satisfação</h1>
          <p className="survey-sub">Chamado {ticket.id}: {ticket.title}</p>
          {step !== 'reopen' && (
            <p className="survey-sub">
              {step === 'resolution'
                ? 'Olá! Gostaríamos de saber se o seu problema foi resolvido para darmos andamento à avaliação do atendimento.'
                : 'Olá! Sua opinião é muito importante para nós. Por favor, responda às perguntas abaixo sobre o atendimento do seu chamado.'}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {step === 'resolution' && resolutionQuestion && (
          <div className="survey-q">
            <h2>{resolutionQuestion.enunciado}</h2>
            <p>Antes de iniciar a avaliação, por favor nos confirme se a sua solicitação foi atendida.</p>
            <div className="survey-list">
              {resolutionQuestion.opcoes?.map((opcao) => (
                <button
                  key={opcao.id ?? opcao.valor}
                  type="button"
                  aria-pressed={!!answers[resolutionQuestion.id]?.valores_opcao?.includes(opcao.valor)}
                  onClick={() => {
                    updateAnswer({ question_id: resolutionQuestion.id, valores_opcao: [opcao.valor] })
                    setStep(opcao.acao === 'reabrir_chamado' ? 'reopen' : 'survey')
                  }}
                >
                  {opcao.rotulo}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'survey' && (
          <>
            {back}
            {questions
              .filter((q) => q.id !== resolutionQuestion?.id)
              .map((q, i) => (
                <QuestionRenderer key={q.id} question={q} value={answers[q.id]} onChange={updateAnswer} index={i + 1} />
              ))}
          </>
        )}

        {step === 'reopen' && (
          <>
            {back}
            <div className="survey-q">
              <p className="survey-note">Você indicou que o problema não foi resolvido. O chamado será reaberto.</p>
              <h2 style={{ marginTop: 14 }}>Por favor, relate o que está acontecendo:<em>*</em></h2>
              <textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Descreva detalhadamente o que ainda não foi solucionado para que o analista possa agir corretamente (mínimo de 10 caracteres)..."
                rows={5}
                required
                maxLength={1000}
              />
              <div className="survey-count">
                <span style={{ color: 'var(--danger)' }}>
                  {reasonLength > 0 && reasonLength < 10 && `O motivo deve conter no mínimo ${10 - reasonLength} caracteres adicionais.`}
                </span>
                <span>{1000 - reopenReason.length} {(1000 - reopenReason.length) === 1 ? 'caractere restante' : 'caracteres restantes'}</span>
              </div>
            </div>
            <div className="survey-q">
              <h2 style={{ marginBottom: 14 }}>Anexar Imagem (opcional)</h2>
              <FileDrop id="survey-reopen-file" accept="image/*" multiple={false} hint="Formatos permitidos: PNG, JPG, JPEG, GIF (Max. 10MB)"
                files={reopenFile ? [reopenFile] : []} onFiles={([file]) => file && setReopenFile(file)} onRemove={() => setReopenFile(null)} />
            </div>
          </>
        )}

        {step !== 'resolution' && (
          <div className="survey-foot">
            {validationError && <p role="alert" className="survey-note">{validationError}</p>}
            {step === 'reopen'
              ? <Btn type="submit" size="lg" variant="danger" disabled={submitting || reasonLength < 10}>{submitting ? 'Processando reabertura...' : 'Reabrir chamado'}</Btn>
              : <Btn type="submit" size="lg" disabled={submitting}>{submitting ? 'Enviando...' : 'Enviar avaliação'}</Btn>}
          </div>
        )}
      </form>
    </div>
  )
}
