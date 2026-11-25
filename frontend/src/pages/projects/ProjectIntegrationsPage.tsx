import { toast } from '@/store/toastStore'
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Btn, Field, Inp, Sel, Toggle, PageHeader, Modal, ConfirmModal, AlertModal, SortHeader, TruncatedText, Loading } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { CopyBtn, SecretBox, CodeBlock, DocTable, DocSection, FilterChip, EventChecklist, DeliveryHealth, PayloadExampleModal, ApiExample } from '@/components/webhooks/WebhookParts'
import { apiBaseUrl, type ApiExampleSpec } from '@/components/webhooks/apiExamples'
import { Edit, Trash2 } from 'lucide-react'
import {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, regenerateWebhookSecret,
  listWebhookEvents, getWebhookEventExample, getWebhookEventSchema,
  listWebhookDeliveries, resendDelivery, testWebhook, listProjects,
  listProjectApiKeys, listProjectApiScopes, createProjectApiKey, updateProjectApiKey, regenerateProjectApiKey,
  deleteProjectApiKey, listProjectApiKeyRequests,
  type ProjectApiKey, type ApiRequestRow,
} from '@/services/projectsService'
import '@/components/projects/insights/projects.css'
import { useAuthStore } from '@/store/auth'
import type { Project, ProjectWebhook, ProjectWebhookEvent, WebhookDelivery } from '@/types/projects'

// Cópia da tela "Webhooks e API" da área de chamados (areas/admin/WebhooksPanel),
// com o recorte do módulo: em vez dos filtros de chamado e da trava de empresa,
// cada webhook/chave escolhe os projetos que alcança, e a chave age como o
// usuário de serviço "API · nome" com o papel de quem a criou em cada projeto.

type Tab = 'out' | 'keys'
type Page<T> = { data: T[]; meta: { total: number; page: number; pages: number } }

const SCOPE_META: Record<string, { group: string; label: string; description: string }> = {
  read_projects:     { group: 'Leitura', label: 'Ler projetos', description: 'Lista e consulta os projetos ao alcance da chave.' },
  read_tasks:        { group: 'Leitura', label: 'Ler tasks', description: 'Lista (paginada) e consulta tasks completas: descrição, responsáveis, status, campos, checklist, subtasks, comentários e link.' },
  read_comments:     { group: 'Leitura', label: 'Ler comentários', description: 'Lista os comentários de uma task.' },
  read_members:      { group: 'Leitura', label: 'Ler membros', description: 'Lista os membros do projeto com o papel de cada um.' },
  read_structure:    { group: 'Leitura', label: 'Ler estrutura', description: 'Status, listas, pastas, tipos de task, sprints, tags e campos personalizados — os ids para montar as escritas.' },
  read_documents:    { group: 'Leitura', label: 'Ler documentos', description: 'Docs do projeto.' },
  read_attachments:  { group: 'Leitura', label: 'Ler anexos', description: 'Arquivos de tasks, comentários e documentos.' },
  read_time:         { group: 'Leitura', label: 'Ler horas e indicadores', description: 'Horas por task e por pessoa, dashboard e carga da equipe.' },
  read_tickets:      { group: 'Leitura', label: 'Ler chamados vinculados', description: 'Chamados ligados a uma task.' },
  write_projects:    { group: 'Escrita', label: 'Criar/editar projeto', description: 'Edita dados do projeto (dono/gerente). Criar projeto exige chave de todos os projetos.' },
  write_tasks:       { group: 'Escrita', label: 'Criar/editar tasks', description: 'Cria, edita, move de status, conclui; responsáveis, checklist, tags, campos e dependências. Arquivar é de dono/gerente.' },
  write_comments:    { group: 'Escrita', label: 'Comentar', description: 'Comenta, edita o que a chave escreveu e exclui (de outros, só dono/gerente).' },
  write_members:     { group: 'Escrita', label: 'Gerenciar membros', description: 'Adiciona, troca papel e remove membros — nunca donos. Só dono/gerente.' },
  write_structure:   { group: 'Escrita', label: 'Configurar estrutura', description: 'Cria status, listas, pastas, tipos, sprints, tags e campos. Só dono/gerente.' },
  write_documents:   { group: 'Escrita', label: 'Criar/editar documentos', description: 'Cria e edita docs e liga documento a task.' },
  write_attachments: { group: 'Escrita', label: 'Anexar arquivos', description: 'Envia arquivo (base64) para task, comentário ou documento.' },
  write_tickets:     { group: 'Escrita', label: 'Vincular chamados', description: 'Liga e desliga chamados a uma task.' },
}

