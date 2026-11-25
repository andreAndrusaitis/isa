import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProjectIntegrationsPage from './ProjectIntegrationsPage'
import * as projectsService from '@/services/projectsService'
import { useAuthStore } from '@/store/auth'

vi.mock('@/services/projectsService')

const events = [
  { event: 'task.created', group: 'Tasks', label: 'Task criada', description: 'Uma task nova foi criada no projeto.' },
  { event: 'comment.created', group: 'Comentários', label: 'Comentário criado', description: 'Alguém comentou numa task.' },
]
const projects = [
  { id: 'p1', name: 'Atlas', myRole: 'member' },
  { id: 'p2', name: 'Onboarding', myRole: 'viewer' },
]
const webhook = {
  id: 'wh1', projectIds: ['p1'], name: 'Integração ERP', description: null, url: 'https://erp.com/hook',
  events: ['task.created'], active: true, createdAt: '2026-10-09T12:00:00.000Z',
  recentDeliveries: { total: 2, success: 1, failed: 1, pending: 0 },
}
const apiKey = {
  id: 'k1', name: 'Power Automate', description: null, keyPrefix: 'isaproj_ab12', scopes: ['read_tasks', 'write_tasks'], active: true,
  createdBy: 'u1', serviceUserId: 's1', lastUsedAt: null, createdAt: '2026-10-20T12:00:00.000Z', projectIds: ['p1'], requestsCount: 3,
}

function renderPage(url = '/projetos/webhooks') {
  return render(<MemoryRouter initialEntries={[url]}><ProjectIntegrationsPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 'u1', name: 'Ana', role: 'agent' } as any })
  vi.mocked(projectsService.listWebhookEvents).mockResolvedValue(events as any)
  vi.mocked(projectsService.listProjects).mockResolvedValue(projects as any)
  vi.mocked(projectsService.listProjectApiScopes).mockResolvedValue(['read_tasks', 'write_tasks', 'read_projects'])
  vi.mocked(projectsService.listWebhooks).mockResolvedValue([])
  vi.mocked(projectsService.listProjectApiKeys).mockResolvedValue([])
  vi.mocked(projectsService.getWebhookEventSchema).mockResolvedValue({ type: 'object' })
  vi.mocked(projectsService.getWebhookEventExample).mockResolvedValue({ event: 'task.created', data: { task: { description: 'x' } } })
})

