import { useEffect, useState } from 'react'
import { Btn } from '@/components/ui'
import { aiService, type GuidanceAnswer, type GuidanceInfo } from '@/services/aiService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SKADI_NAME } from '@/utils/skadi'

const DONE: Record<GuidanceAnswer, string> = {
  resolved: 'Que bom que resolveu! O chamado foi marcado como resolvido.',
  declined: 'Tudo bem, o atendimento segue normalmente.',
  link: 'Pedido vinculado ao chamado existente.',
  'not-duplicate': 'Entendido, seguimos com este chamado.',
}

/**
 * Portal do solicitante: resposta à orientação da Skadi (agente guidance).
 * Só aparece com uma oferta pendente; `refreshKey` muda quando chegam mensagens novas
 * (a oferta chega como mensagem dela).
 */
export function GuidanceActions({ ticketId, refreshKey, onAnswered }: {
  ticketId: string
  refreshKey?: unknown
  onAnswered?: (answer: GuidanceAnswer) => void
}) {
  const [info, setInfo] = useState<GuidanceInfo | null>(null)
  const [busy, setBusy] = useState<GuidanceAnswer | null>(null)

  useEffect(() => {
    let alive = true
    aiService.getGuidance(ticketId).then(d => { if (alive) setInfo(d) }).catch(() => { })
    return () => { alive = false }
  }, [ticketId, refreshKey])

  const status = info?.guidance_status
  const related = info?.related
  if (status !== 'offered' && !(status === 'duplicate_offered' && related)) return null

  const answer = async (a: GuidanceAnswer) => {
    if (busy) return
    setBusy(a)
    try {
      await aiService.answerGuidance(ticketId, a)
      setInfo(prev => prev && { ...prev, guidance_status: null })
      toast.success(DONE[a])
      onAnswered?.(a)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível registrar sua resposta. Tente de novo.'))
    } finally {
      setBusy(null)
    }
  }

  const offered = status === 'offered'
  return (
    <section aria-label={`Orientação da ${SKADI_NAME}`} aria-busy={!!busy} className="notice" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
      <span style={{ color: 'var(--text-1)' }}>
        {offered
          ? `A ${SKADI_NAME} enviou orientações na Trilha de atendimento. Elas resolveram seu problema?`
          : <>Você já tem o chamado <strong>{related!.display_number}</strong> — “{related!.title}” aberto. É o mesmo problema?</>}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {offered ? (
          <>
            <Btn size="md" variant="primary" disabled={!!busy} onClick={() => answer('resolved')}>
              {busy === 'resolved' ? 'Registrando…' : 'Resolveu meu problema'}
            </Btn>
            <Btn size="md" variant="secondary" disabled={!!busy} onClick={() => answer('declined')}>
              {busy === 'declined' ? 'Registrando…' : 'Não resolveu'}
            </Btn>
          </>
        ) : (
          <>
            <Btn size="md" variant="primary" disabled={!!busy} onClick={() => answer('link')}>
              {busy === 'link' ? 'Vinculando…' : `Vincular ao ${related!.display_number}`}
            </Btn>
            <Btn size="md" variant="secondary" disabled={!!busy} onClick={() => answer('not-duplicate')}>
              {busy === 'not-duplicate' ? 'Registrando…' : 'É outro problema'}
            </Btn>
          </>
        )}
      </div>
    </section>
  )
}
