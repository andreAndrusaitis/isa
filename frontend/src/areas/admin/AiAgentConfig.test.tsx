import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AiAgentConfig } from './AiAgentConfig'
import { aiService, type AiAgentStatus } from '@/services/aiService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/aiService', () => ({ aiService: { setAgentConfig: vi.fn(), listResolutionCards: vi.fn() } }))
vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('./IntakeChecklistPanel', () => ({ IntakeChecklistPanel: ({ embedded }: { embedded?: boolean }) => <div>checklist {embedded ? 'embutido' : 'página'}</div> }))
vi.mock('./ResolutionBasePanel', () => ({ ResolutionBasePanel: () => <div>base de resoluções</div> }))

const agent = (over: Partial<AiAgentStatus> = {}): AiAgentStatus => ({
  key: 'intake', name: 'Completude', description: '', mode: 'apply', active: true, runs_24h: 0, runs_7d: 0, errors_24h: 0, last_run_at: null,
  settings: [
    { key: 'rigor', label: 'Rigor', kind: 'rigor', options: [{ value: 'conservative', label: 'Conservador' }, { value: 'balanced', label: 'Equilibrado' }, { value: 'bold', label: 'Ousado' }] },
    { key: 'maxAsks', label: 'Máximo de perguntas', kind: 'int', min: 1, max: 3 },
    { key: 'personalize', label: 'Personalizar as perguntas', kind: 'bool', help: 'Reescreve a pergunta.' },
  ],
  config: { rigor: 'balanced', maxAsks: 3, personalize: true },
  ...over,
})

describe('AiAgentConfig', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('fechado por padrão; abre a janela com os campos declarados e o checklist embutido da Completude', () => {
    render(<AiAgentConfig agent={agent()} />)
    expect(screen.queryByLabelText('Rigor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Configurações e checklist de abertura/ }))
    expect(screen.getByText('Configurações — Completude')).toBeInTheDocument()
    expect(screen.getByLabelText('Rigor')).toHaveValue('balanced')
    expect(screen.getByLabelText('Máximo de perguntas')).toHaveValue('3')
    expect(screen.getByText('Reescreve a pergunta.')).toBeInTheDocument()
    expect(screen.getByText('checklist embutido')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar configurações' })).toBeDisabled()
  })

  it('salva só o que mudou e avisa', async () => {
    vi.mocked(aiService.setAgentConfig).mockResolvedValue({ rigor: 'conservative', maxAsks: 1, personalize: true })
    render(<AiAgentConfig agent={agent()} />)
    fireEvent.click(screen.getByRole('button', { name: /Configurações/ }))
    fireEvent.change(screen.getByLabelText('Rigor'), { target: { value: 'conservative' } })
    fireEvent.change(screen.getByLabelText('Máximo de perguntas'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configurações' }))
    await waitFor(() => expect(aiService.setAgentConfig).toHaveBeenCalledWith('intake', { rigor: 'conservative', maxAsks: 1 }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Salvar configurações' })).toBeDisabled()
  })

  it('erro ao salvar mantém a alteração e avisa', async () => {
    vi.mocked(aiService.setAgentConfig).mockRejectedValue(new Error('x'))
    render(<AiAgentConfig agent={agent()} />)
    fireEvent.click(screen.getByRole('button', { name: /Configurações/ }))
    fireEvent.change(screen.getByLabelText('Rigor'), { target: { value: 'bold' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configurações' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByLabelText('Rigor')).toHaveValue('bold')
  })

  it('campos múltiplos (triagem) e base de resoluções na Orientação', () => {
    const { rerender } = render(<AiAgentConfig agent={agent({
      key: 'triage', settings: [{ key: 'applyFields', label: 'Campos que pode gravar', kind: 'multi', options: [{ value: 'type', label: 'Tipo' }, { value: 'priority', label: 'Prioridade' }] }],
      config: { applyFields: ['priority'] },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Configurações/ }))
    expect(screen.getByRole('checkbox', { name: 'Prioridade' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Tipo' })).not.toBeChecked()
    rerender(<AiAgentConfig agent={agent({ key: 'guidance', settings: [], config: {} })} />)
    expect(screen.getByText('base de resoluções')).toBeInTheDocument()
  })
})
