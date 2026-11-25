import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoutingPanel } from './RoutingPanel'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'

const schema = {
  triggers: [{ id: 'ticket_created', label: 'Gatilho do catálogo' }, { id: 'ticket_idle', label: 'Parado há X horas', needsHours: true }],
  operators: [{ id: 'equals', label: 'operador do catálogo' }],
  fields: [{ id: 'status', label: 'Campo do catálogo', kind: 'enum', operators: ['equals'], options: [{ id: 'open', label: 'Opção do catálogo' }] }],
  actions: [{ id: 'stop', label: 'Ação do catálogo', kind: 'none' }, { id: 'create_project_task', label: 'Criar task no projeto e vincular', kind: 'project_task_template' }],
}

vi.mock('@/services/adminService', () => ({
  adminService: {
    getRoutingSchema: vi.fn(() => Promise.resolve(schema)),
    getRoutingRules: vi.fn().mockResolvedValue([]),
    getOrganizations: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue([]),
    getUsers: vi.fn().mockResolvedValue([]),
    getQueues: vi.fn().mockResolvedValue([]),
    getSlaConfigs: vi.fn().mockResolvedValue([]),
    updateRoutingRule: vi.fn(),
    createRoutingRule: vi.fn(async (rule: any) => ({ ...rule, id: 'r1' })),
    getRoutingProjectTargets: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Inovação', taskTypes: [{ id: 'tt1', name: 'Bug', prefix: 'BUG' }], tasks: [] },
    ]),
  },
}))
vi.mock('@/services/macroService', () => ({ macroService: { getMacros: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/webhookService', () => ({ webhookService: { getEndpoints: vi.fn().mockRejectedValue(new Error('403')) } }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

describe('RoutingPanel — opções vindas do /routing/schema', () => {
  it('monta gatilho, campo, operador, valor e ação a partir do catálogo', async () => {
    render(<RoutingPanel />)
    fireEvent.click(await screen.findByText('Nova regra'))

    expect(screen.getByRole('option', { name: 'Gatilho do catálogo' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Campo do catálogo' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'operador do catálogo' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Opção do catálogo' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Ação do catálogo' })).toBeTruthy()
  })

  it('pede as horas só no gatilho de inatividade', async () => {
    render(<RoutingPanel />)
    fireEvent.click(await screen.findByText('Nova regra'))
    expect(screen.queryByText('Horas parado')).toBeNull()
    fireEvent.change(screen.getByDisplayValue('Gatilho do catálogo'), { target: { value: 'ticket_idle' } })
    expect(screen.getByText('Horas parado')).toBeTruthy()
  })
})

describe('RoutingPanel — feedback de falha', () => {
  it('avisa quando o backend recusa ligar/desligar a regra', async () => {
    vi.mocked(adminService.getRoutingRules).mockResolvedValueOnce([
      { id: 'r1', name: 'Regra X', enabled: true, priority: 1, trigger: 'ticket_created', conditions: [], actions: [] },
    ] as any)
    vi.mocked(adminService.updateRoutingRule).mockRejectedValueOnce({ response: { data: { error: 'Regra bloqueada' } } })
    render(<RoutingPanel />)
    fireEvent.click(await screen.findByRole('switch'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Regra bloqueada'))
  })
})

describe('RoutingPanel — ação de projeto', () => {
  it('monta projeto, tipo e prazo da task a criar e salva como JSON', async () => {
    render(<RoutingPanel />)
    fireEvent.click(await screen.findByText('Nova regra'))
    fireEvent.change(screen.getByLabelText('Ação 1'), { target: { value: 'create_project_task' } })
    fireEvent.change(screen.getByLabelText('Valor da ação 1: projeto'), { target: { value: 'p1' } })
    fireEvent.change(screen.getByLabelText('Valor da ação 1: tipo da task'), { target: { value: 'tt1' } })
    fireEvent.change(screen.getByLabelText('Valor da ação 1: prazo em dias'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Salvar regra'))
    await waitFor(() => expect(adminService.createRoutingRule).toHaveBeenCalled())
    const payload = vi.mocked(adminService.createRoutingRule).mock.calls[0][0]
    expect(JSON.parse(payload.actions[0].value)).toEqual({ projectId: 'p1', taskTypeId: 'tt1', dueInDays: 3 })
  })
})