/** Situação do envio em texto: só a falha ganha cor. */
const StatusText = ({ status }: { status: string }) => <span style={status === 'failed' ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{status}</span>

type CurlCtx = { project: { id: string; name: string } | null }

const PROJECT_HINT = '<id-do-projeto — use GET /projects>'
const pid = (ctx: CurlCtx) => ctx.project?.id ?? PROJECT_HINT
const PERSON = { id: 'uuid', name: 'Maria Souza', email: 'maria.souza@empresa.com.br' }
const SAMPLE_TASK = {
  id: 'uuid', key: 'BUG-7', seq: 142, number: '#142', title: 'Implementar autenticação',
  description: 'Login com SSO Microsoft e fallback de senha local.', priority: 'high',
  project_id: 'uuid', status_id: 'uuid', list_id: 'uuid', sprint_id: 'uuid', parent_id: null, assignee_id: 'uuid', creator_id: 'uuid',
  start_date: '2026-10-01T00:00:00.000Z', due_date: '2026-10-20T00:00:00.000Z', story_points: 5, is_milestone: false,
  archived_at: null, created_at: '2026-09-30T12:00:00.000Z', updated_at: '2026-10-09T12:00:00.000Z',
  url: 'https://.../projetos/uuid/tasks?task=uuid',
  project: { id: 'uuid', name: 'Portal' },
  status: { id: 'uuid', name: 'Em andamento', category: 'in_progress', color: '#0f73ac' },
  task_type: { id: 'uuid', name: 'Bug', prefix: 'BUG', color: '#b3402a' },
  list: { id: 'uuid', name: 'Backlog' },
  sprint: { id: 'uuid', name: 'Sprint 12', status: 'active', start_date: '2026-10-06T00:00:00.000Z', end_date: '2026-10-17T00:00:00.000Z' },
  assignee: PERSON, creator: { id: 'uuid', name: 'João Silva', email: 'joao.silva@empresa.com.br' }, assignees: [PERSON],
  tags: [{ id: 'uuid', name: 'segurança', color: '#8a5f0c' }],
  custom_fields: [{ id: 'uuid', name: 'Cliente', type: 'text', value: 'ACME' }],
  checklist: [{ id: 'uuid', text: 'Escrever testes', done: true, position: 0 }],
  subtasks: [{ id: 'uuid', seq: 143, key: 'TASK-9', title: 'Tela de MFA', status: { id: 'uuid', name: 'A fazer', category: 'open' } }],
  blocked_by: [{ dependency_id: 'uuid', task: { id: 'uuid', seq: 140, key: 'FEAT-3', title: 'Tela de login' } }],
  blocks: [], documents: [{ id: 'uuid', title: 'Especificação do login' }],
  tickets: [{ id: 'uuid', display_number: 'ISA-1042', title: 'Erro ao logar', status: 'pending' }],
  comments: [{ id: 'uuid', body: 'Revisei o fluxo, pode seguir.', created_at: '2026-10-09T11:00:00.000Z', edited_at: null, author: PERSON }],
  comments_count: 1,
}
const SAMPLE_PROJECT = { id: 'uuid', name: 'Portal', description: 'Projeto de implantação', privacy: 'organization', color: '#0f73ac', start_date: null, target_date: '2026-12-31T00:00:00.000Z', archived_at: null, created_at: '2026-09-01T12:00:00.000Z' }
const writeResponse = (type: string, data: unknown) => ({ duplicate: false, resource_type: type, resource_id: 'uuid', data })

/** Uma especificação por escopo — curl, passo a passo do Power Automate e JSON Schema saem daqui. */
const SCOPE_EXAMPLE: Record<string, (ctx: CurlCtx) => ApiExampleSpec> = {
  read_projects: () => ({
    method: 'GET', path: '/projects?page=1&per_page=50',
    response: { data: [SAMPLE_PROJECT], pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 } },
  }),
  read_tasks: (ctx) => ({
    method: 'GET', path: `/projects/${pid(ctx)}/tasks?page=1&per_page=100&updated_since=2026-10-01T00:00:00Z`,
    response: { data: [SAMPLE_TASK], pagination: { page: 1, per_page: 100, total: 1, total_pages: 1 } },
    note: 'Cada task vem completa (descrição, pessoas, campos, comentários…). Para uma só: GET /projects/{projeto}/tasks/BUG-7 (aceita id, ID do tipo ou número). Para trazer todas: "Fazer até" incrementando page até page > total_pages; para só o que mudou, guarde o maior updated_at e use como updated_since.',
  }),
  write_tasks: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/tasks`,
    body: { external_request_id: 'erp-4512', title: 'Integrar ERP', description: 'Detalhes...', priority: 'high', due_date: '2026-11-30T00:00:00Z', assignee_id: '<uuid de um membro — use GET /members>' },
    response: writeResponse('task', SAMPLE_TASK),
    note: 'Sem status_id a task entra no primeiro status "aberto". Editar: PATCH /projects/{projeto}/tasks/BUG-7 com os campos que mudam (ex.: { "status_id": "uuid" }). Concluir: POST …/tasks/BUG-7/complete.',
  }),
  read_comments: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/tasks/BUG-7/comments`, response: { data: [{ id: 'uuid', task_id: 'uuid', author_id: 'uuid', body: 'Revisei o fluxo.', edited_at: null, created_at: '2026-10-09T11:00:00.000Z' }] } }),
  write_comments: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/tasks/BUG-7/comments`,
    body: { external_request_id: 'coment-001', body: 'Sincronizado com o ERP' },
    response: writeResponse('comment', { id: 'uuid', task_id: 'uuid', author_id: 'uuid', body: 'Sincronizado com o ERP', edited_at: null, created_at: '2026-10-09T11:00:00.000Z' }),
  }),
  read_members: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/members`, response: { data: [{ id: 'uuid', project_id: 'uuid', user_id: 'uuid', role: 'member', user: { id: 'uuid', name: 'Maria Souza', avatar: null, role: 'agent' } }] } }),
  write_members: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/members`,
    body: { external_request_id: 'membro-001', email: 'maria.souza@empresa.com.br', role: 'member' },
    response: writeResponse('project_member', { id: 'uuid', project_id: 'uuid', user_id: 'uuid', role: 'member' }),
  }),
  read_structure: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/statuses`, response: { data: [{ id: 'uuid', name: 'Em andamento', color: '#0f73ac', category: 'in_progress', position: 1, is_active: true, requires_approval: false }] }, note: 'Mesma forma para /lists, /folders, /task-types, /sprints, /tags e /custom-fields.' }),
  write_structure: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/sprints`,
    body: { external_request_id: 'sprint-13', name: 'Sprint 13', start_date: '2026-10-20T00:00:00Z', end_date: '2026-10-31T00:00:00Z' },
    response: writeResponse('sprint', { id: 'uuid', name: 'Sprint 13', status: 'planned' }),
  }),
  read_documents: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/documents`, response: { data: [{ id: 'uuid', title: 'Especificação do login', parent_id: null, position: 0, updated_at: '2026-10-09T12:00:00.000Z' }] } }),
  write_documents: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/documents`,
    body: { external_request_id: 'doc-001', title: 'Ata da reunião', content: [{ type: 'paragraph', text: 'Decisões...' }] },
    response: writeResponse('document', { id: 'uuid', title: 'Ata da reunião' }),
  }),
  read_attachments: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/attachments?task_id=uuid`, response: { data: [{ id: 'uuid', file_name: 'print.png', mime_type: 'image/png', file_size: 1024, url: 'https://...' }] } }),
  write_attachments: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/attachments`,
    body: { external_request_id: 'anexo-001', entity_type: 'task', entity_id: '<uuid da task>', file_name: 'print.png', data_uri: 'data:image/png;base64,iVBORw0KGgo...' },
    response: writeResponse('attachment', { id: 'uuid', file_name: 'print.png' }),
  }),
  read_time: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/time`, response: { data: { tasks: [], people: [] } }, note: 'Também: /dashboard, /workload e /tasks/{task}/time.' }),
  read_tickets: (ctx) => ({ method: 'GET', path: `/projects/${pid(ctx)}/tasks/BUG-7/tickets`, response: { data: [{ id: 'uuid', display_number: 'ISA-1042', title: 'Erro ao logar', status: 'pending' }] } }),
  write_tickets: (ctx) => ({
    method: 'POST', path: `/projects/${pid(ctx)}/tasks/BUG-7/tickets`,
    body: { external_request_id: 'vinculo-001', ticket: 'ISA-1042' },
    response: writeResponse('task', { id: 'uuid', tickets: [{ id: 'uuid', display_number: 'ISA-1042' }] }),
  }),
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ProjectIntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'keys' ? 'keys' : 'out'
  const setTab = (t: Tab) => setSearchParams(t === 'keys' ? { tab: 'keys' } : {}, { replace: true })
  const me = useAuthStore((s) => s.user)
  const isAdmin = me?.role === 'admin'
  const deliverySort = useTableSort<string>()
  const requestSort = useTableSort<string>()
  const [loading, setLoading] = useState(true)
  const [endpoints, setEndpoints] = useState<ProjectWebhook[]>([])
  const [apiKeys, setApiKeys] = useState<ProjectApiKey[]>([])
  const [scopes, setScopes] = useState<string[]>([])
  const [events, setEvents] = useState<ProjectWebhookEvent[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // Wizard de criação
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardDir, setWizardDir] = useState<Tab>('out')
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<ProjectWebhook | null>(null)
  const [createdKey, setCreatedKey] = useState<ProjectApiKey | null>(null)

  // Edição
  const [editOut, setEditOut] = useState<ProjectWebhook | null>(null)
  const [editKey, setEditKey] = useState<ProjectApiKey | null>(null)

  // Logs
  const [logsFor, setLogsFor] = useState<ProjectWebhook | null>(null)
  const [deliveries, setDeliveries] = useState<Page<WebhookDelivery> | null>(null)
  const [reqsForKey, setReqsForKey] = useState<ProjectApiKey | null>(null)
  const [keyRequests, setKeyRequests] = useState<Page<ApiRequestRow> | null>(null)
  const [expandedReq, setExpandedReq] = useState<string | null>(null)

  const [exampleFor, setExampleFor] = useState<{ event: string; payload: any; schema: any } | null>(null)
  const [loadingExample, setLoadingExample] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; variant?: 'danger' | 'primary' | 'warning' } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const [wizardSchemaEvent, setWizardSchemaEvent] = useState<string>('')
  const [wizardSchema, setWizardSchema] = useState<any>(null)
  const [loadingWizardSchema, setLoadingWizardSchema] = useState<boolean>(false)
  const [schemasFor, setSchemasFor] = useState<ProjectWebhook | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)

  const eventGroups = useMemo(() => {
    const groups: Record<string, ProjectWebhookEvent[]> = {}
    for (const ev of events) (groups[ev.group] ??= []).push(ev)
    return groups
  }, [events])

  const scopeGroups = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const s of scopes) (groups[SCOPE_META[s]?.group ?? 'Outros'] ??= []).push(s)
    return groups
  }, [scopes])

  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p.name])), [projects])
  // Dono, gerente ou membro (leitor não) — o backend recusa os outros; os já ligados continuam desmarcáveis.
  const pickableProjects = projects.filter(p => ['owner', 'manager', 'member'].includes(p.myRole ?? '') || (form.projectIds || []).includes(p.id))

  const load = async () => {
    try {
      const [epsRes, keysRes, evsRes, scsRes, projRes] = await Promise.allSettled([
        listWebhooks(),
        listProjectApiKeys(),
        listWebhookEvents(),
        listProjectApiScopes(),
        listProjects(),
      ])
      if (epsRes.status === 'fulfilled') setEndpoints(epsRes.value)
      if (keysRes.status === 'fulfilled') setApiKeys(keysRes.value)
      if (evsRes.status === 'fulfilled') setEvents(evsRes.value)
      if (scsRes.status === 'fulfilled') setScopes(scsRes.value)
      if (projRes.status === 'fulfilled') setProjects(projRes.value)
    } catch (err) {
      console.error('[ProjectIntegrationsPage] Erro ao carregar webhooks:', err)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const list = form.events || []
    if (list.length > 0) {
      if (!list.includes(wizardSchemaEvent)) {
        setWizardSchemaEvent(list[0])
      }
    } else if (schemasFor && schemasFor.events && schemasFor.events.length > 0) {
      if (!schemasFor.events.includes(wizardSchemaEvent)) {
        setWizardSchemaEvent(schemasFor.events[0])
      }
    } else {
      setWizardSchemaEvent('')
      setWizardSchema(null)
    }
  }, [form.events, schemasFor, wizardSchemaEvent])

  useEffect(() => {
    if (!wizardSchemaEvent) {
      setWizardSchema(null)
      return
    }
    setLoadingWizardSchema(true)
    getWebhookEventSchema(wizardSchemaEvent)
      .then(setWizardSchema)
      .catch(err => {
        console.error('Erro ao buscar esquema JSON:', err)
        setWizardSchema(null)
      })
      .finally(() => {
        setLoadingWizardSchema(false)
      })
  }, [wizardSchemaEvent])

  // ── Wizard ────────────────────────────────────────────────────────────────
  const openWizard = () => {
    setWizardDir(tab); setWizardStep(1)
    setForm({ name: '', url: '', events: [], scopes: [], projectIds: [], active: true })
    setCreatedSecret(null); setCreatedKey(null)
    if (events.length === 0) listWebhookEvents().then(setEvents).catch(() => {})
    if (scopes.length === 0) listProjectApiScopes().then(setScopes).catch(() => {})
    setWizardOpen(true)
  }

  const toggleEvent = (event: string) => {
    const list: string[] = form.events || []
    setForm({ ...form, events: list.includes(event) ? list.filter(e => e !== event) : [...list, event] })
  }

  const toggleScope = (scope: string) => {
    const list: string[] = form.scopes || []
    setForm({ ...form, scopes: list.includes(scope) ? list.filter(s => s !== scope) : [...list, scope] })
  }

  const toggleProject = (id: string) => {
    const list: string[] = form.projectIds || []
    setForm({ ...form, projectIds: list.includes(id) ? list.filter(p => p !== id) : [...list, id] })
  }

  const loadExample = async (event: string) => {
    setLoadingExample(event)
    try {
      const [payload, schema] = await Promise.all([
        getWebhookEventExample(event),
        getWebhookEventSchema(event),
      ])
      setExampleFor({ event, payload, schema })
    } catch {
      setAlertInfo({ title: 'Erro', message: 'Não foi possível gerar o exemplo deste evento.', variant: 'danger' })
    } finally {
      setLoadingExample(null)
    }
  }

  const selectGroup = (group: string) => {
    const groupEvents = (eventGroups[group] || []).map(e => e.event)
    const list: string[] = form.events || []
    const allSelected = groupEvents.every(e => list.includes(e))
    setForm({ ...form, events: allSelected ? list.filter(e => !groupEvents.includes(e)) : [...new Set([...list, ...groupEvents])] })
  }

  const selectScopeGroup = (group: string) => {
    const groupScopes: string[] = scopeGroups[group] || []
    const list: string[] = form.scopes || []
    const allSelected = groupScopes.every(s => list.includes(s))
    setForm({ ...form, scopes: allSelected ? list.filter(s => !groupScopes.includes(s)) : [...new Set([...list, ...groupScopes])] })
  }

  /** "Todos os projetos" (nenhum marcado) só o admin cria. */
  const projectsMissing = () => !isAdmin && !(form.projectIds || []).length

  const wizardNext = async () => {
    if (wizardStep === 1) {
      if (!(form.name || '').trim()) { setAlertInfo({ title: 'Validação', message: wizardDir === 'out' ? 'Dê um nome ao webhook.' : 'Dê um nome à API key.', variant: 'warning' }); return }
      if (wizardDir === 'out' && !(form.url || '').trim()) { setAlertInfo({ title: 'Validação', message: 'Informe a URL de destino.', variant: 'warning' }); return }
      setWizardStep(2); return
    }

    if (wizardStep === 2 && wizardDir === 'out') {
      if (!form.events?.length) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos um evento de gatilho.', variant: 'warning' }); return }
      setWizardStep(3); return
    }

    if (projectsMissing()) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos um projeto em que você participa.', variant: 'warning' }); return }
    if (wizardStep === 2 && wizardDir === 'keys') {
      if (!form.scopes?.length) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos uma permissão (escopo).', variant: 'warning' }); return }
    }

    // Passo de criação de fato:
    // Para Saída, é o Passo 3 (depois dos projetos). Para API keys, é o Passo 2.
    setSaving(true)
    try {
      if (wizardDir === 'out') {
        const created = await createWebhook({ name: form.name.trim(), url: form.url.trim(), events: form.events, active: form.active, projectIds: form.projectIds })
        setCreatedSecret(created)
        setEndpoints(prev => [{ ...created, secret: undefined }, ...prev])
        setWizardStep(4)
      } else {
        const created = await createProjectApiKey({ name: form.name.trim(), scopes: form.scopes, projectIds: form.projectIds, active: form.active })
        setCreatedKey(created)
        setApiKeys(prev => [{ ...created, key: undefined }, ...prev])
        setWizardStep(3)
      }
    } catch (err: any) {
      console.error('[ProjectIntegrationsPage] Erro ao criar:', err)
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao criar webhook.', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  // ── Ações dos cards ───────────────────────────────────────────────────────
  const toggleActive = async (item: ProjectWebhook | ProjectApiKey, kind: Tab) => {
    try {
      if (kind === 'out') {
        const updated = await updateWebhook(item.id, { active: !item.active })
        setEndpoints(prev => prev.map(e => e.id === item.id ? { ...e, ...updated } : e))
      } else {
        const updated = await updateProjectApiKey(item.id, { active: !item.active })
        setApiKeys(prev => prev.map(k => k.id === item.id ? { ...k, ...updated } : k))
      }
    } catch (err: any) {
      console.error('[ProjectIntegrationsPage] Erro ao ativar/desativar:', err)
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao alterar o status.', variant: 'danger' })
    }
  }

  const testEndpoint = async (ep: ProjectWebhook) => {
    setTesting(ep.id)
    try {
      const result = await testWebhook(ep.id)
      if (result?.status === 'success') {
        setAlertInfo({ title: 'Teste enviado', message: `Ping entregue com sucesso — HTTP ${result.responseStatus} em ${result.durationMs} ms.`, variant: 'primary' })
      } else {
        setAlertInfo({ title: 'Teste falhou', message: `O destino não confirmou o recebimento: ${result?.errorMessage || `HTTP ${result?.responseStatus ?? '—'}`}. Testes não são reenviados automaticamente — corrija o destino e teste de novo.`, variant: 'warning' })
      }
      load()
    } catch (err) {
      console.error('[ProjectIntegrationsPage] Erro no teste:', err)
      setAlertInfo({ title: 'Erro', message: 'Não foi possível executar o teste.', variant: 'danger' })
    } finally {
      setTesting(null)
    }
  }

  const openLogs = (ep: ProjectWebhook, page = 1) => {
    setLogsFor(ep)
    listWebhookDeliveries(ep.id, page).then(setDeliveries).catch(() => setDeliveries(null))
  }

  const openKeyRequests = (k: ProjectApiKey, page = 1) => {
    setReqsForKey(k); setExpandedReq(null)
    listProjectApiKeyRequests(k.id, page).then(setKeyRequests).catch(() => setKeyRequests(null))
  }

  const retryDelivery = async (d: WebhookDelivery) => {
    if (!logsFor) return
    try {
      await resendDelivery(logsFor.id, d.id)
      openLogs(logsFor, deliveries?.meta.page || 1)
      setAlertInfo({ title: 'Reenvio', message: 'Reenvio enfileirado. Atualize a lista em instantes para ver o resultado.', variant: 'primary' })
    } catch (err: any) {
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Não foi possível reenviar esta entrega.', variant: 'danger' })
    }
  }

  const removeOut = (ep: ProjectWebhook) => setConfirm({
    title: 'Excluir webhook de saída',
    message: `Excluir "${ep.name}"? O histórico de entregas também será removido. Esta ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await deleteWebhook(ep.id)
        setEndpoints(prev => prev.filter(e => e.id !== ep.id))
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao excluir o webhook.', variant: 'danger' })
      }
      setConfirm(null)
    },
  })

  const removeKey = (k: ProjectApiKey) => setConfirm({
    title: 'Excluir API key',
    message: `Excluir "${k.name}"? Ela deixará de autenticar imediatamente e o log de requisições dela é apagado. Tasks e comentários feitos por ela continuam no histórico. Esta ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await deleteProjectApiKey(k.id)
        setApiKeys(prev => prev.filter(x => x.id !== k.id))
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao excluir a API key.', variant: 'danger' })
      }
      setConfirm(null)
    },
  })

  const regenerateSecret = (ep: ProjectWebhook) => setConfirm({
    title: 'Regenerar secret',
    message: 'O secret atual deixará de funcionar imediatamente — o sistema de destino precisará ser atualizado. Continuar?',
    onConfirm: async () => {
      setConfirm(null)
      try {
        const updated = await regenerateWebhookSecret(ep.id)
        setEditOut(null)
        setCreatedSecret(updated)
      } catch (err: any) {
        setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao regenerar o secret.', variant: 'danger' })
      }
    },
  })

  const regenerateKey = (k: ProjectApiKey) => setConfirm({
    title: 'Regenerar API key',
    message: 'A key atual deixará de funcionar imediatamente — o sistema externo precisará ser atualizado. Continuar?',
    onConfirm: async () => {
      setConfirm(null)
      try {
        const updated = await regenerateProjectApiKey(k.id)
        setEditKey(null)
        setCreatedKey(updated)
      } catch (err: any) {
        setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao regenerar a API key.', variant: 'danger' })
      }
    },
  })

  const saveEditOut = async () => {
    if (!editOut) return
    if (projectsMissing()) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos um projeto em que você participa.', variant: 'warning' }); return }
    try {
      const updated = await updateWebhook(editOut.id, {
        name: form.name?.trim(), url: form.url?.trim(), events: form.events, active: form.active, projectIds: form.projectIds,
      })
      setEndpoints(prev => prev.map(e => e.id === editOut.id ? { ...e, ...updated } : e))
      setEditOut(null)
      toast.success('Webhook atualizado.')
    } catch (err: any) {
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao salvar.', variant: 'danger' })
    }
  }

  const saveEditKey = async () => {
    if (!editKey) return
    if (projectsMissing()) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos um projeto em que você participa.', variant: 'warning' }); return }
    try {
      const updated = await updateProjectApiKey(editKey.id, {
        name: form.name?.trim(), scopes: form.scopes, projectIds: form.projectIds, active: form.active,
      })
      setApiKeys(prev => prev.map(k => k.id === editKey.id ? { ...k, ...updated } : k))
      setEditKey(null)
      toast.success('API key atualizada.')
    } catch (err: any) {
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao salvar.', variant: 'danger' })
    }
  }

  if (loading) return <Loading label="Carregando webhooks…" />

  // ── Sub-renders ───────────────────────────────────────────────────────────

  /** Os três primeiros e quantos sobram, em texto. */
  const summary = (list: string[], rest: string) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` +${list.length - 3} ${rest}` : ''}`
  const projectNames = (ids: string[]) => (ids.length === 0 ? 'Todos os projetos' : ids.map(id => projectById[id] ?? id).join(', '))

  const eventChecklist = (
    <EventChecklist groups={eventGroups} selected={form.events || []} onToggle={toggleEvent}
      onToggleGroup={selectGroup} onExample={loadExample} loadingExample={loadingExample} />
  )

  const scopeChecklist = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
        Escolha <b>o que</b> esta key pode fazer. Uma key vazada só expõe o que foi liberado para ela.
        Em cada projeto ela age com o <b>seu papel</b> ali: como membro, não configura o projeto (status, sprints, membros…).
      </div>
      {Object.entries(scopeGroups).map(([group, list]) => (
        <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-1)' }}>{group}</span>
            <Btn variant='ghost' size='xs' onClick={() => selectScopeGroup(group)}>
              {list.every(s => (form.scopes || []).includes(s)) ? 'Desmarcar grupo' : 'Selecionar grupo'}
            </Btn>
          </div>
          <div>
            {list.map(s => {
              const active = (form.scopes || []).includes(s)
              const meta = SCOPE_META[s] ?? { label: s, description: '' }
              return (
                <div key={s} onClick={() => toggleScope(s)} style={{ display: 'flex', gap: 14, padding: '12px 0', alignItems: 'center', cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                  <Toggle value={active} onChange={() => toggleScope(s)} label={meta.label} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>{meta.label}</span>
                      <code style={{ fontSize: 12, color: 'var(--text-3)' }}>{s}</code>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{meta.description}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  // No lugar dos filtros de chamado e da trava de empresa: os projetos que o webhook/key alcança.
  const projectsUI = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
        <b>Projetos:</b> {wizardDir === 'out' || editOut ? 'o webhook só dispara para eventos dos projetos marcados.' : 'a key só enxerga e altera os projetos marcados.'}{' '}
        {isAdmin
          ? <>Sem nenhum marcado, vale para <b>todos os projetos</b>, inclusive os criados depois.</>
          : <>Aparecem os projetos em que você é <b>dono, gerente ou membro</b>; "todos os projetos" só o administrador cria.</>}
      </div>
      <Field label={`Projetos (${(form.projectIds || []).length === 0 ? (isAdmin ? 'todos' : 'nenhum') : form.projectIds.length})`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pickableProjects.map(p => (
            <FilterChip key={p.id} label={p.name} active={(form.projectIds || []).includes(p.id)} onClick={() => toggleProject(p.id)} />
          ))}
          {pickableProjects.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Nenhum projeto disponível.</span>}
        </div>
      </Field>
    </div>
  )

  const hmacHelp = (
    <details className="prj-details">
      <summary>
        Como o destino valida a assinatura (para o time técnico)
      </summary>
      <pre className="prj-code">
{`Cabeçalhos enviados em cada POST:
  X-Projects-Event:      task.created
  X-Projects-Timestamp:  2026-07-16T14:32:00.000Z
  X-Projects-Signature:  sha256=<hex>

