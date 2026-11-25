import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CategoryOrgsModal } from './CategoryOrgsModal'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({
  adminService: { getCategoryOrgs: vi.fn(), setCategoryOrgs: vi.fn() },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const data = {
  inPlan: [
    { id: 'o1', name: 'Acme', tier: 'bronze', enabled: true },
    { id: 'o2', name: 'Globex', tier: 'bronze', enabled: false },
    { id: 'o3', name: 'Initech', tier: 'gold', enabled: true },
  ],
  outOfPlan: [{ id: 'o4', name: 'Umbrella', tier: 'silver' }],
}

describe('CategoryOrgsModal', () => {
  beforeEach(() => {
    vi.mocked(adminService.getCategoryOrgs).mockResolvedValue(data)
    vi.mocked(adminService.setCategoryOrgs).mockResolvedValue({ updated: 2, skipped: [] })
  })

  it('lista empresas com status e as fora do plano à parte', async () => {
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.getAllByText('Desligada')).toHaveLength(1)
    expect(screen.getByText(/1 empresa não tem esta categoria no plano/)).toBeInTheDocument()
  })

  it('filtra por plano e seleciona todas as filtradas', async () => {
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('Acme')
    fireEvent.change(screen.getByLabelText('Filtrar por plano'), { target: { value: 'bronze' } })
    expect(screen.queryByText('Initech')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Selecionar todas as empresas filtradas'))
    expect(screen.getByText('2 selecionadas')).toBeInTheDocument()
  })

  it('desabilita em lote após confirmar e avisa o painel', async () => {
    const onChanged = vi.fn()
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={onChanged} />)
    await screen.findByText('Acme')
    fireEvent.click(screen.getByLabelText('Selecionar Acme'))
    fireEvent.click(screen.getByLabelText('Selecionar Initech'))
    fireEvent.click(screen.getByRole('button', { name: 'Desabilitar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Desabilitar 2' }))
    await waitFor(() => expect(adminService.setCategoryOrgs).toHaveBeenCalledWith('c1', ['o1', 'o3'], false))
    expect(onChanged).toHaveBeenCalled()
  })

  it('limpa a seleção ao mudar o filtro', async () => {
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('Acme')
    fireEvent.click(screen.getByLabelText('Selecionar Acme'))
    expect(screen.getByText('1 selecionada')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filtrar por plano'), { target: { value: 'gold' } })
    expect(screen.getByText('0 selecionadas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desabilitar' })).toBeDisabled()
  })

  it('mostra erro de carga e permite tentar de novo', async () => {
    vi.mocked(adminService.getCategoryOrgs).mockRejectedValueOnce(new Error('falhou'))
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Não foi possível carregar as empresas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Acme')).toBeInTheDocument()
  })

  it('habilita em lote sem confirmação', async () => {
    render(<CategoryOrgsModal category={{ id: 'c1', name: 'Rede' }} onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('Acme')
    fireEvent.click(screen.getByLabelText('Selecionar Globex'))
    fireEvent.click(screen.getByRole('button', { name: 'Habilitar' }))
    await waitFor(() => expect(adminService.setCategoryOrgs).toHaveBeenCalledWith('c1', ['o2'], true))
  })
})
