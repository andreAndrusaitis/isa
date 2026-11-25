import { SurveyQuestion, SurveyAnswerSubmit, SurveyQuestionOption } from '@/services/surveyService'
import './survey.css'

interface Props {
  question: SurveyQuestion
  value: SurveyAnswerSubmit | undefined
  onChange: (answer: SurveyAnswerSubmit) => void
  /** Número mostrado antes do enunciado (a partir de 1). Padrão: question.ordem. */
  index?: number
}

// Nota numérica de uma opção
function optionScore(opcao: SurveyQuestionOption, fallback: number): number {
  if (opcao.pontuacao !== null && opcao.pontuacao !== undefined) return opcao.pontuacao
  const parsed = Number(opcao.valor)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function QuestionRenderer({ question, value, onChange, index }: Props) {
  const opcoes = question.opcoes || []
  const { tipo, estilo } = question
  const score = value?.valor_numero ?? null
  const rate = (n: number) => onChange({ question_id: question.id, valor_numero: n })

  const renderControl = () => {
    // Estrela e emoji: a mesma escala em blocos numerados, com o rótulo de cada nota.
    // Na de estrelas os blocos abaixo da nota ficam marcados, como as estrelas cheias.
    if (tipo === 'escala' && (estilo === 'emoji' || estilo === 'estrela')) {
      const items = opcoes.length ? opcoes : Array.from({ length: 5 }, () => null)
      return (
        <div className="survey-scale" role="group" aria-label={question.enunciado} data-labels={opcoes.some(o => o.rotulo) || undefined}>
          {items.map((opcao, i) => {
            const n = opcao ? optionScore(opcao, i + 1) : i + 1
            return (
              <button key={opcao?.id ?? opcao?.valor ?? i} type="button" aria-pressed={score === n}
                data-below={estilo === 'estrela' && score !== null && n < score ? true : undefined}
                aria-label={opcao?.rotulo || `${n} de ${items.length}`} onClick={() => rate(n)}>
                {n}
                {opcao?.rotulo && <small>{opcao.rotulo}</small>}
              </button>
            )
          })}
        </div>
      )
    }

    if (tipo === 'escala' && (estilo === 'numerico' || estilo === 'pill')) {
      return (
        <div className="survey-scale" role="group" aria-label={question.enunciado}>
          {opcoes.map((opcao, i) => {
            const n = optionScore(opcao, i + 1)
            return <button key={opcao.id ?? opcao.valor ?? i} type="button" aria-pressed={score === n} onClick={() => rate(n)}>{opcao.rotulo}</button>
          })}
        </div>
      )
    }

    // NPS (0..10)
    if (tipo === 'nps') {
      return (
        <div className="survey-scale" role="group" aria-label={question.enunciado}>
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" aria-pressed={score === n} onClick={() => rate(n)}>{n}</button>
          ))}
        </div>
      )
    }

    if (tipo === 'escolha_unica' || tipo === 'unica_escolha' || tipo === 'escolha_multipla') {
      const multiple = tipo === 'escolha_multipla'
      const selected = value?.valores_opcao || []
      return (
        <div className="survey-list">
          {opcoes.map((opcao, i) => {
            const on = selected.includes(opcao.valor)
            const next = !multiple ? [opcao.valor] : on ? selected.filter((v) => v !== opcao.valor) : [...selected, opcao.valor]
            return (
              <button key={opcao.id ?? opcao.valor ?? i} type="button" aria-pressed={on} onClick={() => onChange({ question_id: question.id, valores_opcao: next })}>
                {opcao.rotulo}
              </button>
            )
          })}
        </div>
      )
    }

    // Texto livre (também o padrão)
    const textVal = value?.valor_texto || ''
    const maxLen = 1000
    const remaining = maxLen - textVal.length
    return (
      <>
        <textarea
          value={textVal}
          onChange={(e) => onChange({ question_id: question.id, valor_texto: e.target.value })}
          placeholder="Digite sua resposta..."
          rows={4}
          maxLength={maxLen}
        />
        <div className="survey-count" style={remaining <= 10 ? { color: 'var(--danger)' } : undefined}>
          {remaining} {remaining === 1 ? 'caractere restante' : 'caracteres restantes'}
        </div>
      </>
    )
  }

  return (
    <div className="survey-q">
      <h2>{index ?? question.ordem}. {question.enunciado}{question.obrigatoria && <em>*</em>}</h2>
      {question.descricao && <p>{question.descricao}</p>}
      {renderControl()}
    </div>
  )
}