Validação no destino:
  esperado = HMAC_SHA256(secret, timestamp + "." + corpo_bruto)
  aceitar se "sha256=" + esperado == assinatura recebida`}
      </pre>
    </details>
  )

  const curlExamples = (k: ProjectApiKey) => {
    const firstProject = k.projectIds[0] ? projects.find(p => p.id === k.projectIds[0]) : null
    const ctx: CurlCtx = { project: firstProject ? { id: firstProject.id, name: firstProject.name } : null }
    const blocks = (k.scopes || []).filter(s => SCOPE_EXAMPLE[s]).map(s => ({ scope: s, spec: SCOPE_EXAMPLE[s](ctx) }))
    if (blocks.length === 0) return null
    return (
      <details open className="prj-details">
        <summary>
          Exemplos completos para o sistema externo (Power Automate, Esquema JSON, curl)
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {blocks.map(b => (
            <div key={b.scope} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
                {SCOPE_META[b.scope]?.label ?? b.scope} <code style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{b.spec.method} {b.spec.path.split('?')[0]}</code>
              </div>
              <ApiExample spec={b.spec} apiKey={k.key || '<api-key>'} onCopied={(what) => setAlertInfo({ title: 'Copiado', message: `${what} copiado para a área de transferência.`, variant: 'primary' })} />
            </div>
          ))}
        </div>
      </details>
    )
  }

  const oneTimeWarning = (
    <p className="notice" style={{ margin: 0 }}>Por segurança, este valor <b>não será exibido novamente</b>. Se perder, use "Regenerar" na edição.</p>
  )

  const outDocs = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <DocSection title='Como funciona'>
          1. Crie o webhook informando a <b>URL de destino</b>, os <b>eventos de gatilho</b> (ex.: task criada, comentário criado) e os <b>projetos</b> que ele escuta.<br />
          2. Copie o <b>secret</b> exibido na criação — ele não aparece novamente (use "Regenerar secret" se perder).<br />
          3. A cada evento selecionado, enviamos um <b>POST</b> com JSON assinado (HMAC-SHA256) para a URL cadastrada.<br />
          4. Use o botão <b>"Testar"</b> no card do webhook para disparar um evento <code style={{ fontSize: 12 }}>webhook.test</code> e confirmar que o destino está acessível.<br />
          5. Use <b>"Logs"</b> para ver o histórico de entregas (status, HTTP de resposta, duração) e <b>"Esquemas"</b> para copiar o JSON Schema de cada evento.
        </DocSection>

        <DocSection title='Catálogo de eventos disponíveis'>
          {Object.entries(eventGroups).map(([group, list]) => (
            <div key={group} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'none', letterSpacing: '0', marginBottom: 4 }}>{group}</div>
              <DocTable
                head={['Evento', 'Quando dispara']}
                rows={list.map(ev => [<code>{ev.event}</code>, ev.description])}
              />
            </div>
          ))}
        </DocSection>

        <DocSection title='Envelope do payload'>
          Todo evento chega com o mesmo envelope; <code style={{ fontSize: 12 }}>data</code> muda de formato conforme o evento (veja "Ver payload"/"Esquemas" para o exemplo exato de cada um).
          Eventos de task trazem a <b>task completa</b> em <code style={{ fontSize: 12 }}>data.task</code>: descrição, status, responsáveis e criador com nome e e-mail, tipo, sprint, lista, tags, campos personalizados, checklist, subtasks, dependências, documentos, chamados vinculados, comentários e o link da task.
          <CodeBlock>{`{
  "id": "evt_0a1b2c3d…",
  "event": "task.created",
  "timestamp": "2026-07-16T14:32:00.000Z",
  "project": { "id": "uuid", "name": "Portal" },
  "actor": { "id": "uuid", "name": "João Silva" },
  "data": { "task": { "id": "uuid", "typeKey": "BUG-7", "title": "...", "description": "...", "status": { "name": "A fazer" }, ... } }
}`}</CodeBlock>
        </DocSection>

        <DocSection title='Validando a assinatura (para o time técnico do destino)'>
          Cada requisição chega com estes cabeçalhos:
          <CodeBlock>{`X-Projects-Event:      task.created
