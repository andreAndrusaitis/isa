import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useAuthStore, takePostLoginRedirect } from '@/store/auth'
import { usePublicConfig } from '@/store/publicConfig'
import { useLogin } from '@/hooks/useAuth'
import { Btn, Logo, LogoMark, useTheme } from '@/components/ui'
import { useStagger } from '@/lib/motion'
import { homeOf } from '@/utils/home'
import { tryTeamsSso } from '@/services/teamsSso'

const SSO_ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: 'Este e-mail não está autorizado a acessar o sistema. Contate o administrador.',
  tenant_not_allowed: 'Sua organização Microsoft não está autorizada a acessar o sistema. Contate o administrador.',
  user_not_found: 'Usuário não encontrado ou não permitido. Contate o administrador.',
  idp_unavailable: 'Não foi possível conectar ao provedor de login da Microsoft. Tente novamente em instantes.',
  invalid_response: 'Falha ao concluir o login via Microsoft. Tente novamente.',
  missing_email: 'Sua conta Microsoft não retornou um e-mail válido para login.',
  not_configured: 'Login via Microsoft não está disponível no momento.',
}

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showLocalForm, setShowLocalForm] = useState(false)
  const { login, loading, error, clearError } = useLogin()
  const user     = useAuthStore((s) => s.user)
  const microsoft = usePublicConfig((s) => s.microsoftLogin)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const ssoError = searchParams.get('ssoError')
  const [teamsSsoError, setTeamsSsoError] = useState<string | null>(null)
  const ssoErrorMessage = ssoError ? (SSO_ERROR_MESSAGES[ssoError] || 'Não foi possível concluir o login via Microsoft.') : null
  const { theme, toggle: toggleTheme } = useTheme()
  const formRef = useStagger<HTMLDivElement>({ y: 14, gap: 60, delay: 120 })

  useEffect(() => {
    let active = true
    void tryTeamsSso().then((result) => {
      if (active && result === 'consent-required') {
        setTeamsSsoError('O administrador da sua organização precisa aprovar o acesso ao ISA no Microsoft Entra ID antes de usar o SSO do Teams.')
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user) return
    navigate(takePostLoginRedirect() ?? homeOf(user), { replace: true })
  }, [user, navigate])

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    login(email, password, rememberMe)
  }

  // Sem login Microsoft, o formulário é o único caminho e já aparece aberto.
  const localForm = microsoft === false || showLocalForm

  return (
    <div className="login-page">
      <div className="login-side">
        <Logo variant={theme === 'dark' ? 'dark' : 'light'} size={36} />

        <div ref={formRef} className="login-form">
          <h1>Entrar</h1>
          <p>Use a sua conta corporativa.</p>

          {microsoft && (
            <Btn type="button" variant="secondary" size="lg" onClick={() => { window.location.href = '/auth/login' }} icon={
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            }>
              Entrar com Microsoft
            </Btn>
          )}

          {ssoErrorMessage && <div role="alert" className="login-note">{ssoErrorMessage}</div>}
          {teamsSsoError && <div role="alert" className="login-note">{teamsSsoError}</div>}

          {microsoft && !showLocalForm && (
            <button type="button" className="login-link" onClick={() => setShowLocalForm(true)}>
              Entrar com conta cadastrada
            </button>
          )}

          {localForm && (
            <form onSubmit={handleSubmit}>
              <label className="login-field">
                <span>E-mail corporativo</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com.br"
                  autoComplete="username"
                  required
                  autoFocus
                  maxLength={100}
                />
              </label>

              <label className="login-field">
                <span>Senha</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  maxLength={100}
                />
              </label>

              <label className="login-check">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                <span>Lembrar de mim por 30 dias</span>
              </label>

              {error && (
                <div role="alert" className="login-note login-error-shake">
                  <span>{error}</span>
                  <button type="button" className="icon-act" onClick={clearError} aria-label="Fechar aviso"><X size={16} /></button>
                </div>
              )}

              <Btn type="submit" disabled={loading} variant="primary" size="lg" style={{ minWidth: 160 }}>
                {loading ? 'Verificando...' : 'Entrar'}
              </Btn>
            </form>
          )}
        </div>

        <footer className="login-foot">
          <span>Integrated Service Atlas</span>
          <button type="button" className="login-link" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>
            {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
        </footer>
      </div>

      <div className="login-panel" aria-hidden="true"><LogoMark variant="mono" /></div>
    </div>
  )
}
