import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BusinessHoursPanel } from './BusinessHoursPanel'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'

describe('BusinessHoursPanel', () => {
  const mockConfig = {
    business_hours_start: '08:00',
    business_hours_end: '18:00',
    working_days: [1, 2, 3, 4, 5],
    timezone: 'America/Sao_Paulo',
    holidays: ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'admin-1', role: 'admin', name: 'Administrador' } as any })
    vi.spyOn(adminService, 'getBusinessHours').mockResolvedValue(mockConfig as any)
    vi.spyOn(adminService, 'updateBusinessHours').mockImplementation(async (data: any) => ({
      ...mockConfig,
      ...data,
    }))
  })

  it('carrega e renderiza os parâmetros e indicadores operacionais', async () => {
    render(<BusinessHoursPanel />)

    // Aguarda carregar dados
    expect(await screen.findByText('Parâmetros de horário')).toBeInTheDocument()

    // Verifica StatCards
    expect(screen.getByText('Status operacional')).toBeInTheDocument()
    expect(screen.getByText('Janela diária')).toBeInTheDocument()
    expect(screen.getByText('Cobertura semanal')).toBeInTheDocument()
    expect(screen.getByText('Feriados nacionais')).toBeInTheDocument()

    // Verifica Régua Visual e Feriados
    expect(screen.getByText('Régua visual semanal')).toBeInTheDocument()
    expect(screen.getByText('Próximos feriados nacionais')).toBeInTheDocument()
  })

  it('permite alterar o horário de início e fim e indica alterações pendentes', async () => {
    render(<BusinessHoursPanel />)

    expect(await screen.findByText('Parâmetros de horário')).toBeInTheDocument()

    const startInput = screen.getByDisplayValue('08:00')
    fireEvent.change(startInput, { target: { value: '09:00' } })

    // Deve indicar alterações pendentes
    expect(screen.getAllByText('Alterações pendentes').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Descartar/i }).length).toBeGreaterThan(0)
  })

  it('permite alternar dias úteis e descartar alterações', async () => {
    render(<BusinessHoursPanel />)

    expect(await screen.findByText('Parâmetros de horário')).toBeInTheDocument()

    // Clica no botão de Limpar
    const clearBtn = screen.getByText('Limpar')
    fireEvent.click(clearBtn)

    expect(screen.getByText('0 dias selecionados')).toBeInTheDocument()
    expect(screen.getByText('Selecione ao menos um dia de expediente.')).toBeInTheDocument()

    // Descartar restaura os dias anteriores
    const discardBtn = screen.getByRole('button', { name: /Descartar/i })
    fireEvent.click(discardBtn)

    expect(screen.getByText('5 dias selecionados')).toBeInTheDocument()
  })

  it('chama updateBusinessHours ao salvar alterações válidas', async () => {
    render(<BusinessHoursPanel />)

    expect(await screen.findByText('Parâmetros de horário')).toBeInTheDocument()

    // Clica no dia Sábado para ativá-lo
    const sabBtn = screen.getByTitle(/Sábado/i)
    fireEvent.click(sabBtn)

    // Clica em Salvar
    const saveButton = screen.getByRole('button', { name: /Salvar alterações/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(adminService.updateBusinessHours).toHaveBeenCalledWith({
        business_hours_start: '08:00',
        business_hours_end: '18:00',
        working_days: [1, 2, 3, 4, 5, 6],
        timezone: 'America/Sao_Paulo',
      })
    })

    // Deve exibir aviso de sucesso
    expect(await screen.findByText(/Horário comercial atualizado com sucesso!/i)).toBeInTheDocument()
  })
})
