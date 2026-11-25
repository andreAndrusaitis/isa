import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { AiEnginePanel } from './AiEnginePanel'
import { aiService } from '@/services/aiService'
import { useAuthStore } from '@/store/auth'

const socketHandlers: Record<string, () => void> = {}
vi.mock('@/services/socketService', () => ({
  connectSocket: () => ({ on: (e: string, fn: () => void) => { socketHandlers[e] = fn }, off: (e: string) => { delete socketHandlers[e] } }),
}))
vi.mock('@/services/aiService', () => ({
  aiService: { getStatus: vi.fn(), getRuns: vi.fn(), getMetrics: vi.fn(), getChanges: vi.fn(), setAgentMode: vi.fn(), getRecentRuns: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
    getFeedback: vi.fn().mockResolvedValue({ data: [], next_cursor: null }), getInsights: vi.fn().mockResolvedValue({ empty: true }) },
}))

const status = {
  configured: true, model: 'gpt-4.1-mini',
  agents: [{ key: 'triage', name: 'Triagem de chamados', description: 'Sugere campos', mode: 'shadow', active: true, runs_24h: 3, runs_7d: 10, errors_24h: 1, last_run_at: '2026-10-06T10:00:00.000Z' }],
}
const metrics = {
  agent: null, days: 7, runs: 10, errors: 1, error_rate: 0.1, latency_p50_ms: 1200, latency_p95_ms: 3400,
  input_tokens: 20000, output_tokens: 800, cost_usd: 0.0102,
  fields: [{ key: 'type', total: 10, would_apply: 7, would_apply_rate: 0.7, avg_confidence: 0.88 }],
  changes: {
    by_field: [{ field: 'priority', label: 'Prioridade', applied: 5, proposed: 2 }, { field: 'type', label: 'Tipo', applied: 4, proposed: 0 }],
    top_transitions: [{ field: 'type', label: 'Tipo', from_label: 'Incidente', to_label: 'Requisição', applied: 4, proposed: 0, total: 4 }],
  },
}
const ticket = { id: 't-1', display_number: 'INC-0042', title: 'Wi-Fi caiu' }
const run = (id: string, extra: object = {}) => ({
  id, agent: 'triage', ticket_id: 't-1', ticket,
  mode: 'shadow', model: 'gpt-4.1-mini', prompt_version: 'v1', status: 'ok', error: null, latency_ms: 900,
  input_tokens: 1000, output_tokens: 50, created_at: '2026-10-06T10:00:00.000Z', changes: [], apply_error: null,
  result: {
    questions: [
      { key: 'type', chosenLabel: 'Incidente', confidence: 0.94, wouldApply: true },
      { key: 'category', chosenLabel: 'Rede', confidence: 0.55, wouldApply: false },
    ],
    priority: { value: 'high', confidence: 0.82, wouldApply: true },
    justification: 'Usuário relata queda do Wi-Fi.',
  },
  ...extra,
})
const change = (extra: object = {}) => ({
  run_id: 'r1', created_at: '2026-10-06T10:00:00.000Z', agent: 'triage', mode: 'apply', kind: 'applied',
  field: 'priority', label: 'Prioridade', from: 'medium', from_label: 'Média', to: 'high', to_label: 'Alta', confidence: 0.94,
  ticket: { id: 't-9', display_number: 'INC-0099', title: 'Impressora parada' },
  ...extra,
})

