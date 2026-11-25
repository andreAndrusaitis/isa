import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueuesPanel } from './QueuesPanel'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({
  adminService: {
    getQueues: vi.fn(),
    createQueue: vi.fn(),
    updateQueue: vi.fn(),
    deleteQueue: vi.fn(),
    getQueueAgents: vi.fn().mockResolvedValue([]),
    getUsers: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('animejs', () => ({
  animate: vi.fn(),
  createSpring: vi.fn(),
  spring: vi.fn(),
}))

vi.mock('@/store/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const sampleQueues = [
  {
    id: 'queue-uuid-001',
    name: 'Suporte N1',
    description: 'Atendimento inicial',
    color: '#0f73ac',
    active: true,
  },
]

describe('QueuesPanel — exibição e cópia de ID', () => {
  beforeEach(() => {
    vi.mocked(adminService.getQueues).mockResolvedValue(sampleQueues)
  })

  it('exibe o ID no rodapé do card da fila e copia com 1 clique', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<QueuesPanel />)
    expect(await screen.findByText('queue-uuid-001')).toBeInTheDocument()

    const copyBtn = screen.getByTitle('Copiar ID: queue-uuid-001')
    await act(async () => {
      fireEvent.click(copyBtn)
    })

    expect(writeText).toHaveBeenCalledWith('queue-uuid-001')
  })

  it('exibe o ID no modal de edição da fila', async () => {
    render(<QueuesPanel />)
    expect(await screen.findByText('Suporte N1')).toBeInTheDocument()

    const editIcon = document.querySelector('.lucide-square-pen')
    const editBtn = editIcon?.closest('button')
    expect(editBtn).toBeTruthy()
    if (editBtn) {
      fireEvent.click(editBtn)
      expect(await screen.findByText('Editar fila')).toBeInTheDocument()
      expect(screen.getByText('ID da fila')).toBeInTheDocument()
      expect(screen.getAllByText('queue-uuid-001').length).toBeGreaterThanOrEqual(1)
    }
  })
})
