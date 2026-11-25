/**
 * ISA - Frontend Entry Point
 * 
 * Este arquivo define a estrutura principal de navegação da aplicação (roteamento),
 * as proteções de acesso baseadas em perfil (RBAC) e a orquestração inicial.
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { useAuthStore, POST_LOGIN_REDIRECT_KEY } from '@/store/auth'
import { QueueExpirationPopup } from '@/components/QueueExpirationPopup'
import { GlobalNotificationContainer, GlobalTooltip, PageLoader } from '@/components/ui'
import { ForcePasswordChangeGate } from '@/components/ForcePasswordChangeGate'
import { PageTransition } from '@/lib/motion'
import { AUTH_BASE_URL } from '@/services/api'
import { checkProjectsAccess } from '@/services/projectsService'
import { homeOf, legacyHomeOf } from '@/utils/home'
import { pathForView } from '@/access/routes'
import { TeamsBridge } from '@/teams/TeamsBridge'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const SsoCallbackPage = lazy(() => import('@/pages/SsoCallbackPage'))
const UserPortalPage = lazy(() => import('@/areas/solicitacoes/UserPortalPage'))
const StaffWorkspace = lazy(() => import('@/areas/chamados/StaffWorkspace'))
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const SurveyAnswerPage = lazy(() => import('@/pages/SurveyAnswerPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const ProjetosPage = lazy(() => import('@/pages/projects/ProjetosPage'))
const DocumentosPage = lazy(() => import('@/pages/docs/DocumentosPage'))
const ProjectsAccessDenied = lazy(() => import('@/pages/projects/ProjectsAccessDenied'))

/**
 * Componente de Proteção de Rota (Guard)
 * 
 * Verifica se o usuário está autenticado e se possui a role necessária.
 * Caso contrário, redireciona para a página de login ou página inicial.
 */