describe('ProjectIntegrationsPage — mesma tela de Webhooks e API dos chamados', () => {
  it('abas Saída e API externa; estado vazio em cada uma', async () => {
    renderPage()
    expect(await screen.findByText(/Nenhum webhook de saída cadastrado/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /API externa/ }))
    expect(await screen.findByText(/Nenhuma API key cadastrada/)).toBeInTheDocument()
  })

  it('cria webhook em 3 passos (nome/URL, eventos, projetos) e mostra o secret', async () => {
    vi.mocked(projectsService.createWebhook).mockResolvedValue({ ...webhook, name: 'Meu Webhook', secret: 'segredo-123' } as any)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo' }))
    fireEvent.change(screen.getByPlaceholderText('Ex.: Alertas no Teams (Projetos)'), { target: { value: 'Meu Webhook' } })
    fireEvent.change(screen.getByPlaceholderText('https://sistema-externo.com/webhook'), { target: { value: 'https://destino.com/hook' } })
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    fireEvent.click(await screen.findByText('Task criada'))
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    // Só projetos em que a pessoa é dono/gerente/membro (leitor não aparece).
    expect(screen.queryByRole('checkbox', { name: 'Onboarding' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Criar webhook' }))
    expect(await screen.findByText(/Selecione pelo menos um projeto/)).toBeInTheDocument()
    expect(projectsService.createWebhook).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Atlas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar webhook' }))
    await waitFor(() => expect(projectsService.createWebhook).toHaveBeenCalledWith({
      name: 'Meu Webhook', url: 'https://destino.com/hook', events: ['task.created'], active: true, projectIds: ['p1'],
    }))
    expect(await screen.findByText('segredo-123')).toBeInTheDocument()
  })

  it('admin cria webhook para todos os projetos sem marcar nenhum', async () => {
    useAuthStore.setState({ user: { id: 'adm', name: 'Admin', role: 'admin' } as any })
    vi.mocked(projectsService.createWebhook).mockResolvedValue({ ...webhook, projectIds: [], secret: 's' } as any)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo' }))
    fireEvent.change(screen.getByPlaceholderText('Ex.: Alertas no Teams (Projetos)'), { target: { value: 'Global' } })
    fireEvent.change(screen.getByPlaceholderText('https://sistema-externo.com/webhook'), { target: { value: 'https://d.com' } })
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    fireEvent.click(await screen.findByText('Task criada'))
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    expect(screen.getByText(/vale para/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Criar webhook' }))
    await waitFor(() => expect(projectsService.createWebhook).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [] })))
  })

  it('card do webhook: testar, logs com reenviar só na falha, excluir', async () => {
    vi.mocked(projectsService.listWebhooks).mockResolvedValue([webhook] as any)
    vi.mocked(projectsService.testWebhook).mockResolvedValue({ status: 'success', responseStatus: 200, durationMs: 42, errorMessage: null })
    vi.mocked(projectsService.listWebhookDeliveries).mockResolvedValue({
      data: [
        { id: 'd1', eventId: 'e1', event: 'task.created', status: 'failed', attempts: 5, responseStatus: 500, durationMs: 10, errorMessage: 'HTTP 500', createdAt: '2026-10-09T12:00:00.000Z', deliveredAt: null },
        { id: 'd2', eventId: 'e2', event: 'task.created', status: 'success', attempts: 1, responseStatus: 200, durationMs: 10, errorMessage: null, createdAt: '2026-10-09T12:00:00.000Z', deliveredAt: null },
      ],
      meta: { total: 2, page: 1, pages: 1 },
    } as any)
    vi.mocked(projectsService.resendDelivery).mockResolvedValue({ deliveryId: 'd3' })
    vi.mocked(projectsService.deleteWebhook).mockResolvedValue()
    renderPage()

    expect(await screen.findByText('Integração ERP')).toBeInTheDocument()
    expect(screen.getByText('Atlas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Testar' }))
    expect(await screen.findByText(/HTTP 200 em 42 ms/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    const resend = await screen.findAllByRole('button', { name: 'Reenviar' })
    expect(resend).toHaveLength(1)
    fireEvent.click(resend[0])
    await waitFor(() => expect(projectsService.resendDelivery).toHaveBeenCalledWith('wh1', 'd1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Entendido' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Integração ERP' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(projectsService.deleteWebhook).toHaveBeenCalledWith('wh1'))
  })

  it('cria API key com projeto e escopos e mostra a key e os exemplos (Power Automate/curl)', async () => {
    vi.mocked(projectsService.createProjectApiKey).mockResolvedValue({ ...apiKey, key: 'isaproj_segredo' } as any)
    renderPage('/projetos/webhooks?tab=keys')
    fireEvent.click(await screen.findByRole('button', { name: 'Novo' }))
    fireEvent.change(screen.getByPlaceholderText('Ex.: Power Automate — onboarding'), { target: { value: 'Power Automate' } })
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Atlas' }))
    fireEvent.click(screen.getByText('Ler tasks'))
    fireEvent.click(screen.getByText('Criar/editar tasks'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar API key' }))
    await waitFor(() => expect(projectsService.createProjectApiKey).toHaveBeenCalledWith({
      name: 'Power Automate', scopes: ['read_tasks', 'write_tasks'], projectIds: ['p1'], active: true,
    }))
    expect(await screen.findByText('isaproj_segredo')).toBeInTheDocument()
    expect(screen.getByText(/Exemplos completos para o sistema externo/)).toBeInTheDocument()
    expect(screen.getAllByRole('tab', { name: 'Power Automate' }).length).toBeGreaterThan(0)
  })

  it('card da key: requisições com payload e regenerar', async () => {
    vi.mocked(projectsService.listProjectApiKeys).mockResolvedValue([apiKey] as any)
    vi.mocked(projectsService.listProjectApiKeyRequests).mockResolvedValue({
      data: [{ id: 'r1', method: 'POST', path: '/projects/p1/tasks', status: 'success', responseStatus: 201, errorCode: null, errorMessage: null, resourceType: 'task', resourceId: 't1', externalRequestId: 'erp-1', requestPayload: { title: 'X' }, createdAt: '2026-10-20T12:00:00.000Z' }],
      meta: { total: 1, page: 1, pages: 1 },
    } as any)
    vi.mocked(projectsService.regenerateProjectApiKey).mockResolvedValue({ ...apiKey, key: 'isaproj_nova' } as any)
    renderPage('/projetos/webhooks?tab=keys')

    expect(await screen.findByText('Power Automate')).toBeInTheDocument()
    expect(screen.getByText(/3 requisição/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Requisições' }))
    expect(await screen.findByText('/projects/p1/tasks')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Payload' }))
    expect(screen.getByText(/"title": "X"/)).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Editar Power Automate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerar key' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('isaproj_nova')).toBeInTheDocument()
  })

  it('ver payload de exemplo do evento no checklist', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo' }))
    fireEvent.change(screen.getByPlaceholderText('Ex.: Alertas no Teams (Projetos)'), { target: { value: 'W' } })
    fireEvent.change(screen.getByPlaceholderText('https://sistema-externo.com/webhook'), { target: { value: 'https://d.com' } })
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver payload' }))[0])
    await waitFor(() => expect(projectsService.getWebhookEventExample).toHaveBeenCalledWith('task.created'))
  })
})