describe('AiEnginePanel', () => {
  beforeEach(() => {
    vi.mocked(aiService.getStatus).mockResolvedValue(status)
    vi.mocked(aiService.getMetrics).mockResolvedValue(metrics as any)
    vi.mocked(aiService.getRuns).mockResolvedValue({ data: [run('r1')], next_cursor: 'r1' } as any)
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [change()], next_cursor: null } as any)
  })

  it('mostra o estado do motor, a tabela de agentes, os números e a qualidade', async () => {
    render(<AiEnginePanel />)
    expect(await screen.findByText('Motor online')).toBeInTheDocument()
    expect(screen.getAllByText('Triagem de chamados').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sombra').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('table', { name: 'Agentes' })).getByText('3 em 24h')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument() // taxa de erro
    expect(screen.getByText('1,2 s')).toBeInTheDocument() // p50
    expect(screen.getByText('70%')).toBeInTheDocument() // % aplicaria em Tipo
    expect(screen.getByText('9')).toBeInTheDocument() // alterações aplicadas (5 + 4)
  })

  it('alterações agrupadas por chamado: campo, era → virou, confiança e tipo; abre o chamado', async () => {
    const onOpen = vi.fn()
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [change(), change({ run_id: 'r2', field: 'type', label: 'Tipo', from_label: 'Incidente', to_label: 'Requisição', kind: 'proposed' })], next_cursor: null } as any)
    render(<AiEnginePanel onOpenTicket={onOpen} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Alterações' }))
    const list = await screen.findByRole('list', { name: 'Alterações em INC-0099' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2) // um bloco por chamado, não por ação
    const row = within(list).getAllByRole('listitem')[0]
    expect(within(row).getByText('Prioridade')).toBeInTheDocument()
    expect(within(row).getByText('Média')).toBeInTheDocument()
    expect(within(row).getByText('Alta')).toBeInTheDocument()
    expect(within(row).getByText('94%')).toBeInTheDocument()
    expect(within(row).getByText('Aplicado')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado INC-0099' }))
    expect(onOpen).toHaveBeenCalledWith('t-9')
    // resumo: por campo e transição mais comum
    expect(screen.getByRole('group', { name: 'Alterações por campo' })).toHaveTextContent('Prioridade5 aplicadas2 sugeridas')
    expect(screen.getByText('×4')).toBeInTheDocument()
  })

  it('filtros das alterações consultam por campo e tipo; carregar mais usa o cursor', async () => {
    vi.mocked(aiService.getRuns).mockResolvedValue({ data: [], next_cursor: null } as any)
    vi.mocked(aiService.getChanges)
      .mockResolvedValueOnce({ data: [change()], next_cursor: 'r1~applied~2' } as any)
      .mockResolvedValueOnce({ data: [change({ run_id: 'r0', field: 'type', label: 'Tipo', from_label: 'Incidente (INC-1)', to_label: 'Requisição (REQ-1)' })], next_cursor: null } as any)
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Alterações' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('Requisição (REQ-1)')).toBeInTheDocument()
    expect(aiService.getChanges).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'r1~applied~2' }))

    fireEvent.change(screen.getByLabelText('Campo'), { target: { value: 'type' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'proposed' } })
    await waitFor(() => expect(aiService.getChanges).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'type', kind: 'proposed', days: 7 })))
  })

  it('ver logs de um agente filtra por ele e abre os logs; de novo, limpa', async () => {
    render(<AiEnginePanel />)
    const btn = await screen.findByRole('button', { name: 'Ver logs de Triagem de chamados' })
    fireEvent.click(btn)
    await waitFor(() => expect(aiService.getRuns).toHaveBeenLastCalledWith(expect.objectContaining({ agent: 'triage' })))
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(btn)
    await waitFor(() => expect(aiService.getRuns).toHaveBeenLastCalledWith(expect.objectContaining({ agent: undefined })))
  })

  it('alterações vazias mostram aviso', async () => {
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [], next_cursor: null } as any)
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Alterações' }))
    expect(await screen.findByText('Nenhuma alteração registrada no período.')).toBeInTheDocument()
  })

  it('logs agrupam as execuções por chamado, abrem o chamado e o (i) mostra o detalhe', async () => {
    const onOpen = vi.fn()
    vi.mocked(aiService.getRuns).mockResolvedValue({
      data: [
        run('r1', { changes: [{ kind: 'proposed', field: 'priority', label: 'Prioridade', from: 'medium', from_label: 'Média', to: 'high', to_label: 'Alta', confidence: 0.82 }] }),
        run('r0', { agent: 'intake', status: 'error', error: 'LLM 503', result: null }),
      ],
      next_cursor: null,
    } as any)
    render(<AiEnginePanel onOpenTicket={onOpen} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Logs' }))
    const runsList = await screen.findByRole('list', { name: 'Execuções em INC-0042' })
    expect(within(runsList).getAllByRole('listitem')).toHaveLength(2)
    expect(within(runsList).getByText('LLM 503')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Alterações em INC-0042' })).toHaveTextContent('Prioridade:Média → Alta(sugerido)')
    expect(screen.getAllByRole('button', { name: 'Abrir chamado INC-0042' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado INC-0042' }))
    expect(onOpen).toHaveBeenCalledWith('t-1')

    fireEvent.click(screen.getByRole('button', { name: 'Mais informações de INC-0042' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('meter', { name: 'Confiança em Categoria' })).toHaveAttribute('aria-valuenow', '55')
    expect(within(dialog).getByText('Aplicaria 2/3')).toBeInTheDocument()
    expect(within(dialog).getByText('Revisão humana: 1')).toBeInTheDocument()
    expect(within(dialog).getByText('Usuário relata queda do Wi-Fi.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir chamado' }))
    expect(onOpen).toHaveBeenLastCalledWith('t-1')
  })

  it('logs carregam mais com o cursor e mostram erro sem chamado', async () => {
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [], next_cursor: null } as any)
    vi.mocked(aiService.getRuns)
      .mockResolvedValueOnce({ data: [run('r1')], next_cursor: 'r1' } as any)
      .mockResolvedValueOnce({ data: [run('r2', { status: 'error', error: 'LLM 503', result: null, ticket: null })], next_cursor: null } as any)
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Logs' }))
    expect(await screen.findByText('Nenhuma alteração no chamado · aplicaria 2/3')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('LLM 503')).toBeInTheDocument()
    expect(screen.getByText('Sem chamado')).toBeInTheDocument()
    expect(aiService.getRuns).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'r1' }))
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })
})

