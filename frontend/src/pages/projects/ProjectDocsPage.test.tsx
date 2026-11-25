import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectDocsPage from './ProjectDocsPage'
import * as projectsService from '@/services/projectsService'
import { useAuthStore } from '@/store/auth'
import { ProjectRoleProvider } from '@/components/projects/projectRole'

vi.mock('@/services/projectsService')
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const files = [
  {
    id: 'a1', fileName: 'Documentacao_Tecnica.pdf', mimeType: 'application/pdf', fileSize: 1363149, url: 'https://x/a1',
    createdAt: '2026-10-13T17:45:00.000Z', entityType: 'task', entityId: 't1',
    uploader: { id: 'u1', name: 'Ana Souza' }, task: { id: 't1', key: 'FEAT-7', title: 'Integração bancária' },
  },
  {
    id: 'a2', fileName: 'Repasse_Interno.pdf', mimeType: 'application/pdf', fileSize: 253747, url: 'https://x/a2',
    createdAt: '2026-10-12T12:05:00.000Z', entityType: 'document', entityId: 'p1',
    uploader: { id: 'u2', name: 'Bruno Lima' }, task: null,
  },
]

function renderPage() {
  useAuthStore.setState({ user: { id: 'u1', name: 'Ana Souza', role: 'manager' } as any })
  vi.mocked(projectsService.listAttachments).mockResolvedValue(files as any)
  return render(
    <MemoryRouter initialEntries={['/projetos/p1/docs']}>
      <ProjectRoleProvider value="owner">
        <Routes><Route path="/projetos/:projectId/docs" element={<ProjectDocsPage />} /></Routes>
      </ProjectRoleProvider>
    </MemoryRouter>
  )
}

describe('ProjectDocsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { localStorage.clear() } catch { /* sem storage */ }
  })

  it('mostra quem enviou, data com hora e a task de origem', async () => {
    renderPage()
    expect(await screen.findByText('Documentacao_Tecnica.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.getAllByText(/\d{2}:\d{2}/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('link', { name: 'FEAT-7' })).toHaveAttribute('href', '/projetos/p1/tasks?task=t1')
    expect(screen.getByText('Documento do projeto')).toBeInTheDocument()
  })

  it('ordena pela coluna', async () => {
    renderPage()
    await screen.findByText('Documentacao_Tecnica.pdf')
    const table = screen.getByRole('table')
    expect(within(table).getByText('Enviado por', { exact: false })).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: /Nome/ }))
    const names = within(table).getAllByRole('row').slice(1).map((r) => within(r).getByTitle(/\.pdf$/).textContent)
    expect(names).toEqual(['Documentacao_Tecnica.pdf', 'Repasse_Interno.pdf'])
    fireEvent.click(within(table).getByRole('button', { name: /Nome/ }))
    const desc = within(table).getAllByRole('row').slice(1).map((r) => within(r).getByTitle(/\.pdf$/).textContent)
    expect(desc).toEqual(['Repasse_Interno.pdf', 'Documentacao_Tecnica.pdf'])
  })
})
