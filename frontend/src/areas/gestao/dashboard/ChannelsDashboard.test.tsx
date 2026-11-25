import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChannelsDashboard, channelsCsv, formatOpening, type ChannelMetrics } from './ChannelsDashboard'
import { dashboardService } from '@/services/dashboardService'

vi.mock('@/services/dashboardService', () => ({ dashboardService: { getChannels: vi.fn() } }))

const rows: ChannelMetrics[] = [
  { channel: 'portal', tickets: 40, avgOpeningSeconds: 95, resolved: 30, firstContactRate: 60, avgFirstResponseHours: 1.5, responded: 35, csat: 87.5, csatResponses: 12 },
  { channel: 'email', tickets: 300, avgOpeningSeconds: null, resolved: 250, firstContactRate: 40, avgFirstResponseHours: 3.2, responded: 280, csat: null, csatResponses: 0 },
  { channel: 'unknown', tickets: 5, avgOpeningSeconds: null, resolved: 0, firstContactRate: null, avgFirstResponseHours: null, responded: 0, csat: null, csatResponses: 0 },
]

beforeEach(() => { vi.mocked(dashboardService.getChannels).mockReset() })

describe('ChannelsDashboard', () => {
  it('mostra as 4 métricas por canal, com "Não identificado" para chamados antigos', async () => {
    vi.mocked(dashboardService.getChannels).mockResolvedValue({ channels: rows })
    render(<ChannelsDashboard />)

    expect(await screen.findByText('Portal')).toBeTruthy()
    expect(screen.getByText('E-mail')).toBeTruthy()
    expect(screen.getByText('Não identificado')).toBeTruthy()
    expect(screen.getByText('1,6 min')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
    expect(screen.getByText('1,5 h úteis')).toBeTruthy()
    expect(screen.getByText('87,5')).toBeTruthy()
  })

  it('pede o período escolhido', async () => {
    vi.mocked(dashboardService.getChannels).mockResolvedValue({ channels: [] })
    render(<ChannelsDashboard />)
    expect(await screen.findByText('Nenhum chamado aberto no período.')).toBeTruthy()

    const before = Date.now()
    fireEvent.click(screen.getByRole('button', { name: '90 dias' }))
    await waitFor(() => expect(dashboardService.getChannels).toHaveBeenCalledTimes(2))
    const from = new Date(vi.mocked(dashboardService.getChannels).mock.calls[1][0]!.from!).getTime()
    expect(Math.round((before - from) / 86_400_000)).toBe(90)
  })

  it('erro vira mensagem', async () => {
    vi.mocked(dashboardService.getChannels).mockImplementation(() => Promise.reject(new Error('500')))
    render(<ChannelsDashboard />)
    expect(await screen.findByText(/Não foi possível carregar as métricas por canal/)).toBeTruthy()
  })
})

describe('exportação', () => {
  it('CSV com ";" e vírgula decimal, só números agregados', () => {
    const csv = channelsCsv(rows).split('\n')
    expect(csv[0]).toBe('Canal;Chamados;Tempo médio de abertura (s);Resolvidos;Resolvidos no 1º contato (%);1ª resposta média (h úteis);Respondidos;CSAT (0-100);Respostas da pesquisa')
    expect(csv[1]).toBe('Portal;40;95;30;60;1,5;35;87,5;12')
    expect(csv[3]).toBe('Não identificado;5;;0;;;0;;0')
  })

  it('tempo de abertura em segundos ou minutos', () => {
    expect(formatOpening(null)).toBe('—')
    expect(formatOpening(42)).toBe('42 s')
    expect(formatOpening(150)).toBe('2,5 min')
  })
})
