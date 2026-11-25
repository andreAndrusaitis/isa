import { useState, useEffect } from 'react'
import { AppHeader } from '@/components/AppHeader'
import { AreaScreen, isAreaScreen, type ScreenContext } from '@/areas/AreaScreen'
import { useSearchParams } from 'react-router-dom'
import { useAreaView } from '@/access/useAreaView'
import { useAuthStore } from '@/store/auth'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import { useNavStore } from '@/store/nav'
import { AdminQueueView } from '../areas/chamados/AdminQueueView'
import { useStaticDataStore } from '@/store/staticData'
import { connectSocket } from '@/services/socketService'

export default function AdminPage() {
  const user = useAuthStore(s => s.user)!
  const accessToken = useAuthStore(s => s.accessToken)
  const [sideView, setSideView] = useAreaView('dash_main')

  useEffect(() => {
    if (accessToken) {
      connectSocket(accessToken)
    }
  }, [accessToken])
  const [queues, setQueues] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [orgs, setOrgs] = useState<any[]>([])
  const [dashboardFilters, setDashboardFilters] = useState<any>(null)
  const staticData = useStaticDataStore()

  useEffect(() => {
    Promise.all([
      ticketService.getCounts(),
      adminService.getQueues(),
      adminService.getUsers(),
      adminService.getOrganizations(),
      staticData.getCategories(),
    ]).then(([countsData, qData, uData, oData]) => {
      setQueues(qData)
      useNavStore.getState().publish({ queues: qData, counts: countsData, stats: null, online: [] })
      setUsers(uData)
      setOrgs(oData)
    }).catch(err => {
      console.error('[AdminPage] Erro ao carregar contagens:', err)
    })
  }, [])

  // Link do chamado (/c/<id> → /chamados/filas/todas?ticket=<id>): abre na lista.
  const [searchParams] = useSearchParams()
  const ticketParam = searchParams.get('ticket')
  useEffect(() => {
    if (ticketParam) handleDashNavigate({ view: 'queue', filters: { ticketId: ticketParam } })
  }, [ticketParam]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDashNavigate({ view, filters }: { view: string; filters?: any }) {
    if (filters) setDashboardFilters(filters)
    setSideView(view)
  }

  // Telas das áreas (registro único em areas/AreaScreen).
  const screenCtx: ScreenContext = {
    user, users, queues, orgs,
    onDashboardNavigate: handleDashNavigate,
    onOpenTicket: ticketId => handleDashNavigate({ view: 'queue', filters: { ticketId } }),
    onBack: () => setSideView('dash_main'),
    onGo: setSideView,
  }

  return (
    <div className="app-shell">
      <AppHeader responsive />
      <div className="app-body">
        <div className="app-main">
          {isAreaScreen(sideView) && <AreaScreen view={sideView} ctx={screenCtx}/>}
          {(sideView==='queue'||sideView.startsWith('queue_')) && <AdminQueueView initialFilters={dashboardFilters || (sideView.startsWith('queue_') ? { queue: sideView.split('_')[1] } : null)} currentUser={user}/>}
        </div>
      </div>
    </div>
  )
}
