import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntakeChecklistPanel } from './IntakeChecklistPanel'
import { aiService } from '@/services/aiService'
import { adminService } from '@/services/adminService'

vi.mock('@/services/aiService', () => ({
  aiService: { getIntakeChecklist: vi.fn(), createIntakeItem: vi.fn(), updateIntakeItem: vi.fn() },
}))
vi.mock('@/services/adminService', () => ({ adminService: { getCategories: vi.fn() } }))

const item = (extra: object = {}) => ({
  id: 'i1', type: 'incident', subcategory_id: null, subcategory: null, key: 'o_que_acontece', label: 'O que acontece',
  criterion: 'O chamado descreve o problema.', question: 'O que exatamente acontece?', kind: 'text', required: true, sort: 10, active: true, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(aiService.getIntakeChecklist).mockResolvedValue([item(), item({ id: 'i2', type: 'request', key: 'para_quem', label: 'Para quem', question: 'Para qual usuário?' })] as any)
  vi.mocked(adminService.getCategories).mockResolvedValue([{ id: 'c1', name: 'Cloud', subcategories: [{ id: 's1', name: 'Teams' }] }] as any)
})

const fillAndOpenNew = async () => {
  await screen.findByText('O que acontece')
  fireEvent.click(screen.getByRole('button', { name: /novo item/i }))
  fireEvent.change(screen.getByLabelText('Chave'), { target: { value: 'novo' } })
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novo' } })
  fireEvent.change(screen.getByLabelText('Critério (o que a IA verifica)'), { target: { value: 'O chamado informa o novo item.' } })
  fireEvent.change(screen.getByLabelText('Pergunta ao solicitante'), { target: { value: 'Qual o novo?' } })
}

describe('IntakeChecklistPanel', () => {
  it('agrupa os itens por tipo e mostra a pergunta enviada ao solicitante', async () => {
    render(<IntakeChecklistPanel />)
    expect(await screen.findByText('O que acontece')).toBeInTheDocument()
    expect(screen.getByText('Incidente')).toBeInTheDocument()
    expect(screen.getByText('Requisição')).toBeInTheDocument()
    expect(screen.getByText('O que exatamente acontece?')).toBeInTheDocument()
  })

  it('cria item novo pelo formulário', async () => {
    vi.mocked(aiService.createIntakeItem).mockResolvedValue(item({ id: 'i3', key: 'novo', label: 'Novo' }) as any)
    render(<IntakeChecklistPanel />)
    await fillAndOpenNew()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(aiService.createIntakeItem).toHaveBeenCalledWith(expect.objectContaining({
      type: 'incident', key: 'novo', label: 'Novo', question: 'Qual o novo?', subcategory_id: null, kind: 'text', required: true,
    })))
  })

  it('desativa um item pelo toggle', async () => {
    vi.mocked(aiService.updateIntakeItem).mockResolvedValue(item({ active: false }) as any)
    render(<IntakeChecklistPanel />)
    await screen.findByText('O que acontece')
    fireEvent.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(aiService.updateIntakeItem).toHaveBeenCalledWith('i1', { active: false }))
  })

  it('mostra ao admin o erro da API ao salvar', async () => {
    vi.mocked(aiService.createIntakeItem).mockRejectedValue({ response: { data: { error: 'Já existe um item com essa chave' } } })
    render(<IntakeChecklistPanel />)
    await fillAndOpenNew()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Já existe um item com essa chave')).toBeInTheDocument()
  })

  it('edita item existente pelo id, com a chave bloqueada', async () => {
    vi.mocked(aiService.updateIntakeItem).mockResolvedValue(item({ label: 'Mudou' }) as any)
    render(<IntakeChecklistPanel />)
    await screen.findByText('O que acontece')
    fireEvent.click(screen.getByRole('button', { name: 'Editar O que acontece' }))
    expect(screen.getByLabelText('Chave')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Mudou' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(aiService.updateIntakeItem).toHaveBeenCalledWith('i1', expect.objectContaining({ key: 'o_que_acontece', label: 'Mudou' })))
    expect(aiService.createIntakeItem).not.toHaveBeenCalled()
  })
})
