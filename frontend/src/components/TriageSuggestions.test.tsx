import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TriageSuggestions } from './TriageSuggestions'
import { aiService } from '@/services/aiService'

vi.mock('@/services/aiService', () => ({ aiService: { getTicketTriage: vi.fn() } }))

const change = (f: string, to: string, to_label: string, extra: object = {}) =>
  ({ kind: 'proposed', field: f, label: f, from: null, from_label: null, to, to_label, confidence: 0.9, rule: null, reason: null, ...extra })
const triage = (changes: object[]) => ({
  id: 'r1', created_at: '2026-10-08T12:00:00.000Z', mode: 'apply', model: 'm', prompt_version: 'triage-v4', status: 'ok', error: null,
  justification: null, low_information: false, apply_error: null, gate: null, fields: [], priority: null, changes, feedback: [],
})

describe('TriageSuggestions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('um botão por sugestão pendente; categoria + subcategoria numa ação só', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage([
      change('category', 'c1', 'Rede'), change('subcategory', 's1', 'Wi-Fi'), change('priority', 'high', 'Alta'),
      change('type', 'request', 'Requisição', { kind: 'applied' }),
    ]) as never)
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(<TriageSuggestions ticketId="t1" current={{ priority: 'low' }} onApply={onApply} />)
    const btn = await screen.findByRole('button', { name: 'Aplicar Categoria Rede › Wi-Fi' })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    fireEvent.click(btn)
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ categoryId: 'c1', subcategoryId: 's1' }, 'Categoria alterada para "Rede > Wi-Fi". (sugestão da Triagem IA)'))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar Prioridade Alta' }))
    await waitFor(() => expect(onApply).toHaveBeenLastCalledWith({ priority: 'high' }, 'Prioridade alterada de "Baixa" para "Alta". (sugestão da Triagem IA)'))
  })

  it('some quando o valor atual já é o sugerido; sugestão bloqueada por regra mostra o motivo sem botão', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage([
      change('category', 'c1', 'Rede'), change('subcategory', 's1', 'Wi-Fi'),
      change('priority', 'high', 'Alta', { reason: 'a regra "VIP" define Média' }),
    ]) as never)
    render(<TriageSuggestions ticketId="t1" current={{ category: 'c1', subcategory: 's1' }} onApply={vi.fn()} />)
    expect(await screen.findByText('a regra "VIP" define Média')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sem sugestão pendente não renderiza nada', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage([change('category', 'c1', 'Rede')]) as never)
    const { container } = render(<TriageSuggestions ticketId="t1" current={{ category: 'c1' }} onApply={vi.fn()} />)
    await waitFor(() => expect(aiService.getTicketTriage).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
