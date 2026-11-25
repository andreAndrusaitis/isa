import axios from 'axios'
import { REMEMBER_KEY, type AuthUser, useAuthStore } from '@/store/auth'

export type TeamsSsoResult = 'signed-in' | 'not-in-teams' | 'consent-required' | 'failed'

let inFlightTeamsSso: Promise<TeamsSsoResult> | null = null
let inFlightRenewal: Promise<string | null> | null = null

/**
 * Indica se a página roda dentro do Teams: iframe no desktop/web, ou a webview
 * do app móvel (que injeta `nativeInterface` e identifica-se no user agent).
 */
export function isInTeams(): boolean {
  if (typeof window === 'undefined') return false
  if (window.self !== window.top) return true
  return 'nativeInterface' in window || /Teams\/|TeamsMobile/i.test(window.navigator.userAgent)
}

function needsAdminConsent(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return message.includes('consent') || message.includes('admin')
}

// Troca o token do Teams por uma sessão ISA. O token Entra só vive nesta chamada:
// o Teams o cacheia por conta própria e o ISA nunca o persiste.
// O SDK é carregado sob demanda para não pesar no bundle de quem usa o navegador.
async function exchangeTeamsToken(): Promise<string> {
  const { app, authentication } = await import('@microsoft/teams-js')
  await app.initialize()
  const teamsToken = await authentication.getAuthToken()
  const response = await axios.post('/api/auth/teams', undefined, {
    headers: { Authorization: `Bearer ${teamsToken}` },
    withCredentials: true,
  })
  const { user, accessToken } = response.data.data as { user: AuthUser; accessToken: string }

  localStorage.setItem(REMEMBER_KEY, 'true')
  useAuthStore.getState().setAuth(user, accessToken)
  return accessToken
}

async function signInWithTeams(): Promise<TeamsSsoResult> {
  try {
    await exchangeTeamsToken()
    return 'signed-in'
  } catch (error) {
    return needsAdminConsent(error) ? 'consent-required' : 'failed'
  }
}

/** Attempts silent SSO only inside Teams, once per page load even under React StrictMode. */
export function tryTeamsSso(): Promise<TeamsSsoResult> {
  if (!isInTeams()) return Promise.resolve('not-in-teams')
  inFlightTeamsSso ??= signInWithTeams()
  return inFlightTeamsSso
}

/**
 * Renova a sessão dentro do Teams quando o cookie de refresh não chega (cookie de
 * terceiros bloqueado no Safari, Teams para Mac e mobile). Chamadas simultâneas
 * compartilham a mesma troca. Devolve o novo access token, ou null se não deu.
 */
export function renewTeamsSession(): Promise<string | null> {
  if (!isInTeams()) return Promise.resolve(null)
  inFlightRenewal ??= exchangeTeamsToken()
    .catch(() => null)
    .finally(() => { inFlightRenewal = null })
  return inFlightRenewal
}