describe('AiEnginePanel — ligar e desligar agentes', () => {
  beforeEach(() => {
    vi.mocked(aiService.getStatus).mockResolvedValue(status)
    vi.mocked(aiService.getMetrics).mockResolvedValue(metrics as any)
    vi.mocked(aiService.getRuns).mockResolvedValue({ data: [], next_cursor: null } as any)
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [], next_cursor: null } as any)
    vi.mocked(aiService.setAgentMode).mockReset().mockResolvedValue(undefined)
  })

  it('mostra o modo atual de cada agente e desliga com um clique', async () => {
    render(<AiEnginePanel />)
    const group = await screen.findByRole('group', { name: 'Modo de Triagem de chamados' })
    expect(within(group).getByRole('button', { name: 'Sombra' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Desligado' }))
    await waitFor(() => expect(aiService.setAgentMode).toHaveBeenCalledWith('triage', 'off'))
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Desligado' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('pede confirmação antes de pôr um agente para aplicar', async () => {
    render(<AiEnginePanel />)
    const group = await screen.findByRole('group', { name: 'Modo de Triagem de chamados' })
    fireEvent.click(within(group).getByRole('button', { name: 'Aplicar' }))
    expect(aiService.setAgentMode).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Ligar em modo Aplicar' }))
    await waitFor(() => expect(aiService.setAgentMode).toHaveBeenCalledWith('triage', 'apply'))
  })

  it('mantém o modo anterior e avisa quando a troca falha', async () => {
    vi.mocked(aiService.setAgentMode).mockRejectedValue(new Error('falhou'))
    render(<AiEnginePanel />)
    const group = await screen.findByRole('group', { name: 'Modo de Triagem de chamados' })
    fireEvent.click(within(group).getByRole('button', { name: 'Desligado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível alterar o modo')
    expect(within(group).getByRole('button', { name: 'Sombra' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('AiEnginePanel — ao vivo', () => {
  beforeEach(() => {
    vi.mocked(aiService.getStatus).mockResolvedValue(status)
    vi.mocked(aiService.getMetrics).mockResolvedValue(metrics as any)
    vi.mocked(aiService.getRuns).mockResolvedValue({ data: [run('r1')], next_cursor: null } as any)
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [], next_cursor: null } as any)
    useAuthStore.setState({ accessToken: 'tok' } as any)
  })

  it('execução nova (ai:run) busca as últimas e entra no feed de logs', async () => {
    const fresh = run('r9', { ticket: { id: 't-7', display_number: 'INC-0777', title: 'VPN fora' } })
    vi.mocked(aiService.getRecentRuns).mockResolvedValueOnce({ data: [run('r1')], next_cursor: null } as any)
      .mockResolvedValueOnce({ data: [fresh, run('r1')], next_cursor: null } as any)
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Logs' }))
    await screen.findByRole('list', { name: 'Execuções em INC-0042' })
    await waitFor(() => expect(socketHandlers['ai:run']).toBeTypeOf('function'))
    socketHandlers['ai:run']()
    expect(await screen.findByRole('list', { name: 'Execuções em INC-0777' }, { timeout: 2000 })).toBeInTheDocument()
    expect(aiService.getRecentRuns).toHaveBeenLastCalledWith(20)
  })
})

describe('AiEnginePanel — correções humanas e acurácia', () => {
  beforeEach(() => {
    vi.mocked(aiService.getFeedback).mockClear()
    vi.mocked(aiService.getStatus).mockResolvedValue(status)
    vi.mocked(aiService.getMetrics).mockResolvedValue(metrics as any)
    vi.mocked(aiService.getRuns).mockResolvedValue({ data: [], next_cursor: null } as any)
    vi.mocked(aiService.getChanges).mockResolvedValue({ data: [], next_cursor: null } as any)
  })

  it('aba Correções lista a correção, abre o chamado e filtra por campo', async () => {
    const onOpen = vi.fn()
    vi.mocked(aiService.getFeedback).mockResolvedValue({
      data: [{ id: 'f2', created_at: '2026-10-06T11:00:00.000Z', field: 'type', ai_value: 'incident', accepted: true, ai_label: 'Incidente', from_value: 'request', to_value: 'incident', from_label: null, to_label: null,
        user: { id: 'u2', name: 'Caio Lima' }, ticket, run_id: 'r1' },
      { id: 'f1', created_at: '2026-10-06T10:00:00.000Z', field: 'category', ai_value: 'c1', accepted: false, ai_label: 'Rede', from_value: 'c1', to_value: 'c2', from_label: 'Rede', to_label: 'Acesso',
        user: { id: 'u1', name: 'Ana Souza' }, ticket, run_id: 'r1' }],
      next_cursor: null,
    } as any)
    render(<AiEnginePanel onOpenTicket={onOpen} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Correções' }))
    const list = await screen.findByRole('list', { name: 'Correções humanas' })
    expect(list).toHaveTextContent('Ana Souza corrigiu Categoria no')
    expect(list).toHaveTextContent('Caio Lima aceitou a sugestão de Tipo no')
    expect(list).toHaveTextContent('IA Rede · Rede → Acesso')
    fireEvent.click(within(list).getAllByRole('button', { name: 'Abrir chamado INC-0042' })[0])
    expect(onOpen).toHaveBeenCalledWith('t-1')
    fireEvent.change(screen.getByLabelText('Campo da correção'), { target: { value: 'priority' } })
    await waitFor(() => expect(aiService.getFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'priority', days: 7 })))
  })

  it('aba Correções vazia mostra aviso', async () => {
    vi.mocked(aiService.getFeedback).mockResolvedValue({ data: [], next_cursor: null } as any)
    render(<AiEnginePanel />)
    await screen.findByText('Motor online')
    expect(aiService.getFeedback).not.toHaveBeenCalled() // só com a aba aberta
    fireEvent.click(await screen.findByRole('tab', { name: 'Correções' }))
    expect(await screen.findByText('Nenhuma correção humana no período.')).toBeInTheDocument()
  })

  it('erro do feed aparece dentro da aba Correções', async () => {
    vi.mocked(aiService.getFeedback).mockRejectedValue(new Error('x'))
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Correções' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('correções humanas')
  })

  it('Qualidade mostra a acurácia por campo dos chamados resolvidos', async () => {
    vi.mocked(aiService.getInsights).mockResolvedValue({ empty: false, accuracy: [{ field: 'type', total: 10, correct: 9, rate: 0.9 }] } as any)
    render(<AiEnginePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Qualidade' }))
    expect(await screen.findByText('Acurácia por campo (chamados resolvidos)')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Acurácia por campo' })).toHaveTextContent('90% · 9/10')
  })
})
