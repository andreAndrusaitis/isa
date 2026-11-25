import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectFolderNavItem } from './ProjectFolderNavItem'

describe('ProjectFolderNavItem', () => {
  it('não mostra os sub-itens quando fechado', () => {
    render(
      <ProjectFolderNavItem
        id="p1" name="Atlas" expanded={false} active={false} isFavorite={false}
        currentPath="/projetos" onToggle={() => {}} onNavigate={() => {}}
      />
    )
    expect(screen.getByText('Atlas')).toBeInTheDocument()
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
  })

  it('mostra Visão geral, Tasks, Arquivos e Membros como sub-itens quando aberto', () => {
    render(
      <ProjectFolderNavItem
        id="p1" name="Atlas" expanded active={false} isFavorite={false}
        currentPath="/projetos" onToggle={() => {}} onNavigate={() => {}}
      />
    )
    expect(screen.getByText('Visão geral')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Arquivos')).toBeInTheDocument()
    expect(screen.getByText('Membros')).toBeInTheDocument()
    expect(screen.getByText('Configurações')).toBeInTheDocument()
  })

  it('a seta só abre/fecha a pasta, sem navegar', () => {
    const onToggle = vi.fn()
    const onNavigate = vi.fn()
    render(
      <ProjectFolderNavItem
        id="p1" name="Atlas" expanded={false} active={false} isFavorite={false}
        currentPath="/projetos" onToggle={onToggle} onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Atlas' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clicar no nome abre a Visão geral sem expandir a pasta', () => {
    const onToggle = vi.fn()
    const onNavigate = vi.fn()
    render(
      <ProjectFolderNavItem
        id="p1" name="Atlas" expanded={false} active={false} isFavorite={false}
        currentPath="/projetos" onToggle={onToggle} onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByText('Atlas'))
    expect(onToggle).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('overview')
  })

  it('chama onNavigate com o path do sub-item clicado', () => {
    const onNavigate = vi.fn()
    render(
      <ProjectFolderNavItem
        id="p1" name="Atlas" expanded active={false} isFavorite={false}
        currentPath="/projetos" onToggle={() => {}} onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByText('Tasks'))
    expect(onNavigate).toHaveBeenCalledWith('tasks')
  })
})
