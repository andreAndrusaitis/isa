import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AreaScreen, screenDenied, type ScreenContext } from './AreaScreen'

vi.mock('./admin/KnowledgeBasePanel', () => ({ KnowledgeBasePanel: () => <div>Painel da base</div> }))

const ctx = (role: string): ScreenContext => ({
  user: { id: 'u1', role, permissions: [] } as unknown as ScreenContext['user'],
  users: [], queues: [], orgs: [], onDashboardNavigate: () => {}, onOpenTicket: () => {}, onGo: () => {}, onBack: () => {},
})

describe('tela da base de conhecimento', () => {
  it('só o admin abre', () => {
    expect(screenDenied('admin_knowledge', { role: 'admin', permissions: [] })).toBe(false)
    for (const role of ['manager', 'supervisor', 'agent', 'user'] as const) {
      expect(screenDenied('admin_knowledge', { role, permissions: [] })).toBe(true)
    }
  })

  it('nenhuma permissão de área libera a tela para quem não é admin', () => {
    expect(screenDenied('admin_knowledge', { role: 'manager', permissions: ['admin_knowledge', 'knowledge', 'admin_ai'] })).toBe(true)
  })

  it('admin vê o painel', () => {
    render(<AreaScreen view="admin_knowledge" ctx={ctx('admin')} />)
    expect(screen.getByText('Painel da base')).toBeInTheDocument()
  })

  it('quem não é admin cai na tela de acesso negado', () => {
    render(<AreaScreen view="admin_knowledge" ctx={ctx('manager')} />)
    expect(screen.queryByText('Painel da base')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /voltar/i })).toBeInTheDocument()
  })
})
