import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { clientForecast, span, untilPhrase } from './clock'
import { forecastShortcuts } from './ForecastModal'
import { ShiftPage, loadNote } from './ShiftPage'
import { clientNote, reportText } from './PortfolioPage'
import { HealthPage, changePhrase } from './HealthPage'
import { ClientHome, splitRequests } from './ClientHome'
import { searchSettings, SETTING_GROUPS } from '@/access/settings'
import { pathForView } from '@/access/routes'
import { suggestCategories, titleFrom } from '@/areas/solicitacoes/suggestCategory'
import { weekDays, dayKey } from '@/pages/projects/MyWeekPage'
import { homesService, type PortfolioClient, type Shift } from '@/services/homesService'
import { dashboardService } from '@/services/dashboardService'
import { ticketService } from '@/services/ticketService'

const now = new Date(2026, 10, 24, 10, 0) // terça
const iso = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
beforeEach(() => { vi.restoreAllMocks() })

describe('previsão que o cliente lê', () => {
  const t = { status: 'open', slaDeadline: iso(24, 16) }
  it('prazo à frente vira frase; nova previsão tem precedência', () => {
    expect(clientForecast(t, now).text).toBe('Previsão: hoje até 16h.')
    expect(clientForecast({ ...t, clientForecastAt: iso(25, 9, 30) }, now)).toMatchObject({ text: 'Nova previsão: amanhã até 9h30.', renewed: true })
  })
  it('passou sem nova previsão: nunca diz vencido', () => {
    for (const x of [{ ...t, slaDeadline: iso(23, 9) }, { ...t, clientForecastAt: iso(23, 9) }]) {
      expect(clientForecast(x, now).text).toBe('Vamos informar uma nova previsão.')
    }
  })
  it('esperando o cliente, esperando terceiro e em projeto', () => {
    expect(clientForecast({ ...t, status: 'pending', pendingReason: 'pending_user' }, now).text).toMatch(/sua resposta/)
    expect(clientForecast({ ...t, status: 'pending', pendingReason: 'pending_vendor' }, now).text).toMatch(/fora da equipe/)
    expect(clientForecast({ ...t, status: 'pending', pendingReason: 'pending_project', project_task: { due_date: '2026-12-01T00:00:00.000Z' } }, now).text).toContain('01/12/2026')
  })
  it('frases de tempo', () => {
    expect(untilPhrase(iso(27, 14), now)).toBe('sexta, 27/11, até 14h')
    expect([span(90_000), span(3 * 3_600_000), span(80 * 3_600_000)]).toEqual(['2 min', '3 h', '3 dias'])
    const s = forecastShortcuts(new Date(2026, 10, 27, 10, 20)) // sexta: pula o fim de semana
    expect(s[0].label).toBe('Hoje até 13h')
    expect(s[1].at.getDay()).toBe(1)
  })
})