X-Projects-Timestamp:  2026-07-16T14:32:00.000Z
X-Projects-Signature:  sha256=<hex>
X-Projects-Delivery:   evt_<id>   (igual em reenvios — use para não processar duas vezes)

Validação no destino:
  esperado = HMAC_SHA256(secret, timestamp + "." + corpo_bruto)
  aceitar se "sha256=" + esperado === assinatura recebida`}</CodeBlock>
        </DocSection>

        <DocSection title='Reenvio automático em caso de falha'>
          Se o destino não responder <b>HTTP 2xx</b> em até 10s, tentamos novamente automaticamente após <b>1 min, 5 min, 30 min e 2h</b> (5 tentativas no total).
          Depois da última tentativa, a entrega fica marcada como <b>falha</b> — é possível reenviar manualmente pela tela de <b>Logs</b>. O histórico de entregas fica disponível por 30 dias.
        </DocSection>

        <DocSection title='Projetos'>
          Cada webhook escuta os projetos marcados. Dono, gerente ou membro do projeto pode criar; leitor não. Sem nenhum projeto marcado ele recebe de <b>todos os projetos</b>, inclusive os criados depois — esse tipo só o administrador cria.
          Quem criou precisa continuar participando do projeto: se sair dele ou virar leitor, o webhook para de receber os eventos daquele projeto.
        </DocSection>

        <DocSection title='Desativar / reativar'>
          Um webhook <b>inativo</b> deixa de disparar imediatamente (sem apagar histórico). Reative a qualquer momento pelo toggle no card.
        </DocSection>

        <DocSection title='Power Automate / Zapier / n8n'>
          No card do webhook, use <b>"Esquemas"</b> para copiar o Esquema JSON (draft-07) de cada evento — cole no campo <i>"Solicitar Esquema JSON do Corpo"</i> do Power Automate para estruturar os dados recebidos automaticamente, sem precisar da etapa "gerar a partir de um exemplo". "Ver payload" (no checklist de eventos) mostra um exemplo de JSON real que também pode ser usado para essa geração.
        </DocSection>
    </div>
  )

  const keysDocs = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <DocSection title='Como funciona'>
          1. Crie a API key escolhendo os <b>projetos</b> e as <b>permissões (escopos)</b> que ela terá.<br />
          2. Copie a <b>key</b> exibida na criação — ela não aparece novamente (use "Regenerar" se perder).<br />
          3. O sistema externo chama os endpoints REST abaixo, base <code style={{ fontSize: 12 }}>{apiBaseUrl()}/projects</code>, com a key no cabeçalho.<br />
          4. Tudo o que a key faz aparece no histórico como <b>"API · nome da key"</b> e passa pelas mesmas regras da tela (notificações, automações e webhooks disparam igual).
        </DocSection>

        <DocSection title='Autenticação'>
          Envie a key no cabeçalho <code style={{ fontSize: 12 }}>Authorization: Bearer &lt;key&gt;</code> (ou <code style={{ fontSize: 12 }}>X-Api-Key: &lt;key&gt;</code>).
          <DocTable
            head={['Situação', 'HTTP', 'code']}
            rows={[
              ['Key ausente', <code>401</code>, <code>API_KEY_MISSING</code>],
              ['Key inválida/inativa (ou quem criou foi desativado)', <code>401</code>, <code>API_KEY_INVALID</code>],
              ['Key sem o escopo exigido pelo endpoint', <code>403</code>, <code>API_KEY_SCOPE_DENIED</code>],
              ['Ação de dono/gerente com key de membro', <code>403</code>, <code>API_KEY_ROLE_DENIED</code>],
              ['Projeto ou task fora do alcance da key', <code>404</code>, <code>NOT_FOUND</code>],
            ]}
          />
        </DocSection>

        <DocSection title='Escopos (permissões) por endpoint'>
          <DocTable
            head={['Escopo', 'Libera']}
            rows={Object.keys(SCOPE_META).map(s => [<code>{s}</code>, SCOPE_META[s].label])}
          />
        </DocSection>

        <DocSection title='Papel da key em cada projeto'>
          A key age com o <b>papel de quem a criou</b> em cada projeto. Dono, gerente ou administrador: poder de <b>gerente</b> (configura o projeto, gerencia membros — sem mexer em donos — e arquiva tasks).
          Membro: cria e edita tasks, comentários, documentos, anexos e vínculos com chamados, mas não configura o projeto (<code style={{ fontSize: 12 }}>403 API_KEY_ROLE_DENIED</code>).
          Se quem criou sair do projeto ou virar leitor, a key perde aquele projeto.
        </DocSection>

        <DocSection title='Endpoints'>
          <DocTable
            head={['Método', 'Caminho', 'Escopo']}
            rows={[
              ['GET · POST', <code>/projects</code>, 'read_projects / write_projects (criar: key de todos os projetos)'],
              ['GET · PATCH', <code>/projects/{'{projeto}'}</code>, 'read_projects / write_projects'],
              ['GET · POST', <code>/projects/{'{projeto}'}/members</code>, 'read_members / write_members'],
              ['PATCH · DELETE', <code>/projects/{'{projeto}'}/members/{'{user_id}'}</code>, 'write_members'],
              ['GET · POST', <code>/projects/{'{projeto}'}/statuses · /lists · /folders · /task-types · /sprints · /tags · /custom-fields</code>, 'read_structure / write_structure'],
              ['PATCH', <code>/projects/{'{projeto}'}/statuses/{'{id}'} · /task-types/{'{id}'} · /sprints/{'{id}'}</code>, 'write_structure'],
              ['POST', <code>/projects/{'{projeto}'}/sprints/{'{id}'}/start · /complete</code>, 'write_structure'],
              ['GET · POST', <code>/projects/{'{projeto}'}/tasks</code>, 'read_tasks / write_tasks'],
              ['GET · PATCH · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}</code>, 'read_tasks / write_tasks'],
              ['POST', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/complete</code>, 'write_tasks'],
              ['GET · PUT', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/assignees</code>, 'read_tasks / write_tasks'],
              ['GET · POST · PATCH · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/checklist</code>, 'read_tasks / write_tasks'],
              ['POST · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/tags/{'{tag}'}</code>, 'write_tasks'],
              ['PUT', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/custom-fields/{'{campo}'}</code>, 'write_tasks'],
              ['GET · POST · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/dependencies</code>, 'read_tasks / write_tasks'],
              ['GET · POST · PATCH · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/comments</code>, 'read_comments / write_comments'],
              ['GET · POST · PATCH', <code>/projects/{'{projeto}'}/documents</code>, 'read_documents / write_documents'],
              ['POST · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/documents/{'{doc}'}</code>, 'write_documents'],
              ['GET · POST', <code>/projects/{'{projeto}'}/attachments</code>, 'read_attachments / write_attachments'],
              ['GET', <code>/projects/{'{projeto}'}/time · /dashboard · /workload · /tasks/{'{task}'}/time</code>, 'read_time'],
              ['GET · POST · DELETE', <code>/projects/{'{projeto}'}/tasks/{'{task}'}/tickets</code>, 'read_tickets / write_tickets'],
            ]}
          />
          <code style={{ fontSize: 12 }}>{'{task}'}</code> aceita o id, o ID do tipo (<code style={{ fontSize: 12 }}>BUG-12</code>) ou o número (<code style={{ fontSize: 12 }}>142</code>). Campos em <b>snake_case</b> na entrada e na saída.
        </DocSection>

        <DocSection title='Task completa'>
          <code style={{ fontSize: 12 }}>GET /tasks</code>, <code style={{ fontSize: 12 }}>GET /tasks/{'{task}'}</code> e as respostas de criar/editar trazem a task inteira:
          <CodeBlock>{JSON.stringify(SAMPLE_TASK, null, 2)}</CodeBlock>
        </DocSection>

        <DocSection title='Listas e paginação'>
          <code style={{ fontSize: 12 }}>GET /projects</code> e <code style={{ fontSize: 12 }}>GET /tasks</code> aceitam <code style={{ fontSize: 12 }}>?page=&per_page=</code> (máx. 100) e respondem <code style={{ fontSize: 12 }}>{'{ data, pagination: { page, per_page, total, total_pages } }'}</code>.
          Filtros de tasks: <code style={{ fontSize: 12 }}>status_id, assignee_id, sprint_id, list_id, parent_id, updated_since, include_archived, order</code>.
        </DocSection>

        <DocSection title='Evitando duplicidade (idempotência)'>
          Operações de escrita aceitam <code style={{ fontSize: 12 }}>external_request_id</code> (string única escolhida por você).
          <DocTable
            head={['Situação anterior', 'Comportamento']}
            rows={[
              ['Sucesso', <>Devolve o mesmo resultado, <code>duplicate: true</code>, sem executar de novo</>],
              ['Em processamento', <><code>409 API_REQUEST_IN_FLIGHT</code></>],
              ['Falhou', 'Reprocessa (reaproveita o mesmo registro de log)'],
              ['Sem external_request_id', 'Tratado sempre como uma requisição nova'],
            ]}
          />
        </DocSection>

        <DocSection title='Erros — formato padrão'>
          <code style={{ fontSize: 12 }}>{'{ "error": "mensagem", "code": "CODIGO", "details"?: any }'}</code>
          <DocTable
            head={['code', 'HTTP', 'Significado']}
            rows={[
              [<code>VALIDATION_ERROR</code>, '400', 'Payload não passou na validação (ver details)'],
              [<code>CROSS_PROJECT_REFERENCE</code>, '400', 'Status, lista, sprint, tipo, task ou anexo de outro projeto'],
              [<code>ASSIGNEE_NOT_MEMBER</code>, '400', 'Responsável precisa ser membro do projeto'],
              [<code>TASK_COMPLETION_BLOCKED</code>, '409', 'Checklist, subtasks ou dependências pendentes impedem concluir'],
              [<code>OWNER_ONLY</code>, '403', 'Donos do projeto só são alterados pela tela'],
              [<code>API_REQUEST_IN_FLIGHT</code>, '409', 'Mesmo external_request_id ainda em processamento'],
            ]}
          />
        </DocSection>

        <DocSection title='Rate limit'>
          60 requisições/minuto por API key + IP. Acima disso, <code style={{ fontSize: 12 }}>429 RATE_LIMIT_EXCEEDED</code>.
        </DocSection>

        <DocSection title='Acompanhando as requisições recebidas'>
          No card da key, use <b>"Requisições"</b> para ver cada escrita recebida: método, caminho, status, recurso criado/afetado, mensagem de erro e o payload bruto enviado. Leituras (GET) não entram no log.
        </DocSection>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader
        title='Integrações'
        subtitle='Avise outros sistemas quando algo acontecer aqui, ou deixe que eles leiam e criem projetos e tasks'
        actions={<Btn size='sm' onClick={openWizard}>Novo</Btn>}
      />
      <div className="prj-body" style={{ flex: 1, overflowY: 'auto', gap: 16 }}>
        <div role='tablist' className='subtabs'>
          {([
            { key: 'out' as Tab, label: 'Saída, avisamos outros sistemas', count: endpoints.length },
            { key: 'keys' as Tab, label: 'API externa, outros sistemas nos chamam', count: apiKeys.length },
          ]).map(t => (
            <button key={t.key} type='button' role='tab' aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label} ({t.count})</button>
          ))}
        </div>

        <div className='notice'>
          {tab === 'out'
            ? 'Cadastre a URL do sistema que deve ser avisado, escolha os eventos e os projetos. A cada evento enviamos um POST JSON assinado (HMAC-SHA256) com a task completa. Se o destino estiver fora do ar, tentamos de novo até 5 vezes.'
            : 'Crie uma API key com os projetos e as permissões que ela precisa. O sistema externo chama os endpoints REST de /integrations/v1/projects com a key no cabeçalho e lê ou cria projetos, tasks, comentários e documentos.'}
          {' '}<button type='button' className='prj-link' onClick={() => setDocsOpen(true)}>Documentação</button>
        </div>

        {tab === 'out' && endpoints.length > 0 && (
          <div className='prj-scroll'>
            <table className='table prj' style={{ minWidth: 1080 }}>
              <thead><tr>{['Webhook', 'Eventos', 'Projetos', 'Entregas', 'Ativo', ''].map(h => <th key={h} scope='col'>{h}</th>)}</tr></thead>
              <tbody>
                {endpoints.map(ep => (
                  <tr key={ep.id}>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ color: 'var(--text-1)', fontWeight: 500, overflowWrap: 'anywhere' }}>{ep.name}</div>
                      <div className='prj-clip' title={ep.url}>{ep.url}</div>
                    </td>
                    <td>{summary(ep.events, 'eventos')}</td>
                    <td>{projectNames(ep.projectIds)}</td>
                    <td><DeliveryHealth summary={ep.recentDeliveries} /></td>
                    <td><Toggle value={ep.active} onChange={() => toggleActive(ep, 'out')} size={16} label={ep.active ? `Pausar ${ep.name}` : `Ativar ${ep.name}`} /></td>
                    <td className='num'>
                      <Btn variant='ghost' size='xs' onClick={() => openLogs(ep)}>Logs</Btn>
                      <Btn variant='ghost' size='xs' disabled={testing === ep.id} onClick={() => testEndpoint(ep)}>{testing === ep.id ? 'Enviando…' : 'Testar'}</Btn>
                      <Btn variant='ghost' size='xs' onClick={() => setSchemasFor(ep)}>Esquemas</Btn>
                      <button type='button' className='icon-act' aria-label={`Editar ${ep.name}`} onClick={() => { setForm({ name: ep.name, url: ep.url, events: [...ep.events], active: ep.active, projectIds: [...ep.projectIds] }); setEditOut(ep) }}><Edit size={16} /></button>
                      <button type='button' className='icon-act danger' aria-label={`Excluir ${ep.name}`} onClick={() => removeOut(ep)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'keys' && apiKeys.length > 0 && (
          <div className='prj-scroll'>
            <table className='table prj' style={{ minWidth: 1080 }}>
              <thead><tr>{['API key', 'Permissões', 'Projetos', 'Uso', 'Ativa', ''].map(h => <th key={h} scope='col'>{h}</th>)}</tr></thead>
              <tbody>
                {apiKeys.map(k => (
                  <tr key={k.id}>
                    <td>
                      <div style={{ color: 'var(--text-1)', fontWeight: 500, overflowWrap: 'anywhere' }}>{k.name}</div>
                      <div className='prj-clip'>{k.keyPrefix}… · age como "API · {k.name}"</div>
                    </td>
                    <td>{summary(k.scopes.map(s => SCOPE_META[s]?.label || s), 'permissões')}</td>
                    <td>{projectNames(k.projectIds)}</td>
                    <td>{k.requestsCount ?? 0} requisição(ões){k.lastUsedAt ? `, última ${fmtDate(k.lastUsedAt)}` : ''}</td>
                    <td><Toggle value={k.active} onChange={() => toggleActive(k, 'keys')} size={16} label={k.active ? `Pausar ${k.name}` : `Ativar ${k.name}`} /></td>
                    <td className='num'>
                      <Btn variant='ghost' size='xs' onClick={() => openKeyRequests(k)}>Requisições</Btn>
                      <button type='button' className='icon-act' aria-label={`Editar ${k.name}`} onClick={() => { setForm({ name: k.name, scopes: [...k.scopes], projectIds: [...k.projectIds], active: k.active }); setEditKey(k) }}><Edit size={16} /></button>
                      <button type='button' className='icon-act danger' aria-label={`Excluir ${k.name}`} onClick={() => removeKey(k)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {((tab === 'out' && endpoints.length === 0) || (tab === 'keys' && apiKeys.length === 0)) && (
          <div>
            <p className='prj-note' style={{ marginBottom: 8 }}>Nenhum{tab === 'out' ? ' webhook de saída' : 'a API key'} cadastrad{tab === 'out' ? 'o' : 'a'} ainda.</p>
            <Btn variant='secondary' size='sm' onClick={openWizard}>Criar {tab === 'out' ? 'o primeiro' : 'a primeira'}</Btn>
          </div>
        )}
      </div>

      {/* ── Wizard de criação ── */}
      {wizardOpen && (
        <Modal isOpen={wizardOpen} onClose={() => setWizardOpen(false)} width={620}
          title={wizardStep === (wizardDir === 'out' ? 4 : 3) ? (wizardDir === 'out' ? 'Webhook criado' : 'API key criada') : `Novo — passo ${wizardStep} de ${wizardDir === 'out' ? 3 : 2}`}
          footer={wizardStep === (wizardDir === 'out' ? 4 : 3)
            ? <Btn onClick={() => setWizardOpen(false)}>Concluir</Btn>
            : <>
              <Btn variant='secondary' onClick={() => wizardStep === 1 ? setWizardOpen(false) : setWizardStep(wizardStep - 1)}>{wizardStep === 1 ? 'Cancelar' : 'Voltar'}</Btn>
              <Btn onClick={wizardNext} disabled={saving}>
                {saving ? 'Criando…' : (wizardDir === 'out' ? (wizardStep < 3 ? 'Avançar' : 'Criar webhook') : (wizardStep === 1 ? 'Avançar' : 'Criar API key'))}
              </Btn>
            </>}>

          {wizardStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label='O que você quer fazer?'>
                <div>
                  {([
                    { dir: 'out' as Tab, title: 'Enviar avisos para outro sistema', desc: 'Quando algo acontecer em Projetos (ex.: task criada, comentário), avisamos uma URL externa.' },
                    { dir: 'keys' as Tab, title: 'Deixar outro sistema nos chamar', desc: 'Gere uma API key com permissões — o sistema externo lê e cria projetos, tasks e comentários via API REST.' },
                  ]).map(opt => (
                    <button key={opt.dir} type='button' className='prj-choice' aria-pressed={wizardDir === opt.dir} onClick={() => setWizardDir(opt.dir)}>
                      <b>{opt.title}</b>{opt.desc}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={wizardDir === 'out' ? 'Nome do webhook' : 'Nome da API key'} required>
                <Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={wizardDir === 'out' ? 'Ex.: Alertas no Teams (Projetos)' : 'Ex.: Power Automate — onboarding'} maxLength={wizardDir === 'out' ? 120 : 80} showCount />
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{wizardDir === 'out' ? 'Só para identificação interna — aparece na listagem e nos logs.' : 'Aparece na listagem, nos logs e no histórico das tasks como "API · nome".'}</div>
              </Field>
              {wizardDir === 'out' && (
                <Field label='URL de destino' required>
                  <Inp value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} placeholder='https://sistema-externo.com/webhook' maxLength={500} showCount />
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Para onde enviaremos o POST JSON. Você poderá testar depois de criar.</div>
                </Field>
              )}
            </div>
          )}

          {wizardStep === 2 && wizardDir === 'out' && (
            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
              {eventChecklist}
            </div>
          )}

          {wizardStep === 3 && wizardDir === 'out' && (
            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
              {projectsUI}
            </div>
          )}

          {wizardStep === 2 && wizardDir === 'keys' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
              {projectsUI}
              {scopeChecklist}
            </div>
          )}

          {wizardStep === 4 && createdSecret && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Cada envio será assinado com o secret abaixo, para o destino confirmar que fomos nós.</div>
              <Field label='Secret de assinatura — copie agora'>
                <SecretBox value={createdSecret.secret || ''} />
                <div style={{ marginTop: 6 }}><CopyBtn text={createdSecret.secret || ''} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Secret copiado para a área de transferência.', variant: 'primary' })} /></div>
              </Field>
              {oneTimeWarning}
              {hmacHelp}

              <details className="prj-details">
                <summary>
                  Esquema JSON do Payload (para Power Automate / Zapier)
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {form.events && form.events.length > 1 && (
                    <Field label='Selecione o evento'>
                      <Sel value={wizardSchemaEvent} onChange={e => setWizardSchemaEvent(e.target.value)}>
                        {(form.events as string[]).map((ev: string) => (
                          <option key={ev} value={ev}>{ev}</option>
                        ))}
                      </Sel>
                    </Field>
                  )}
                  {loadingWizardSchema ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 0' }}>Gerando esquema...</div>
                  ) : wizardSchema ? (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        Copie este esquema e cole no campo <b>"Solicitar Esquema JSON do Corpo"</b> do Power Automate:
                      </div>
                      <pre className="prj-code" style={{ maxHeight: 200 }}>
                        {JSON.stringify(wizardSchema, null, 2)}
                      </pre>
                      <div>
                        <CopyBtn text={JSON.stringify(wizardSchema, null, 2)} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Esquema JSON copiado para a área de transferência.', variant: 'primary' })} />
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Nenhum esquema disponível.</div>
                  )}
                </div>
              </details>

              <div style={{ marginTop: 4 }}>
                <Btn variant='secondary' size='sm' disabled={testing === createdSecret.id} onClick={() => testEndpoint(createdSecret)}>
                  {testing === createdSecret.id ? 'Enviando ping…' : 'Enviar evento de teste (ping)'}
                </Btn>
              </div>
            </div>
          )}

          {wizardStep === 3 && wizardDir === 'keys' && createdKey && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Entregue ao sistema externo a API key abaixo.</div>
              <Field label='API key — copie agora'>
                <SecretBox value={createdKey.key || ''} />
                <div style={{ marginTop: 6 }}><CopyBtn text={createdKey.key || ''} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'API key copiada.', variant: 'primary' })} /></div>
              </Field>
              {oneTimeWarning}
              {curlExamples(createdKey)}
            </div>
          )}
        </Modal>
      )}

      {/* ── Edição saída ── */}
      {editOut && (
        <Modal isOpen onClose={() => setEditOut(null)} title='Editar webhook de saída' width={620}
          footer={<>
            <Btn variant='secondary' onClick={() => regenerateSecret(editOut)}>Regenerar secret</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant='secondary' onClick={() => setEditOut(null)}>Cancelar</Btn>
            <Btn onClick={saveEditOut}>Salvar</Btn>
          </>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
            <Field label='Nome' required><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} showCount /></Field>
            <Field label='URL de destino' required><Inp value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} maxLength={500} showCount /></Field>
            <Field label='Status'>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Toggle value={form.active} onChange={() => setForm({ ...form, active: !form.active })} label='Webhook ativo' />
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{form.active ? 'Ativo' : 'Inativo'}</span>
              </div>
            </Field>
            {eventChecklist}
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
            {projectsUI}
          </div>
        </Modal>
      )}

      {/* ── Edição API key ── */}
      {editKey && (
        <Modal isOpen onClose={() => setEditKey(null)} title='Editar API key' width={620}
          footer={<>
            <Btn variant='secondary' onClick={() => regenerateKey(editKey)}>Regenerar key</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant='secondary' onClick={() => setEditKey(null)}>Cancelar</Btn>
            <Btn onClick={saveEditKey}>Salvar</Btn>
          </>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
            <Field label='Nome' required><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={80} showCount /></Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Toggle value={form.active !== false} onChange={v => setForm({ ...form, active: v })} label='Key ativa' />
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Key ativa</span>
            </div>
            {projectsUI}
            {scopeChecklist}
          </div>
        </Modal>
      )}

      {/* ── Logs de entregas (saída) ── */}
      {logsFor && (
        <Modal isOpen onClose={() => { setLogsFor(null); setDeliveries(null) }} title={`Entregas — ${logsFor.name}`} width={760}>
          {!deliveries ? (
            <Loading size="compact" />
          ) : deliveries.data.length === 0 ? (
            <p className='prj-note'>Nenhuma entrega registrada ainda.</p>
          ) : (
            <div className='prj-scroll'>
              <table className='table prj'>
                <thead>
                  <tr>
                    {['Evento', 'Status', 'Tentativas', 'HTTP', 'Duração', 'Quando', ''].map(h => (
                      <th key={h}>{h && <SortHeader label={h} {...deliverySort.header(h)} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Ordena só a página carregada */}
                  {deliverySort.apply(deliveries.data, {
                    'Evento': d => d.event,
                    'Status': d => d.status,
                    'Tentativas': d => d.attempts,
                    'HTTP': d => d.responseStatus,
                    'Duração': d => d.durationMs,
                    'Quando': d => new Date(d.createdAt),
                  }).map(d => (
                    <tr key={d.id}>
                      <td>{d.event}</td>
                      <td><StatusText status={d.status} /></td>
                      <td>{d.attempts}{d.status === 'pending' && d.nextRetryAt ? ` · próx. ${fmtDate(d.nextRetryAt)}` : ''}</td>
                      <td title={d.errorMessage || ''}>{d.responseStatus ?? (d.errorMessage ? 'erro' : '—')}</td>
                      <td>{d.durationMs != null ? `${d.durationMs} ms` : '—'}</td>
                      <td>{fmtDate(d.createdAt)}</td>
                      <td>
                        {d.status === 'failed' && <Btn variant='ghost' size='xs' onClick={() => retryDelivery(d)}>Reenviar</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Falhas são retentadas automaticamente (1min → 5min → 30min → 2h). Histórico de 30 dias.</span>
                {deliveries.meta.pages > 1 && (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-2)' }}>
                    <Btn variant='ghost' size='xs' disabled={deliveries.meta.page <= 1} onClick={() => openLogs(logsFor, deliveries.meta.page - 1)}>←</Btn>
                    {deliveries.meta.page} / {deliveries.meta.pages}
                    <Btn variant='ghost' size='xs' disabled={deliveries.meta.page >= deliveries.meta.pages} onClick={() => openLogs(logsFor, deliveries.meta.page + 1)}>→</Btn>
                  </span>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Requisições recebidas (API externa) ── */}
      {reqsForKey && (
        <Modal isOpen onClose={() => { setReqsForKey(null); setKeyRequests(null) }} title={`Requisições — ${reqsForKey.name}`} width={780}>
          {!keyRequests ? (
            <Loading size="compact" />
          ) : keyRequests.data.length === 0 ? (
            <p className='prj-note'>Nenhuma requisição recebida ainda.</p>
          ) : (
            <div className='prj-scroll'>
              <table className='table prj'>
                <thead>
                  <tr>
                    {['Status', 'Método', 'Caminho', 'ID externo', 'Recurso', 'Erro', 'Quando', ''].map(h => (
                      <th key={h}>{h && <SortHeader label={h} {...requestSort.header(h)} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requestSort.apply(keyRequests.data, {
                    'Status': r => r.status,
                    'Método': r => r.method,
                    'Caminho': r => r.path,
                    'ID externo': r => r.externalRequestId,
                    'Recurso': r => r.resourceType,
                    'Erro': r => r.errorMessage,
                    'Quando': r => new Date(r.createdAt),
                  }).map(r => (
                    <>
                      <tr key={r.id}>
                        <td><StatusText status={r.status} /></td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{r.method}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{r.path}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{r.externalRequestId || '—'}</td>
                        <td>{r.resourceType ? `${r.resourceType} ${r.resourceId ?? ''}` : '—'}</td>
                        <td style={{ color: r.errorMessage ? 'var(--danger)' : undefined, maxWidth: 160, overflow: 'hidden' }}><TruncatedText text={r.errorMessage || '—'} style={{ display: 'block' }} /></td>
                        <td>{fmtDate(r.createdAt)}</td>
                        <td>
                          <Btn variant='ghost' size='xs' onClick={() => setExpandedReq(expandedReq === r.id ? null : r.id)}>{expandedReq === r.id ? 'Ocultar' : 'Payload'}</Btn>
                        </td>
                      </tr>
                      {expandedReq === r.id && (
                        <tr key={`${r.id}-payload`}>
                          <td colSpan={8}>
                            <pre className="prj-code" style={{ maxHeight: 220 }}>{JSON.stringify(r.requestPayload, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {keyRequests.meta.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>
                  <Btn variant='ghost' size='xs' disabled={keyRequests.meta.page <= 1} onClick={() => openKeyRequests(reqsForKey, keyRequests.meta.page - 1)}>←</Btn>
                  {keyRequests.meta.page} / {keyRequests.meta.pages}
                  <Btn variant='ghost' size='xs' disabled={keyRequests.meta.page >= keyRequests.meta.pages} onClick={() => openKeyRequests(reqsForKey, keyRequests.meta.page + 1)}>→</Btn>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── Secret/key regenerado (one-time) ── */}
      {!wizardOpen && createdSecret?.secret && (
        <Modal isOpen onClose={() => setCreatedSecret(null)} title='Novo secret gerado' width={560}
          footer={<Btn onClick={() => setCreatedSecret(null)}>Concluir</Btn>}>
          <Field label='Secret de assinatura — copie agora'>
            <SecretBox value={createdSecret.secret} />
            <div style={{ marginTop: 6 }}><CopyBtn text={createdSecret.secret} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Secret copiado.', variant: 'primary' })} /></div>
          </Field>
          {oneTimeWarning}
          {hmacHelp}
        </Modal>
      )}
      {!wizardOpen && createdKey?.key && (
        <Modal isOpen onClose={() => setCreatedKey(null)} title='Nova API key gerada' width={560}
          footer={<Btn onClick={() => setCreatedKey(null)}>Concluir</Btn>}>
          <Field label='API key — copie agora'>
            <SecretBox value={createdKey.key} />
            <div style={{ marginTop: 6 }}><CopyBtn text={createdKey.key} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'API key copiada.', variant: 'primary' })} /></div>
          </Field>
          {oneTimeWarning}
          {curlExamples(createdKey)}
        </Modal>
      )}

      {/* ── JSON de exemplo do evento (para gerar schema em Power Automate, Zapier, n8n…) ── */}
      {exampleFor && (
        <PayloadExampleModal event={exampleFor.event} payload={exampleFor.payload} schema={exampleFor.schema}
          sender='a área de Projetos'
          onClose={() => setExampleFor(null)}
          onCopied={message => setAlertInfo({ title: 'Copiado', message, variant: 'primary' })} />
      )}

      {schemasFor && (
        <Modal isOpen onClose={() => { setSchemasFor(null); setWizardSchemaEvent(''); setWizardSchema(null) }} title={`Esquemas JSON — ${schemasFor.name}`} width={560}
          footer={<Btn onClick={() => { setSchemasFor(null); setWizardSchemaEvent(''); setWizardSchema(null) }}>Fechar</Btn>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Selecione um dos eventos deste webhook para visualizar e copiar o Esquema JSON correspondente (usado no Power Automate, Zapier, etc.).
            </div>

            <Field label='Selecione o evento'>
              <Sel value={wizardSchemaEvent} onChange={(e: any) => setWizardSchemaEvent(e.target.value)}>
                <option value=''>— Selecione um evento —</option>
                {(schemasFor.events as string[]).map((ev: string) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </Sel>
            </Field>

            {loadingWizardSchema ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 0' }}>Gerando esquema...</div>
            ) : wizardSchema ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Esquema JSON pronto para o campo <b>"Solicitar Esquema JSON do Corpo"</b>:
                </div>
                <pre className="prj-code" style={{ maxHeight: 240 }}>
                  {JSON.stringify(wizardSchema, null, 2)}
                </pre>
                <div>
                  <CopyBtn text={JSON.stringify(wizardSchema, null, 2)} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Esquema JSON copiado para a área de transferência.', variant: 'primary' })} />
                </div>
              </>
            ) : wizardSchemaEvent ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Nenhum esquema disponível.</div>
            ) : null}
          </div>
        </Modal>
      )}

      {docsOpen && (
        <Modal isOpen onClose={() => setDocsOpen(false)}
          title={tab === 'out' ? 'Documentação — Webhooks de saída (Projetos)' : 'Documentação — API externa de Projetos'}
          width={780}
          footer={<Btn onClick={() => setDocsOpen(false)}>Fechar</Btn>}>
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
            {tab === 'out' ? outDocs : keysDocs}
          </div>
        </Modal>
      )}

      {confirm && (
        <ConfirmModal isOpen onClose={() => setConfirm(null)} onConfirm={confirm.onConfirm}
          title={confirm.title} message={confirm.message} confirmText='Confirmar' variant='danger' />
      )}
      {alertInfo && (
        <AlertModal isOpen onClose={() => setAlertInfo(null)} title={alertInfo.title} message={alertInfo.message} variant={alertInfo.variant} />
      )}
    </div>
  )
}
