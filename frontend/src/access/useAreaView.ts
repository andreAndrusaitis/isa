import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { pathForView, viewForPath } from './routes'

/**
 * Tela atual vinda do endereço (substitui useViewParam/?v=). Trocar de tela
 * empilha no histórico: o "voltar" do navegador volta para a tela anterior.
 * Na raiz de uma área sem tela própria vale `initial`. O ?ticket= é preservado.
 */
export function useAreaView(initial: string): [string, (v: string) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const view = viewForPath(location.pathname) ?? initial
  const setView = useCallback((v: string) => {
    const path = pathForView(v)
    if (!path || path === location.pathname) return
    // O chamado aberto continua aberto na tela nova (como antes, com ?v=).
    const ticket = new URLSearchParams(location.search).get('ticket')
    navigate({ pathname: path, search: ticket ? `?ticket=${encodeURIComponent(ticket)}` : '' })
  }, [location.pathname, location.search, navigate])
  return [view, setView]
}