describe('Turno', () => {
  const person = (id: string, name: string, active: number, queues = ['q']) => ({ id, name, avatar: null, queues, active, late: 0, soon: 0, tickets: [] })
  const shift: Shift = {
    numbers: { late: 1, lateTop: { name: 'Geleira', count: 1 }, soon: 0, unassigned: 1, unassignedOldest: iso(23, 9), waiting: 0 },
    decisions: [{
      id: 't1', number: 'INC-1', title: 'Sistema parado', priority: 'high', state: 'late', queueId: 'q', queue: 'VIP', org: { id: 'o', name: 'Geleira' },
      owner: { id: 'c', name: 'Clara Veiga', avatar: null }, createdAt: iso(23, 9), deadline: iso(24, 8), needsForecast: true,
      suggestion: { id: 'b', name: 'Bruno Salles', avatar: null, active: 3 },
    }],
    pending: 0, repeated: [{ category: { id: 'vpn', name: 'VPN' }, count: 3, orgs: ['Geleira'] }],
    people: [person('c', 'Clara Veiga', 16), person('b', 'Bruno Salles', 3), person('x', 'Lia Dias', 1, [])],
  }
  it('um clique na sugestão passa o chamado e recarrega', async () => {
    const get = vi.spyOn(homesService, 'getShift').mockResolvedValue(shift)
    const assign = vi.spyOn(dashboardService, 'assignTicket').mockResolvedValue({} as any)
    render(<ShiftPage user={{ role: 'supervisor' }} onOpenTicket={() => {}} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Passar para Bruno · 3 ativos/ }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('t1', 'b'))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })
  it('outra pessoa mostra a carga e trava quem não atende a fila', async () => {
    vi.spyOn(homesService, 'getShift').mockResolvedValue(shift)
    render(<ShiftPage user={{ role: 'supervisor' }} onOpenTicket={() => {}} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Outra pessoa' }))
    const group = screen.getByRole('group', { name: 'Escolher pessoa' })
    expect(within(group).getByRole('button', { name: /Bruno Salles/ })).toBeEnabled()
    expect(within(group).getByRole('button', { name: /Lia Dias/ })).toBeDisabled()
    expect(within(group).queryByRole('button', { name: /Clara/ })).toBeNull()
  })
  it('números levam à lista filtrada; admin não decide', async () => {
    vi.spyOn(homesService, 'getShift').mockResolvedValue(shift)
    const go = vi.fn()
    render(<ShiftPage user={{ role: 'admin' }} onOpenTicket={() => {}} onNavigate={go} />)
    fireEvent.click(await screen.findByRole('button', { name: /Vencidos/ }))
    expect(go).toHaveBeenCalledWith({ view: 'queue', filters: { overdue: true, status: 'open,in_progress' } })
    expect(screen.queryByRole('button', { name: /Passar para/ })).toBeNull()
  })
  it('carga em palavras', () => {
    expect(loadNote(shift.people[0], shift.people)).toMatch(/acima da média/)
    expect(loadNote(person('z', 'Z', 0), shift.people)).toBe('livre')
  })
})

describe('Carteira', () => {
  const c = (x: Partial<PortfolioClient> = {}): PortfolioClient => ({ org: { id: 'o', name: 'Geleira', tier: 'gold' }, active: 10, overdue: 0, paused: 0, rate: 90, previous: 90, done: 9, late: 1, weeks: [], opened: 5, openedBefore: 5, csat: null, ...x })
  it('o que observar, do mais grave ao mais leve', () => {
    expect(clientNote(c({ overdue: 6 }))).toMatchObject({ level: 2 })
    expect(clientNote(c({ rate: 70 }))).toEqual({ text: 'Caiu 20 pontos no período', level: 2 })
    expect(clientNote(c({ overdue: 1 })).level).toBe(1)
    expect(clientNote(c({ opened: 8 })).text).toBe('Volume cresceu 60%')
    expect(clientNote(c())).toEqual({ text: 'Nada a fazer', level: 0 })
  })
  it('relatório do cliente não traz nome de pessoa da equipe e trata período vazio', () => {
    const p = { from: iso(1, 0), to: iso(24, 0), days: 30 }
    expect(reportText(c({ rate: 87, previous: 92 }), p)).toContain('5 pontos abaixo')
    expect(reportText(c({ rate: null }), p)).toContain('Nenhum chamado concluído')
  })
})

