import { useEffect, useId, useRef, useState } from 'react'
import { Btn, SkadiAvatar } from '@/components/ui'
import { aiSuggestService, type AiFeedbackValue, type AiSuggestion } from '@/services/aiSuggestService'
import { SKADI_NAME } from '@/utils/skadi'

export type SuggestionAction = 'accept' | 'proceed'

const TOUCH_TARGET = 44

/** Painel de espera. A região aria-live fica no Wizard, montada antes do texto aparecer. */
export function SolutionSearching() {
  return (
    <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
      <SkadiAvatar size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-1)' }}>Procurando uma solução…</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
          Leva só alguns segundos. Se não houver resposta, seu chamado é aberto em seguida.
        </div>
      </div>
    </div>
  )
}

function FeedbackButton({ label, selected, onClick }: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <Btn
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        minHeight: TOUCH_TARGET,
        background: selected ? 'var(--accent-soft)' : 'transparent',
        color: selected ? 'var(--text-1)' : 'var(--accent-fg)',
      }}
    >
      {label}
    </Btn>
  )
}

export function SolutionSuggestionCard({ suggestion, busy, error, onAccept, onProceed }: {
  suggestion: AiSuggestion
  busy: SuggestionAction | null
  error: string | null
  onAccept: () => void
  onProceed: () => void
}) {
  const [feedback, setFeedback] = useState<AiFeedbackValue | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const headingId = useId()

  useEffect(() => { cardRef.current?.focus() }, [])

  function chooseFeedback(value: AiFeedbackValue) {
    if (value === feedback) return
    const previous = feedback
    setFeedback(value)
    // Sem aviso: o card segue útil mesmo sem o registro, só não finge que gravou.
    aiSuggestService.feedback(suggestion.interactionId, value)
      .catch(() => setFeedback(current => (current === value ? previous : current)))
  }

  const actionStyle = { flex: '1 1 220px', minHeight: TOUCH_TARGET }

  return (
    <section ref={cardRef} tabIndex={-1} aria-labelledby={headingId} aria-busy={!!busy} style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <SkadiAvatar size={36} />
        <div style={{ minWidth: 0 }}>
          <h2 id={headingId} style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-1)' }}>A {SKADI_NAME} encontrou uma possível solução</h2>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
            Resposta gerada por IA a partir da base de conhecimento. Veja se ela resolve antes de abrir o chamado.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '16px 0', borderBlock: '1px solid var(--border)' }}>
        {suggestion.answer}
      </div>

      {suggestion.sources.length > 0 && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>Fontes</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {suggestion.sources.map(source => (
              <li key={source.articleId} style={{ fontSize: 14, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{source.title}</li>
            ))}
          </ul>
        </div>
      )}

      <div role="group" aria-label="Esta resposta foi útil?" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-2)' }}>Esta resposta foi útil?</span>
        <FeedbackButton label="Útil" selected={feedback === 'useful'} onClick={() => chooseFeedback('useful')} />
        <FeedbackButton label="Não útil" selected={feedback === 'not_useful'} onClick={() => chooseFeedback('not_useful')} />
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 14, color: 'var(--danger)', lineHeight: 1.5 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn
          type="button"
          disabled={!!busy}
          onClick={onAccept}
          style={actionStyle}
        >
          Aceitar e Encerrar
        </Btn>
        <Btn
          type="button"
          variant="secondary"
          disabled={!!busy}
          onClick={onProceed}
          style={actionStyle}
        >
          Prosseguir com Atendimento Humano
        </Btn>
      </div>
    </section>
  )
}
