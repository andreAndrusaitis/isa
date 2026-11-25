import { useCallback, useEffect, useRef, useState } from 'react'
import { aiSuggestService, type AiSuggestion, type SuggestInput, type SuggestStatus } from '@/services/aiSuggestService'

/** Teto no cliente: passou disso, o chamado abre sem sugestão. */
export const SUGGEST_TIMEOUT_MS = 9_000

const OFF: SuggestStatus = { enabled: false, shadow: false }

/** Status lido uma vez ao entrar no Wizard; enquanto não chega, ou se falhar, conta como desligado. */
export function useAiSuggest() {
  const [status, setStatus] = useState(OFF)
  const pending = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    aiSuggestService.status().then(s => { if (alive) setStatus(s) }).catch(() => {})
    return () => {
      alive = false
      pending.current?.abort()
    }
  }, [])

  /**
   * Nunca rejeita. Null: sem sugestão, erro ou tempo esgotado, e o chamado abre normalmente.
   * 'cancelled': o usuário desistiu ou saiu do Wizard, e nada deve ser aberto.
   */
  const search = useCallback((input: SuggestInput) => new Promise<AiSuggestion | null | 'cancelled'>(resolve => {
    const controller = new AbortController()
    pending.current = controller
    const timer = setTimeout(() => {
      resolve(null)
      controller.abort()
    }, SUGGEST_TIMEOUT_MS)
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve('cancelled')
    })
    aiSuggestService.suggest(input, controller.signal)
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timer))
  }), [])

  const cancel = useCallback(() => pending.current?.abort(), [])

  /** Coleta em sombra: ninguém espera a resposta nem fica sabendo se falhou. */
  const collect = useCallback((input: SuggestInput) => {
    aiSuggestService.suggest(input).catch(() => {})
  }, [])

  return { status, search, cancel, collect }
}