describe('Saúde', () => {
  it('busca por nome, palavra parecida e sem acento', () => {
    expect(searchSettings('feriado')[0].view).toBe('admin_business_hours')
    expect(searchSettings('cor do botao')[0].view).toBe('admin_appearance')
    expect(searchSettings('roteamento')[0].view).toBe('admin_routing')
    expect(searchSettings('zzz')).toEqual([])
  })
  it('todo ajuste tem endereço', () => {
    for (const i of SETTING_GROUPS.flatMap(g => g.items)) expect(pathForView(i.view)).toBeTruthy()
  })
  it('mudança em frase', () => {
    expect(changePhrase('UPDATE_SLA_CONFIG', 'Silver')).toBe('alterou plano Silver')
    expect(changePhrase('UPDATE_SYSTEM_SETTING', 'ai_provider')).toBe('alterou configuração Provedor de IA')
  })
  it('pendências com botão para a tela; enter na busca abre a primeira', async () => {
    vi.spyOn(homesService, 'getHealth').mockResolvedValue({
      checks: [{ id: 'ai', label: 'Provedor de IA', detail: 'Sem chave.', state: 'todo', view: 'admin_ai_provider' }, { id: 'plans', label: 'Planos', detail: '4 planos.', state: 'ok', view: 'admin_sla' }],
      signals: { lastEmailAt: null, emailFailures: 0, inboundFailures: 0, loginFailures: 0, rulesOn: 1, orgs: 2 }, changes: [],
    })
    const go = vi.fn()
    render(<HealthPage user={{ name: 'Helena Prado' }} onGo={go} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar' }))
    expect(go).toHaveBeenLastCalledWith('admin_ai_provider')
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'feriado' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(go).toHaveBeenLastCalledWith('admin_business_hours')
  })
})

describe('Início do cliente', () => {
  const t = (x: object) => ({ id: 'a', title: 'VPN cai', status: 'open', displayNumber: 'INC-1', slaDeadline: iso(1, 1), updatedAt: iso(24, 9), createdAt: iso(23, 9), ...x }) as any
  const categories = [{ id: 'rede', name: 'Rede e VPN', subcategories: [{ id: 'vpn', name: 'VPN' }] }, { id: 'acesso', name: 'Acessos e contas', description: 'Senha, login', subcategories: [] }]

  it('separa o que depende da pessoa do que anda', () => {
    const r = splitRequests([t({ id: '1', status: 'pending', pendingReason: 'pending_user' }), t({ id: '2', status: 'resolved', canReopen: true }), t({ id: '3', status: 'resolved', canReopen: false }), t({ id: '4' }), t({ id: '5', status: 'pending', pendingReason: 'pending_vendor' })])
    expect(r.needs.map(x => x.id)).toEqual(['1', '2'])
    expect(r.moving.map(x => x.id)).toEqual(['4', '5'])
  })

  it('pede ajuda com a frase e confirma com um toque', async () => {
    const page = vi.spyOn(ticketService, 'getTicketsPage').mockResolvedValue({ data: [t({ id: '2', status: 'resolved', canReopen: true, resolution_details: 'Troquei a chave.' })], total: 1, page: 1, pageSize: 30 })
    const ok = vi.spyOn(ticketService, 'confirmResolution').mockResolvedValue({} as any)
    const ask = vi.fn()
    render(<MemoryRouter><ClientHome user={{ id: 'u', name: 'Pedro Lima' }} categories={categories} onAsk={ask} onOpen={() => {}} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Conte o que aconteceu'), { target: { value: ' a vpn cai ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuda' }))
    expect(ask).toHaveBeenCalledWith({ text: 'a vpn cai' })
    fireEvent.click(await screen.findByRole('button', { name: 'Resolveu' }))
    await waitFor(() => expect(ok).toHaveBeenCalledWith('2'))
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2))
  })

  it('contrato vencido não abre pedido', async () => {
    vi.spyOn(ticketService, 'getTicketsPage').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 30 })
    render(<MemoryRouter><ClientHome user={{ id: 'u', name: 'Pedro' }} categories={categories} disabled onAsk={() => {}} onOpen={() => {}} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Pedir ajuda' })).toBeDisabled()
    expect(await screen.findByText(/Nenhum chamado em andamento/)).toBeInTheDocument()
  })

  it('palpite de assunto sem IA', () => {
    expect(suggestCategories('a minha VPN cai toda hora', categories)[0]).toMatchObject({ category: { id: 'rede' }, subcategory: { id: 'vpn' } })
    expect(suggestCategories('bom dia', categories)).toEqual([])
    expect(titleFrom('A VPN cai. Começou hoje.')).toBe('A VPN cai')
    expect(titleFrom('x '.repeat(90)).length).toBeLessThanOrEqual(81)
  })
})

describe('Minha semana', () => {
  it('segunda a sexta; no fim de semana, a próxima', () => {
    expect(weekDays(now).map(dayKey)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'])
    expect(dayKey(weekDays(new Date(2026, 10, 28))[0])).toBe('2026-11-30')
    expect(dayKey(weekDays(new Date(2026, 10, 29))[0])).toBe('2026-11-30')
  })
})
