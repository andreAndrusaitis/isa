import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MainNav } from './MainNav'
import { AppHeader } from './AppHeader'
import { CommandTrigger, matchScreens } from './CommandMenu'
import { Donut } from './charts/Donut'
import { iconFor } from '@/areas/solicitacoes/categoryIcon'
import { useAuthStore } from '@/store/auth'
import { useNavStore } from '@/store/nav'
import { ticketService } from '@/services/ticketService'
import { CircleHelp, KeyRound, Wifi } from 'lucide-react'

const login = (role: string, extra: object = {}) => useAuthStore.setState({ user: { id: 'u', name: 'Ana', role, permissions: [], modules: { tickets: true, projects: true, documents: true }, queues: ['q1'], ...extra } as any })
function Where() { return <output>{useLocation().pathname}</output> }
const show = (path: string, ui = <MainNav />) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></MemoryRouter>)

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear()
  useNavStore.setState({ mobileOpen: false, rail: false, queues: [{ id: 'q1', name: 'Fila VIP' }], counts: { my: 2, q1: 5 }, stats: null, online: [] })
})

describe('menu lateral', () => {
  it('analista: telas com número, filas dele e a tela aberta marcada', () => {
    login('agent')
    show('/chamados')
    const mine = screen.getByRole('link', { name: /Meus chamados/ })
    expect(mine).toHaveAttribute('aria-current', 'page')
    expect(mine).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /Fila VIP/ })).toHaveAttribute('href', '/chamados/filas/q1')
  })

  it('seção longa começa fechada e abre no clique; a da tela aberta já vem aberta', () => {
    login('admin')
    const { unmount } = show('/gestao/dashboard')
    expect(screen.queryByRole('link', { name: 'Filas' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(screen.getByRole('link', { name: 'Filas' })).toBeInTheDocument()
    unmount()
    show('/configuracoes/filas')
    expect(screen.getByRole('link', { name: 'Filas' })).toHaveAttribute('aria-current', 'page')
  })

  it('recolhe para ícones, guarda a escolha e recolhe sozinho em Projetos', () => {
    login('admin')
    const { unmount } = show('/gestao/dashboard')
    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }))
    expect(document.documentElement.dataset.nav).toBe('rail')
    expect(localStorage.getItem('isa-menu-recolhido')).toBe('1')
    expect(screen.getByRole('link', { name: 'Projetos' })).toBeInTheDocument()
    unmount()
    useNavStore.setState({ rail: false })
    show('/projetos/semana')
    expect(document.documentElement.dataset.nav).toBe('rail')
  })
})

describe('cliente', () => {
  it('não tem menu lateral: telas e Nova solicitação ficam no topo', () => {
    login('user')
    show('/solicitacoes/todas', <AppHeader />)
    expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /menu de navegação/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Meus chamados' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Nova solicitação' })).toHaveAttribute('href', '/solicitacoes/nova')
  })
})

describe('busca geral', () => {
  it('Ctrl K abre, acha a tela e Enter vai', async () => {
    login('admin')
    vi.spyOn(ticketService, 'getTicketsPage').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 5 })
    show('/gestao/dashboard', <CommandTrigger />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const box = await screen.findByRole('combobox', { name: 'Buscar' })
    fireEvent.change(box, { target: { value: 'feriado' } })
    expect(await screen.findByRole('option', { name: /Expediente/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('/configuracoes/expediente')
  })

  it('acha chamado pelo número e não mostra ajuste a quem não pode', async () => {
    login('agent')
    vi.spyOn(ticketService, 'getTicketsPage').mockResolvedValue({ data: [{ id: 't1', title: 'VPN cai', displayNumber: 'INC-7', status: 'open' } as any], total: 1, page: 1, pageSize: 5 })
    show('/chamados', <CommandTrigger />)
    fireEvent.click(screen.getByRole('button', { name: /Buscar/ }))
    const box = await screen.findByRole('combobox', { name: 'Buscar' })
    fireEvent.change(box, { target: { value: 'aparencia' } })
    expect(screen.queryByRole('option', { name: /Aparência/ })).toBeNull()
    fireEvent.change(box, { target: { value: 'INC-7' } })
    fireEvent.click(await screen.findByRole('option', { name: /VPN cai/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/c/t1'))
  })

  it('em Documentos o atalho fica com a busca de páginas', () => {
    login('admin')
    show('/documentos', <CommandTrigger />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('casa sem acento e prefere o começo do nome', () => {
    const e = (label: string, hint = '') => ({ id: label, label, hint, icon: null, path: '/' })
    expect(matchScreens([e('Minhas solicitações'), e('Satisfação')], 'satisfacao').map(x => x.label)).toEqual(['Satisfação'])
    expect(matchScreens([e('Tipos de fila'), e('Filas')], 'fila')[0].label).toBe('Filas')
  })
})

describe('peças', () => {
  it('rosca: total no meio, legenda clicável e vazio', () => {
    const pick = vi.fn()
    const { container, rerender } = render(<Donut ariaLabel="x" onSelect={pick} parts={[{ id: 'a', label: 'Aberto', value: 3 }, { id: 'b', label: 'Fechado', value: 1 }]} />)
    expect(container.querySelector('.donut-n')).toHaveTextContent('4')
    fireEvent.click(screen.getByRole('button', { name: /Aberto/ }))
    expect(pick).toHaveBeenCalledWith('a')
    expect(screen.getByText('75%')).toBeInTheDocument()
    rerender(<Donut ariaLabel="x" parts={[{ id: 'a', label: 'Aberto', value: 0 }]} />)
    expect(screen.getByText('Sem dados no período.')).toBeInTheDocument()
  })
  it('ícone pelo nome da categoria', () => {
    expect(iconFor('Rede e VPN')).toBe(Wifi)
    expect(iconFor('Acessos e contas')).toBe(KeyRound)
    expect(iconFor('Outra coisa')).toBe(CircleHelp)
  })
})
