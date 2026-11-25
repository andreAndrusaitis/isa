import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TriagePanel } from './TriagePanel'
import { aiService } from '@/services/aiService'

vi.mock('@/services/aiService', () => ({ aiService: { getTicketTriage: vi.fn() } }))

const field = (key: string, chosen: string, label: string, extra: object = {}) =>
  ({ key, label: key, chosen, chosen_label: label, confidence: 0.9, would_apply: true, evidence: null, evidence_source: null, evidence_valid: true, ...extra })
const change = (f: string, to: string, to_label: string, extra: object = {}) =>
  ({ kind: 'proposed', field: f, label: f, from: null, from_label: null, to, to_label, confidence: 0.9, rule: null, reason: null, ...extra })
const triage = {
  id: 'r1', created_at: '2026-10-07T12:30:00.000Z', mode: 'shadow', model: 'gpt-4.1-mini', prompt_version: 'v2', status: 'ok', error: null,
  justification: 'Usuário relata queda de rede.', low_information: false, apply_error: null,
  fields: [
    field('type', 'incident', 'Incidente', { evidence: 'wifi caiu', evidence_source: 'anexo', confidence: 0.55, would_apply: false }),
    field('category', 'c1', 'Rede', {}),
    field('subcategory', 's1', 'Wi-Fi'),
  ],
  priority: { value: 'high', confidence: 0.8, would_apply: true },
  changes: [change('category', 'c1', 'Rede'), change('subcategory', 's1', 'Wi-Fi'), change('priority', 'high', 'Alta')],
  feedback: [{ field: 'priority', ai_value: 'high', accepted: false, ai_label: 'Alta', from_value: 'high', to_value: 'low', from_label: null, to_label: null, user: { id: 'u1', name: 'Ana' }, created_at: '2026-10-07T13:00:00.000Z' }],
}

describe('TriagePanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('não renderiza nada sem triagem', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(null)
    const { container } = render(<TriagePanel ticketId="t1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('resume recolhido e detalha ao expandir', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage as never)
    render(<TriagePanel ticketId="t1" />)
    const toggle = await screen.findByRole('button', { name: /Triagem IA/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('corrigida')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Usuário relata queda de rede.')).toBeInTheDocument()
    expect(screen.getByText(/wifi caiu.*\(no anexo\)/)).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Confiança Tipo' })).toHaveAttribute('aria-valuenow', '55')
    expect(screen.getByText('Revisar')).toBeInTheDocument()
    expect(screen.getByText(/Corrigido por Ana em .*Alta → Baixa/)).toBeInTheDocument()
    expect(screen.queryByText('Aplicar sugestão')).not.toBeInTheDocument()
  })

  it('Aplicar sugestão chama onApply com categoria+subcategoria e nota', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage as never)
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(<TriagePanel ticketId="t1" canApply onApply={onApply} />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    const buttons = screen.getAllByRole('button', { name: 'Aplicar sugestão' })
    expect(buttons).toHaveLength(2) // categoria(+sub) e prioridade
    fireEvent.click(buttons[0])
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ categoryId: 'c1', subcategoryId: 's1' }, 'Categoria alterada para "Rede > Wi-Fi". (sugestão da Triagem IA)'))
    await waitFor(() => expect(aiService.getTicketTriage).toHaveBeenCalledTimes(2))
  })

  it('mostra o erro inline quando onApply lança', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage as never)
    const onApply = vi.fn().mockRejectedValue(new Error('NOT_TICKET_OWNER'))
    render(<TriagePanel ticketId="t1" canApply onApply={onApply} />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Aplicar sugestão' })[1])
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    // o erro aparece em toast (addInternalNote); o painel segue usável
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Aplicar sugestão' })[1]).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('o botão some quando o valor atual já é o sugerido e a nota usa o valor atual', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(triage as never)
    const onApply = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<TriagePanel ticketId="t1" canApply current={{ priority: 'low', category: 'c1', subcategory: 's1' }} onApply={onApply} />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    const buttons = screen.getAllByRole('button', { name: 'Aplicar sugestão' })
    expect(buttons).toHaveLength(1) // categoria+sub já aplicadas; só prioridade
    fireEvent.click(buttons[0])
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ priority: 'high' }, 'Prioridade alterada de "Baixa" para "Alta". (sugestão da Triagem IA)'))
    rerender(<TriagePanel ticketId="t1" canApply current={{ priority: 'high', category: 'c1', subcategory: 's1' }} onApply={onApply} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aplicar sugestão' })).not.toBeInTheDocument())
  })

  it('aceite não é correção', async () => {
    const accepted = { ...triage, feedback: [{ ...triage.feedback[0], to_value: 'high', accepted: true }] }
    vi.mocked(aiService.getTicketTriage).mockResolvedValue(accepted as never)
    render(<TriagePanel ticketId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    expect(screen.queryByText('corrigida')).not.toBeInTheDocument()
    expect(screen.getByText('aceita')).toBeInTheDocument()
    expect(screen.getByText(/Sugestão aceita por Ana em/)).toBeInTheDocument()
  })

  it('triagem com erro e texto curto demais', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue({ ...triage, status: 'error', error: 'timeout', changes: [] } as never)
    const { unmount } = render(<TriagePanel ticketId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    expect(screen.getByText('Triagem IA não executada: timeout')).toBeInTheDocument()
    unmount()
    vi.mocked(aiService.getTicketTriage).mockResolvedValue({ ...triage, low_information: true, changes: [] } as never)
    render(<TriagePanel ticketId="t2" />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    expect(screen.getByText('Texto curto demais, nada aplicado.')).toBeInTheDocument()
  })

  it('sugestão que uma regra bloqueia não tem botão: mostra o motivo', async () => {
    const reason = 'a regra "R4 piso VIP" (chamado atualizado) definiria Média'
    vi.mocked(aiService.getTicketTriage).mockResolvedValue({ ...triage, changes: [change('priority', 'low', 'Baixa', { reason })] } as never)
    render(<TriagePanel ticketId="t1" canApply onApply={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aplicar sugestão' })).not.toBeInTheDocument()
  })

  it('mostra a leitura do portão quando confiante', async () => {
    vi.mocked(aiService.getTicketTriage).mockResolvedValue({ ...triage, changes: [], gate: { value: 'test', confidence: 0.97, would_apply: true } } as never)
    render(<TriagePanel ticketId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Triagem IA/ }))
    expect(screen.getByText('Parece teste, nada aplicado (97%).')).toBeInTheDocument()
  })
})
