import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Chamado aberto ↔ ?ticket=<id> no endereço: dá para copiar o link, abrir em
 * outra aba e usar o "voltar" (volta fecha o chamado). Também é por onde o link
 * do e-mail (/c/<id>) chega.
 *
 * @param selectedId chamado aberto na tela (null = nenhum)
 * @param open abre pelo id (busca no servidor se preciso)
 * @param close fecha o detalhe
 */
export function useTicketInUrl(selectedId: string | null | undefined, open: (id: string) => void, close: () => void) {
  const [params, setParams] = useSearchParams()
  const urlId = params.get('ticket')
  // Abrindo pelo endereço: não apagar o ?ticket enquanto o chamado não chega.
  const pending = useRef<string | null>(null)

  // endereço → tela
  useEffect(() => {
    if (urlId && urlId !== selectedId) {
      pending.current = urlId
      open(urlId)
    } else if (!urlId && selectedId) {
      close()
    }
  }, [urlId]) // eslint-disable-line react-hooks/exhaustive-deps

  // tela → endereço (abrir empilha no histórico; fechar substitui)
  useEffect(() => {
    const id = selectedId ?? null
    if (id === urlId) { pending.current = null; return }
    if (!id && pending.current === urlId) return
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('ticket', id)
      else next.delete('ticket')
      return next
    }, { replace: !id })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
}
