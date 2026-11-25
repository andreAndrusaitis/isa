/**
 * Liga a aba do Teams ao app: segue o tema do Teams (inclusive quando a pessoa
 * troca com a aba aberta) e abre o chamado do link profundo (subEntityId).
 * Fora do Teams não faz nada.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getTeamsContext } from './teamsContext'
import { applyTeamsTheme } from './teamsTheme'
import { ticketPathFromSubEntity } from './deepLink'

// O subEntityId vale só para a abertura da aba (StrictMode monta duas vezes).
let deepLinkHandled = false

export function TeamsBridge() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    let cancelled = false
    void getTeamsContext().then(async (context) => {
      if (cancelled || !context) return
      applyTeamsTheme(context.app.theme)
      const { app } = await import('@microsoft/teams-js')
      app.registerOnThemeChangeHandler(theme => applyTeamsTheme(theme, true))

      const path = ticketPathFromSubEntity(context.page.subPageId)
      if (!path || deepLinkHandled) return
      deepLinkHandled = true
      if (pathname !== path) navigate(path, { replace: true })
    })
    return () => { cancelled = true }
    // Só na abertura: o contexto do Teams não muda com a navegação interna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

/** Só para testes. */
export function resetTeamsBridge() {
  deepLinkHandled = false
}
