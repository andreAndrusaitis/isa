import { useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { OverviewDashboard } from './OverviewDashboard'
import { ProductivityDashboard } from './ProductivityDashboard'
import { ManagementDashboard } from './ManagementDashboard'
import { CorporationsDashboard } from './CorporationsDashboard'
import { SlaExpiringDashboard } from './SlaExpiringDashboard'
import { InactivityDashboard } from './InactivityDashboard'
import { AiTriageDashboard } from './AiTriageDashboard'
import { ChannelsDashboard } from './ChannelsDashboard'
import { KnowledgeMetricsDashboard } from './KnowledgeMetricsDashboard'
import '../gestao.css'

const TABS: readonly { key: string; label: string; capability?: string }[] = [
  { key: 'overview',      label: 'Visão geral' },
  { key: 'productivity',  label: 'Produtividade' },
  { key: 'management',    label: 'Gerência' },
  { key: 'corporations',  label: 'Corporações' },
  { key: 'sla_expiring',  label: 'A vencer' },
  { key: 'inactivity',    label: 'Inatividade' },
  { key: 'ai_triage',     label: 'Triagem IA' },
  { key: 'knowledge',     label: 'Base de conhecimento', capability: 'knowledge.metrics' },
  { key: 'channels',      label: 'Canais' },
]

export type DashNavAction = { view: string; filters?: Record<string, any> }

interface Props {
  agents: any[]
  queues: any[]
  orgs: any[]
  onNavigate?: (action: DashNavAction) => void
}

export function DashboardPage({ agents, queues, orgs, onNavigate }: Props) {
  const [tab, setTab] = useState('overview')
  const capabilities = useAuthStore(s => s.user?.capabilities)

  return (
    <div className="dash">
      <nav className="subtabs dash-nav" aria-label="Visões do painel">
        {TABS.filter(t => !t.capability || capabilities?.includes(t.capability)).map(({ key, label }) => (
          <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <div className="dash-body">
        {tab === 'overview'     && <OverviewDashboard onNavigate={onNavigate} />}
        {tab === 'productivity' && <ProductivityDashboard />}
        {tab === 'management'   && <ManagementDashboard agents={agents} onNavigate={onNavigate} />}
        {tab === 'corporations' && <CorporationsDashboard onNavigate={onNavigate} />}
        {tab === 'sla_expiring' && <SlaExpiringDashboard onNavigate={onNavigate} />}
        {tab === 'inactivity'   && <InactivityDashboard agents={agents} queues={queues} orgs={orgs} onNavigate={onNavigate} />}
        {tab === 'ai_triage'    && <AiTriageDashboard orgs={orgs} />}
        {tab === 'knowledge'    && <KnowledgeMetricsDashboard orgs={orgs} />}
        {tab === 'channels'     && <ChannelsDashboard />}
      </div>
    </div>
  )
}
