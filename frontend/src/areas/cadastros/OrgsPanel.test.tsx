import { describe, expect, it, vi } from 'vitest'
import { copyOrganizationId } from './OrgsPanel'

describe('copyOrganizationId', () => {
  it('copies the organization id to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await expect(copyOrganizationId('org-123')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('org-123')
  })

  it('returns false when clipboard access is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await expect(copyOrganizationId('org-123')).resolves.toBe(false)
  })
})

describe('OrgsPanel — Paginação e Toolbar', () => {
  it('renderiza o controle de paginação na barra de filtros ao carregar organizações', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { OrgsPanel } = await import('./OrgsPanel')
    const { adminService } = await import('@/services/adminService')
    const { ticketService } = await import('@/services/ticketService')
    const { useAuthStore } = await import('@/store/auth')

    useAuthStore.setState({ user: { id: 'admin-1', role: 'admin', name: 'Admin' } as any })

    const sampleOrgs = Array.from({ length: 30 }, (_, i) => ({
      id: `org-${i + 1}`,
      name: `Organização ${i + 1}`,
      domains: [`org${i + 1}.com`],
      tier: 'bronze',
      active: true,
      manager_global: false,
    }))

    vi.spyOn(adminService, 'getOrganizations').mockResolvedValue(sampleOrgs as any)
    vi.spyOn(adminService, 'getSlaConfigs').mockResolvedValue([{ tier: 'bronze', default_queue: 'q1' }] as any)
    vi.spyOn(adminService, 'getQueues').mockResolvedValue([])
    vi.spyOn(adminService, 'getUsers').mockResolvedValue([])
    vi.spyOn(ticketService, 'getGroupedCounts').mockResolvedValue({})

    render(<OrgsPanel />)

    expect(await screen.findByText('1–25 de 30')).toBeInTheDocument()
    expect(screen.getByText('Por página')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 2' })).toBeInTheDocument()
  })
})

