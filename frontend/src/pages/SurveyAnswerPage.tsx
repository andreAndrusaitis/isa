import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { surveyService, SurveyTemplate, SurveyResponseSubmit } from '@/services/surveyService'
import { SurveyFlow } from './survey/SurveyFlow'
import { Loading } from '@/components/ui'
import './survey/survey.css'

export default function SurveyAnswerPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alreadyAnswered, setAlreadyAnswered] = useState(false)

  const [ticket, setTicket] = useState<{ id: string; title: string } | null>(null)
  const [template, setTemplate] = useState<SurveyTemplate | null>(null)

  useEffect(() => {
    if (!token) {
      setError('Token de pesquisa ausente.')
      setLoading(false)
      return
    }

    surveyService.getPublicSurvey(token)
      .then((data) => {
        if (data.status === 'respondida') {
          setAlreadyAnswered(true)
        } else if (data.status === 'expirada') {
          setError('Esta pesquisa de satisfação expirou.')
        } else {
          setTicket(data.ticket)
          setTemplate(data.template)
        }
      })
      .catch((err) => {
        const backendError = err.response?.data?.code
        if (backendError === 'ALREADY_ANSWERED') {
          setAlreadyAnswered(true)
        } else if (backendError === 'EXPIRED') {
          setError('O prazo para responder esta pesquisa expirou.')
        } else {
          setError('Pesquisa de satisfação não encontrada ou inválida.')
        }
      })
      .finally(() => {
        setLoading(false)
      })
  }, [token])

  const handleSubmit = async (payload: SurveyResponseSubmit) => {
    if (!token) return
    await surveyService.submitPublicSurvey(token, payload)
  }

  return (
    <div className="survey-page">
      {loading ? (
        <Loading label="Carregando pesquisa…" />
      ) : alreadyAnswered ? (
        <div className="survey">
          <h1>Pesquisa concluída</h1>
          <p className="survey-sub">Agradecemos sua colaboração! Esta pesquisa de satisfação já foi respondida e as respostas foram salvas em nosso sistema.</p>
        </div>
      ) : error ? (
        <div className="survey">
          <h1>Ops! Pesquisa indisponível</h1>
          <p className="survey-sub">{error}</p>
          <p className="survey-sub">Se você acredita que isso é um erro, por favor entre em contato com nosso suporte técnico.</p>
        </div>
      ) : (
        <SurveyFlow template={template!} ticket={ticket!} onSubmit={handleSubmit} />
      )}
    </div>
  )
}
