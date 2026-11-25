import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserPicker } from './UserPicker'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({ adminService: { getUsers: vi.fn() } }))

const users = [
  { id: 'u1', name: 'Ana Souza' },
  { id: 'u2', name: 'Bruno Lima', email: 'agente@isa.local' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminService.getUsers).mockResolvedValue(users as any)
})

describe('UserPicker', () => {
  it('lista as pessoas ao focar no campo', async () => {
    render(<UserPicker onSelect={() => {}} />)
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    expect(await screen.findByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
  })

  it('filtra pelo nome digitado', async () => {
    render(<UserPicker onSelect={() => {}} />)
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    await screen.findByText('Ana Souza')

    fireEvent.change(screen.getByPlaceholderText(/buscar por nome/i), { target: { value: 'bru' } })

    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument()
  })

  it('exclui os ids passados em excludeIds', async () => {
    render(<UserPicker onSelect={() => {}} excludeIds={['u1']} />)
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument()
  })

  it('chama onSelect e fecha a lista ao escolher uma pessoa', async () => {
    const onSelect = vi.fn()
    render(<UserPicker onSelect={onSelect} />)
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    fireEvent.click(await screen.findByText('Ana Souza'))

    expect(onSelect).toHaveBeenCalledWith(users[0])
    await waitFor(() => expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument())
  })
  it('acha pelo e-mail e busca a lista uma vez só', async () => {
    render(<UserPicker onSelect={() => {}} />)
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    await screen.findByText('Ana Souza')

    fireEvent.change(screen.getByPlaceholderText(/buscar por nome/i), { target: { value: 'agente' } })

    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument()
    expect(adminService.getUsers).toHaveBeenCalledTimes(1)
  })
})
