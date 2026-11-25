/**
 * Moldura das telas logadas. Equipe: menu lateral e barra do topo com busca. Cliente: sem
 * menu lateral; marca, Início, Meus chamados e Nova solicitação ficam no topo.
 *
 * Dentro do Teams a marca, a busca do topo e a conta somem: o Teams já mostra o app, a conta e o tema.
 */
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Moon, Plus, RefreshCw, Sun, UserRound } from 'lucide-react'
import { Btn, Logo, LogoMark, MobileMenuButton, useTheme } from '@/components/ui'
import { UserMenu } from '@/components/UserMenu'
import { MainNav } from '@/components/MainNav'
import { CommandTrigger } from '@/components/CommandMenu'
import { useAuthStore } from '@/store/auth'
import { useNavStore } from '@/store/nav'
import { useInTeams } from '@/teams/teamsContext'

export function AppHeader({ children, right, onRefresh, panelToggle, responsive = false }: {
  /** Lado esquerdo extra. */
  children?: ReactNode
  /** Antes do "atualizar"/tema: sino, empresa… */
  right?: ReactNode
  /** Mostra o botão "Recarregar página" (recarrega de verdade: tela e chamado aberto ficam na URL). */
  onRefresh?: () => void
  /** Botão do painel próprio da tela no celular (Projetos e Documentos). */
  panelToggle?: ReactNode
  /** Compacta padding e espaçamento no celular (.responsive-header). */
  responsive?: boolean
}) {
  const user = useAuthStore((s) => s.user)!
  const { theme, toggle } = useTheme()
  const inTeams = useInTeams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { mobileOpen, setMobileOpen } = useNavStore()
  const isClient = user.role === 'user'
  const variant = theme === 'dark' ? 'dark' : 'light'
  const page = pathname.replace(/\/+$/, '')

  const refreshBtn = onRefresh && (
    <Btn variant="ghost" size="sm" className="icon-btn" onClick={onRefresh} title="Recarregar página" aria-label="Recarregar página"><RefreshCw size={17} /></Btn>
  )

  // Dentro do Teams não é o cabeçalho da página: é só uma faixa de ferramentas.
  const Tag = inTeams ? 'div' : 'header'
  return (
    <>
      {!isClient && <MainNav />}
      <Tag data-client={isClient || undefined} className={`topnav${inTeams ? ' teams-toolbar' : ''}${responsive ? ' responsive-header' : ''}`}>
        {isClient ? <>
          {!inTeams && (
            <Link to="/solicitacoes" className="topnav-brand app-brand" aria-label="Ir para o início">
              <span className="full"><Logo size={34} variant={variant} /></span><span className="mark"><LogoMark size={32} variant={variant} /></span>
            </Link>
          )}
          <nav className="topnav-links" aria-label="Telas">
            <Link to="/solicitacoes" aria-current={page === '/solicitacoes' ? 'page' : undefined}>Início</Link>
            <Link to="/solicitacoes/todas" aria-current={page === '/solicitacoes/todas' ? 'page' : undefined}>Meus chamados</Link>
          </nav>
        </> : <>
          <MobileMenuButton onClick={() => setMobileOpen(!mobileOpen)} isOpen={mobileOpen} />
          {panelToggle}
          {!inTeams && <CommandTrigger />}
        </>}
        {children}
        <div style={{ flex: 1 }} />
        {isClient && page !== '/solicitacoes/nova' && <Link to="/solicitacoes/nova" className="btn btn-primary btn-sm topnav-new" aria-label="Nova solicitação"><Plus size={17} aria-hidden /><span>Nova solicitação</span></Link>}
        {right}
        {refreshBtn}
        {inTeams ? (
          pathname !== '/perfil' && (
            <Btn variant="secondary" size="sm" onClick={() => navigate('/perfil')} title="Meu perfil" aria-label="Meu perfil" style={{ padding: '4px 10px', height: 32 }}>
              <UserRound size={14} />
            </Btn>
          )
        ) : (
          <>
            <Btn variant="ghost" size="sm" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </Btn>
            <UserMenu user={user} />
          </>
        )}
      </Tag>
    </>
  )
}