function RequireAuth({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const location = useLocation()
  // Aba nova sem sessão local (sem "Lembrar de mim" a sessão vive no
  // sessionStorage de cada aba): tenta UMA vez o cookie de refresh antes do login.
  const [restoreFailed, setRestoreFailed] = useState(false)
  useEffect(() => {
    if (user || restoreFailed) return
    fetch(`${AUTH_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(b => setAuth(b.data.user, b.data.accessToken))
      .catch(() => setRestoreFailed(true))
  }, [user, restoreFailed, setAuth])

  // 1. Se não houver usuário logado, vai para o Login — guardando o destino
  //    (ex.: link do e-mail /portal?ticket=...) para voltar após o login.
  if (!user) {
    if (!restoreFailed) return null
    try { sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, location.pathname + location.search) } catch {}
    return <Navigate to="/login" replace />
  }

  // 1a. Primeiro acesso com senha provisória — bloqueia qualquer rota até a
  // troca ser concluída (não redireciona, só substitui o conteúdo: assim o
  // usuário nunca chega a ver a tela que pediu, sem depender de mais uma rota).
  if (user.mustChangePassword) return <ForcePasswordChangeGate />

  // 2. Se a rota exigir papéis específicos e o usuário não os tiver, redireciona para seu ambiente preservando query params.
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeOf(user)} replace />
  }

  // 3. Tudo ok, renderiza o conteúdo da página.
  return <>{children}</>
}

/**
 * Guard dedicado da área de Projetos.
 *
 * Diferente de RequireAuth: em vez de redirecionar silenciosamente quando
 * o usuário não tem a permissão, mostra uma página explícita de acesso
 * negado. O backend (GET /api/projects/access) é a autoridade final;
 * este guard só evita renderizar o shell antes de confirmar.
 */
function RequireProjectsAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<'checking' | 'allowed' | 'denied'>('checking')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    checkProjectsAccess()
      .then((allowed) => {
        if (!cancelled) setStatus(allowed ? 'allowed' : 'denied')
      })
      .catch(() => {
        if (!cancelled) setStatus('denied')
      })
    return () => { cancelled = true }
  }, [user])

  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <ForcePasswordChangeGate />
  if (status === 'checking') return <PageLoader label="Verificando acesso…" />
  if (status === 'denied') return <ProjectsAccessDenied />
  return <>{children}</>
}

/** Sem o módulo Documentos, o endereço volta à tela inicial da pessoa. */
function DocumentsGate() {
  const user = useAuthStore((s) => s.user)!
  if (user.role !== 'admin' && !user.modules?.documents) return <Navigate to={homeOf(user)} replace />
  return <DocumentosPage />
}

/**
 * Roteador de Decisão por Papel (Role)
 * 
 * Usado na rota raiz ('/') para decidir qual dashboard exibir automaticamente
 * assim que o usuário entra no sistema.
 */
function RoleRouter() {
  const user = useAuthStore((s) => s.user)

  if (!user) return <Navigate to="/login" replace />

  // Tela inicial calculada pelo servidor (time só de projetos cai em Projetos).
  return <Navigate to={homeOf(user)} replace />
}

/**
 * Áreas (/chamados, /solicitacoes, /gestao, /cadastros, /configuracoes, /admin/*):
 * cada endereço é uma tela (frontend/src/access/routes.ts). A equipe (analista,
 * TM, gerente) usa uma tela só (StaffWorkspace), que lê a tela do endereço
 * (useAreaView). Rota-pai única: trocar de área não recria a página (filtros sobrevivem).
 */
function AreaShell() {
  const user = useAuthStore((s) => s.user)!
  const location = useLocation()
  if (user.role === 'user') {
    if (!location.pathname.startsWith('/solicitacoes')) return <Navigate to={`/solicitacoes${location.search}`} replace />
    return <UserPortalPage />
  }
  if (user.role === 'admin') return <AdminPage />
  return <StaffWorkspace />
}

/**
 * Endereços antigos (/agent, /supervisor, /admin, /portal com ?v= e ?ticket=)
 * levam ao novo: favoritos e links de e-mail já enviados continuam valendo.
 */
function LegacyRedirect() {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const ticket = params.get('ticket')
  if (ticket) return <Navigate to={`/c/${encodeURIComponent(ticket)}`} replace />
  const view = params.get('v')
  const target = (view && pathForView(view))
    ?? (location.pathname.startsWith('/portal') ? '/solicitacoes' : user ? legacyHomeOf(user) : '/')
  return <Navigate to={target} replace />
}

/**
 * Link do chamado (/c/:id, usado nos e-mails): abre como solicitante (Minhas
 * solicitações) ou como equipe (Chamados), conforme quem entrou. A página
 * de destino abre o chamado pelo ?ticket=.
 */
function TicketLink() {
  const user = useAuthStore((s) => s.user)!
  const { id = '' } = useParams()
  const asRequester = user.role === 'user' || (user.role !== 'admin' && user.modules?.tickets === false)
  const base = asRequester ? '/solicitacoes' : user.role === 'admin' ? '/chamados/filas/todas' : '/chamados'
  return <Navigate to={`${base}?ticket=${encodeURIComponent(id)}`} replace />
}

/**
 * Componente Principal App
 * Define a tabela de rotas da aplicação usando React Router v6.
 */
export default function App() {
  return (
    <>
      <PageTransition>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Rota pública de autenticação */}
        <Route path="/login" element={<LoginPage />} />

        {/* Rota pública de callback pós-SSO (Microsoft Entra ID) */}
        <Route path="/sso/callback" element={<SsoCallbackPage />} />

        {/* Rota pública de Pesquisa de satisfação */}
        <Route path="/survey/:token" element={<SurveyAnswerPage />} />

        {/* Rota raiz: Decide para onde o usuário vai após o login */}
        <Route path="/" element={<RequireAuth><RoleRouter /></RequireAuth>} />

        {/* Página de Perfil: acessível a qualquer role autenticada */}
        <Route path="/perfil" element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        } />

        {/* Áreas: um endereço para cada tela (rota-pai única, ver AreaShell) */}
        <Route element={<RequireAuth><AreaShell /></RequireAuth>}>
          <Route path="/chamados/*" element={<Outlet />} />
          <Route path="/solicitacoes/*" element={<Outlet />} />
          <Route path="/gestao/*" element={<Outlet />} />
          <Route path="/cadastros/*" element={<Outlet />} />
          <Route path="/configuracoes/*" element={<Outlet />} />
          <Route path="/admin/*" element={<Outlet />} />
        </Route>
        {/* /admin sozinho é o endereço antigo do painel do admin */}
        <Route path="/admin" element={<RequireAuth><LegacyRedirect /></RequireAuth>} />

        {/* Link do chamado (e-mails) */}
        <Route path="/c/:id" element={<RequireAuth><TicketLink /></RequireAuth>} />

        {/* Endereços antigos → novos */}
        <Route path="/portal/*" element={<RequireAuth><LegacyRedirect /></RequireAuth>} />
        <Route path="/agent/*" element={<RequireAuth><LegacyRedirect /></RequireAuth>} />
        <Route path="/supervisor/*" element={<RequireAuth><LegacyRedirect /></RequireAuth>} />

        {/* Módulo de Projetos: área dedicada, fora do menu lateral padrão */}
        <Route path="/projetos/*" element={
          <RequireProjectsAccess>
            <ProjetosPage />
          </RequireProjectsAccess>
        } />

        {/* Documentos: espaços e páginas. O servidor confere o módulo em cada chamada. */}
        <Route path="/documentos/*" element={<RequireAuth><DocumentsGate /></RequireAuth>} />

        {/* Fallback: Qualquer rota desconhecida redireciona para a raiz */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </PageTransition>
      <QueueExpirationPopup />
      <GlobalNotificationContainer />
      <GlobalTooltip />
      <TeamsBridge />
    </>
  )
}
