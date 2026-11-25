import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SurveyDashboardPanel } from './SurveyDashboardPanel'
import { surveyService } from '@/services/surveyService'

vi.mock('@/services/surveyService', () => ({
  surveyService: { getDashboardStats: vi.fn(), resendSurveyEmail: vi.fn() },
}))
vi.mock('@/services/adminService', () => ({
  adminService: { getOrganizations: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/services/ticketService', () => ({ ticketService: { getTicket: vi.fn() } }))
vi.mock('@/hooks/useQueueName', () => ({ useQueueName: () => (q: string) => q }))

const XSS = '<img src=x onerror="window.__pwned=1">'

const stats = (item: Record<string, unknown>, display: string) => ({
  monthlyTrend: [],
  sent: 1,
  responses: 1,
  responseRate: 100,
  questions: [{ questionId: 'q1', enunciado: 'Como foi?', tipo: 'texto_livre', answered: 1, distribution: [], comments: [] }],
  responsesList: [{
    ticketId: 'T-1', ticketTitle: 'Impressora', clientName: 'Maria', companyName: 'ACME', date: '2026-11-04T12:00:00Z',
    answers: [{ questionId: 'q1', enunciado: 'Como foi?', display }],
    ...item,
  }],
  unansweredList: [],
})

async function exportPdf(data: unknown) {
  vi.mocked(surveyService.getDashboardStats).mockResolvedValue(data as never)
  const write = vi.fn()
  vi.stubGlobal('open', vi.fn(() => ({ document: { write, close: vi.fn() } })))
  render(<SurveyDashboardPanel />)
  fireEvent.click(await screen.findByText('Gerar PDF'))
  return new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html')
}

async function exportCsv(data: unknown) {
  vi.mocked(surveyService.getDashboardStats).mockResolvedValue(data as never)
  let csv = ''
  vi.stubGlobal('Blob', class { constructor(parts: string[]) { csv = parts.join('') } })
  render(<SurveyDashboardPanel />)
  fireEvent.click(await screen.findByText('Exportar Excel (CSV)'))
  return csv
}

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:x')
})
afterEach(() => vi.unstubAllGlobals())

describe('Pesquisa › Gerar PDF', () => {
  it('resposta, título, cliente e empresa entram como texto, nunca como marcação', async () => {
    const doc = await exportPdf(stats({ ticketTitle: XSS, clientName: XSS, companyName: XSS }, XSS))
    expect(doc.querySelector('img')).toBeNull()
    const cells = [...doc.querySelectorAll('tbody td')].map(td => td.textContent)
    expect(cells.filter(c => c === XSS)).toHaveLength(4)
  })

  it('fechar a célula no texto não abre script no relatório', async () => {
    const doc = await exportPdf(stats({}, '</td><script>window.__pwned=1</script>'))
    expect(doc.querySelectorAll('script')).toHaveLength(1) // só o window.print do próprio relatório
    expect(doc.querySelector('script')?.textContent).toContain('window.print')
  })

  it('enunciado da pergunta também é escapado', async () => {
    const data = stats({}, 'ok')
    data.questions[0].enunciado = XSS
    const doc = await exportPdf(data)
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelectorAll('thead th')[5].textContent).toBe(XSS)
  })

  it('texto comum sai igual, com acentos e sem entidades visíveis', async () => {
    const doc = await exportPdf(stats({ ticketTitle: 'Configuração & impressão', clientName: "Joana D'Arc", companyName: 'Ação Ltda' }, 'Ótimo atendimento, nota "10"'))
    const cells = [...doc.querySelectorAll('tbody td')].map(td => td.textContent)
    expect(cells).toContain('Configuração & impressão')
    expect(cells).toContain("Joana D'Arc")
    expect(cells).toContain('Ação Ltda')
    expect(cells).toContain('Ótimo atendimento, nota "10"')
  })
})

describe('Pesquisa › Exportar Excel', () => {
  it('neutraliza fórmula em resposta, título, cliente, empresa e enunciado', async () => {
    const data = stats({ ticketTitle: '=1+1', clientName: '@cmd', companyName: '+2+2' }, '=HYPERLINK("http://x","y")')
    data.questions[0].enunciado = '-1+1'
    const csv = await exportCsv(data)
    expect(csv).toContain(`"'=1+1"`)
    expect(csv).toContain(`"'@cmd"`)
    expect(csv).toContain(`"'+2+2"`)
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csv).toContain(`"'-1+1"`)
  })

  it('texto comum e nota negativa vinda como texto ficam como estão', async () => {
    const csv = await exportCsv(stats({}, '-5'))
    expect(csv).toContain('"Impressora";"Maria";"ACME"')
    expect(csv).toContain('"-5"')
    expect(csv).not.toContain(`'`)
  })
})
