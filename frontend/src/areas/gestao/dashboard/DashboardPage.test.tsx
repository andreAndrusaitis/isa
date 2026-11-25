import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardPage } from './DashboardPage'
import { useAuthStore } from '@/store/auth'

vi.mock('./OverviewDashboard', () => ({ OverviewDashboard: () => <div>Visão</div> }))
vi.mock('./KnowledgeMetricsDashboard', () => ({ KnowledgeMetricsDashboard: () => <div>Painel da base</div> }))

const as = (capabilities: string[]) => useAuthStore.setState({ user: { id: 'u', role: 'manager', capabilities } as any })
const open = () => render(<DashboardPage agents={[]} queues={[]} orgs={[]} />)

describe('DashboardPage: aba da base de conhecimento', () => {
  beforeEach(() => useAuthStore.setState({ user: null }))

  it('aparece para quem tem a capacidade e abre o painel', () => {
    as(['dashboard.view', 'knowledge.metrics'])
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Base de conhecimento' }))
    expect(screen.getByText('Painel da base')).toBeInTheDocument()
  })

  it('não aparece para o Ticket Manager, que só tem os painéis gerenciais', () => {
    as(['dashboard.view'])
    open()
    expect(screen.getByRole('button', { name: 'Triagem IA' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Base de conhecimento' })).not.toBeInTheDocument()
  })
})
