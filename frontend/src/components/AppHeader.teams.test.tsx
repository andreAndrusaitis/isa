import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inTeams: false }))

vi.mock('@/teams/teamsContext', () => ({ useInTeams: () => mocks.inTeams }))
vi.mock('@/store/auth', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({
    user: { id: 'u1', name: 'Ana Analista', email: 'ana@isa.local', role: 'agent' },
    clearAuth: vi.fn(),
  }),
}))

import { AppHeader } from './AppHeader'

function renderHeader(path = '/chamados') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/perfil" element={<div>tela do perfil</div>} />
        <Route path="*" element={(
          <AppHeader onRefresh={() => {}} right={<button type="button">Notificações</button>}>
            <span>Extra da tela</span>
          </AppHeader>
        )} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppHeader no Teams', () => {
  beforeEach(() => { mocks.inTeams = false })

  it('no navegador mostra o cabeçalho completo', () => {
    renderHeader()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mudar para modo/ })).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('no Teams some o cabeçalho, o tema e o menu do usuário (Sair)', () => {
    mocks.inTeams = true
    renderHeader()

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mudar para modo/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.queryByText('Sair')).not.toBeInTheDocument()
    // o que é da tela continua
    expect(screen.getByText('Extra da tela')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recarregar página' })).toBeInTheDocument()
  })

  it('no Teams o perfil fica num atalho da faixa compacta', async () => {
    mocks.inTeams = true
    renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'Meu perfil' }))
    expect(screen.getByText('tela do perfil')).toBeInTheDocument()
  })
})
