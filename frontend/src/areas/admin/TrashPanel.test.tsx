import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TrashPanel } from './TrashPanel'
import api from '@/services/api'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  apiErrorMessage: vi.fn((_, fallback) => fallback),
}))

vi.mock('@/services/adminService', () => ({
  adminService: {
    getOrganizations: vi.fn(),
  },
}))

vi.mock('@/store/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/store/alertStore', () => ({
  sysAlert: { confirm: vi.fn().mockResolvedValue(true) },
}))

const sampleConfig = {
  enabled: true,
  retention_days: 30,
}

const sampleOrgs = [
  { id: 'org-1', name: 'Empresa Alfa' },
  { id: 'org-2', name: 'Empresa Beta' },
]

const sampleTrashData = {
  data: [
    {
      id: 'ticket-1',
      displayNumber: '#1001',
      title: 'Problema na impressora',
      org: { id: 'org-1', name: 'Empresa Alfa' },
      deletedBy: { id: 'u-1', name: 'Admin Silva' },
      deletedAt: '2026-10-01T10:00:00.000Z',
      purgeAt: '2026-10-31T10:00:00.000Z',
    },
  ],
  total: 1,
}

describe('TrashPanel — Organização e Filtro Padrão', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'adm', name: 'Admin', role: 'admin', email: 'adm@test.com' } as any })
    vi.mocked(adminService.getOrganizations).mockResolvedValue(sampleOrgs)
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/tickets/trash/config') {
        return Promise.resolve({ data: { data: sampleConfig } })
      }
      if (url === '/tickets/trash') {
        return Promise.resolve({ data: sampleTrashData })
      }
      return Promise.reject(new Error('not found'))
    })
  })

  it('renderiza o bloco de limpeza automática de forma organizada com toggle e input alinhados', async () => {
    render(<TrashPanel />)

    expect(await screen.findByText('Limpeza automática')).toBeInTheDocument()
    expect(screen.getByText('Excluir definitivamente após:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
  })

  it('renderiza o filtro padrão do sistema com FilterSearchInput e FilterButton', async () => {
    render(<TrashPanel />)

    // FilterSearchInput com placeholder padrão
    expect(await screen.findByPlaceholderText('Buscar por número ou título...')).toBeInTheDocument()

    // FilterButton (SlidersHorizontal)
    const filterBtn = screen.getByRole('button', { name: 'Filtros' })
    expect(filterBtn).toBeInTheDocument()

    // Clica no botão de filtros para abrir o FilterDropdown
    await act(async () => {
      fireEvent.click(filterBtn)
    })

    // O FilterDropdown deve renderizar o campo "Empresa"
    expect(screen.getByText('Empresa')).toBeInTheDocument()
  })

  it('chama a api com busca e filtro de empresa ao pesquisar', async () => {
    render(<TrashPanel />)

    const searchInput = await screen.findByPlaceholderText('Buscar por número ou título...')
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'impressora' } })
    })

    // Aguarda debounce de 300ms
    await new Promise((r) => setTimeout(r, 350))

    expect(api.get).toHaveBeenCalledWith('/tickets/trash', expect.objectContaining({
      params: expect.objectContaining({
        search: 'impressora',
      }),
    }))
  })
})
