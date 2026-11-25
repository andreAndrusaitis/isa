/**
 * Página de callback pós-SSO (OIDC).
 *
 * O backend (/auth/acs) já validou a resposta do Azure e setou o cookie
 * httpOnly de refresh token antes de redirecionar para cá — no domínio do
 * FRONTEND, pois é para lá que o Azure redireciona (o nginx faz proxy até o
 * backend). Por isso o refresh AQUI usa fetch relativo (mesmo domínio, via
 * proxy /api/ do nginx) em vez do axios `api` com baseURL apontando direto
 * pro backend: uma chamada cross-site nunca receberia esse cookie de volta.
 * Os refreshes seguintes (interceptor do `api`) usam o mesmo proxy (AUTH_BASE_URL).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, AuthUser, takePostLoginRedirect, REMEMBER_KEY } from '@/store/auth'
import { homeOf } from '@/utils/home'
import { Loading } from '@/components/ui'

export default function SsoCallbackPage() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`refresh falhou: ${res.status}`)
        const body = await res.json()
        if (cancelled) return
        const { user, accessToken } = body.data as { user: AuthUser; accessToken: string }
        // SSO = sempre "Lembrar de mim" (30 dias): localStorage é compartilhado entre
        // abas, então abrir uma aba nova não pede login de novo.
        localStorage.setItem(REMEMBER_KEY, 'true')
        setAuth(user, accessToken)
        navigate(takePostLoginRedirect() ?? homeOf(user), { replace: true })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('SSO callback: falha ao finalizar sessão', err)
        setError('Não foi possível concluir o login via Microsoft. Tente novamente.')
        setTimeout(() => { if (!cancelled) navigate('/login', { replace: true }) }, 2500)
      })

    return () => { cancelled = true }
  }, [setAuth, navigate])

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100vh', padding: '0 clamp(24px, 6vw, 96px)', fontSize: 18, background: 'var(--bg-app)', color: 'var(--text-1)' }}>
      {error ?? <Loading label="Concluindo login…" />}
    </div>
  )
}
