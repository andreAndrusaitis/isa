import { toast } from '@/store/toastStore'
import { Fragment, useState, useEffect, useMemo, type ReactNode } from 'react'
import { webhookService } from '@/services/webhookService'
import { apiKeyService } from '@/services/apiKeyService'
import { adminService } from '@/services/adminService'
import { Btn, Field, Inp, Sel, Toggle, PageHeader, Modal, ConfirmModal, AlertModal, SortHeader, TruncatedText, SearchableSelect, Loading } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { CheckRow, CopyBtn, SecretBox, CodeBlock, DocTable, DocSection, FilterChip, EventChecklist, DeliveryHealth, GroupHead, PayloadExampleModal, ApiExample } from '@/components/webhooks/WebhookParts'
import { apiBaseUrl, type ApiExampleSpec } from '@/components/webhooks/apiExamples'
import { Pencil, Trash2 } from 'lucide-react'
import type {
  WebhookEndpoint, WebhookDelivery, WebhookEventInfo,
  ApiKey, ApiKeyScope, ApiRequestLog, Paginated,
} from '@/types'
import './admin.css'

type Tab = 'out' | 'keys'

const SCOPE_META: Record<ApiKeyScope, { group: string; label: string; description: string }> = {
  create_ticket:      { group: 'Escrita', label: 'Criar chamado', description: 'Abre um ticket com os dados recebidos. O caso mais comum (monitoramento, portais).' },
  update_ticket:      { group: 'Escrita', label: 'Atualizar chamado', description: 'Muda status, prioridade, fila ou adiciona nota em um chamado existente.' },
  close_ticket:       { group: 'Escrita', label: 'Resolver/fechar chamado', description: 'Permite usar a API dedicada para marcar um chamado como resolvido ou fechado.' },
  create_user:        { group: 'Escrita', label: 'Criar usuário', description: 'Provisiona um usuário final vinculado a uma organização.' },
  update_user:        { group: 'Escrita', label: 'Atualizar usuário', description: 'Altera dados ou desativa um usuário existente.' },
  read_categories:    { group: 'Leitura', label: 'Ler categorias', description: 'Lista categorias ativas — para montar o payload de criação de chamado.' },
  read_subcategories: { group: 'Leitura', label: 'Ler subcategorias', description: 'Lista subcategorias ativas, filtráveis por categoria.' },
  read_queues:        { group: 'Leitura', label: 'Ler filas', description: 'Lista filas ativas.' },
  read_organizations: { group: 'Leitura', label: 'Ler organizações', description: 'Lista empresas — só a própria, se a key estiver travada numa empresa.' },
  read_tickets: { group: 'Leitura', label: 'Ler chamados', description: 'Lista e consulta chamados — só da própria empresa, se a key estiver travada numa empresa.' },
  read_messages: { group: 'Leitura', label: 'Ler conversa do chamado', description: 'Lista as mensagens públicas de um chamado (sem notas internas).' },
  create_message: { group: 'Escrita', label: 'Responder como solicitante', description: 'Envia mensagem (com anexos) em nome do solicitante do chamado — o e-mail precisa ser o dele.' },
}

const DELIVERY_LABEL: Record<string, string> = { success: 'Entregue', pending: 'Pendente', failed: 'Falhou' }
const REQUEST_LABEL: Record<string, string> = { success: 'Sucesso', duplicate: 'Duplicada', processing: 'Processando', received: 'Recebida', failed: 'Falhou' }
const statusText = (status: string, labels: Record<string, string>) =>
  <span style={status === 'failed' ? { color: 'var(--danger)' } : undefined}>{labels[status] ?? status}</span>
/** Os três primeiros em texto e quantos faltam. */
const brief = (list: string[]) => list.slice(0, 3).join(', ') + (list.length > 3 ? ` e mais ${list.length - 3}` : '')

type CurlCtx = {
  /** null quando a key é multi-empresa (sem organization_id travado) */
  org: { id: string; name: string } | null
  category: { id: string; name: string } | null
  subcategory: { id: string; name: string } | null
}


const sampleEmail = (ctx: CurlCtx) => ctx.org ? `pessoa@${ctx.org.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com.br` : 'pessoa@empresa-do-cliente.com'
const ORG_HINT = '<uuid-da-empresa — use GET /organizations, ou omita e o domínio do e-mail resolve a empresa>'
const SAMPLE_TICKET = {
  id: 'ISA-1001', display_number: 'ISA-1001', title: 'Título do chamado', description: 'Detalhes...',
  status: 'open', priority: 'medium', type: 'incident', queue: 'Service Desk', pending_reason: null,
  sla_deadline: '2026-10-06T18:00:00.000Z', first_response_deadline: '2026-10-05T14:00:00.000Z',
  escalated: false, is_reopened: false, resolution_details: null, resolved_at: null, closed_at: null,
  created_at: '2026-10-05T12:00:00.000Z', updated_at: '2026-10-05T12:30:00.000Z',
  org: { id: 'uuid', name: 'Empresa' },
  category: { id: 'uuid', name: 'Categoria' },
  subcategory: { id: 'uuid', name: 'Subcategoria' },
  user: { id: 'uuid', name: 'Solicitante', email: 'pessoa@empresa.com.br' },
  assigned_to: { id: 'uuid', name: 'Analista', email: 'analista@empresa.com.br' },
}
const writeResponse = (type: 'ticket' | 'user', extra: Record<string, any> = {}) => ({ duplicate: false, request_id: 'uuid', resource_type: type, resource_id: type === 'ticket' ? 'ISA-1001' : 'uuid', ...extra })

/** Uma especificação por escopo — curl, passo a passo do Power Automate e JSON Schema saem daqui. */
const SCOPE_EXAMPLE: Partial<Record<ApiKeyScope, (ctx: CurlCtx) => ApiExampleSpec>> = {
  create_ticket: (ctx) => ({
    method: 'POST', path: '/tickets',
    body: {
      external_request_id: 'meu-id-unico-001',
      ...(ctx.org ? {} : { organization_id: ORG_HINT }),
      requester: { email: sampleEmail(ctx) },
      ticket: {
        title: 'Título do chamado',
        description: 'Detalhes...',
        category_id: ctx.category?.id ?? '<uuid-da-categoria — use GET /categories>',
        subcategory_id: ctx.subcategory?.id ?? '<uuid-da-subcategoria — use GET /subcategories>',
      },
    },
    response: writeResponse('ticket', { ticket: SAMPLE_TICKET, attachments: [{ name: 'print.png', size: 1024, type: 'image/png' }] }),
  }),
  update_ticket: () => ({
    method: 'PATCH', path: '/tickets/ISA-1001',
    body: { external_request_id: 'update-001', status: 'resolved', note: 'Resolvido externamente' },
    response: writeResponse('ticket'),
  }),
  close_ticket: () => ({
    method: 'POST', path: '/tickets/ISA-1001/closure',
    body: { external_request_id: 'closure-001', status: 'resolved', note: 'Encerrado pela integração' },
    response: writeResponse('ticket', { ticket: SAMPLE_TICKET }),
  }),
  create_user: (ctx) => ({
    method: 'POST', path: '/users',
    body: { external_request_id: 'user-001', name: 'Nome Sobrenome', email: sampleEmail(ctx), ...(ctx.org ? {} : { organization_id: ORG_HINT }) },
    response: writeResponse('user', { user: { id: 'uuid', name: 'Nome Sobrenome', email: sampleEmail(ctx), role: 'user', org_id: 'uuid', active: true } }),
  }),
  update_user: (ctx) => ({
    method: 'PATCH', path: `/users/${sampleEmail(ctx)}`,
    body: { external_request_id: 'user-update-001', changes: { active: false } },
    response: writeResponse('user'),
  }),
  read_categories: () => ({ method: 'GET', path: '/categories', response: { data: [{ id: 'uuid', name: 'Categoria' }] } }),
  read_subcategories: (ctx) => ({
    method: 'GET', path: `/subcategories?category_id=${ctx.category?.id ?? '<uuid-da-categoria — use GET /categories>'}`,
    response: { data: [{ id: 'uuid', name: 'Subcategoria', category_id: 'uuid', is_special: false, special_form_schema: null, special_title_template: null }] },
  }),
  read_queues: () => ({ method: 'GET', path: '/queues', response: { data: [{ id: 'uuid', name: 'Service Desk' }] } }),
  read_organizations: () => ({ method: 'GET', path: '/organizations', response: { data: [{ id: 'uuid', name: 'Empresa', domains: ['empresa.com.br'] }] } }),
  read_tickets: () => ({
    method: 'GET', path: '/tickets?page=1&per_page=100&updated_since=2026-10-01T00:00:00Z',
    response: { data: [SAMPLE_TICKET], pagination: { page: 1, per_page: 100, total: 1, total_pages: 1 } },
    note: 'Para trazer todos: use "Fazer até" (Do until) incrementando page até page > total_pages. Para sincronizar só o que mudou, guarde o maior updated_at recebido e use como updated_since na próxima execução.',
  }),
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function WebhooksPanel() {
  const [tab, setTab] = useState<Tab>('out')
  const deliverySort = useTableSort<string>()
  const requestSort = useTableSort<string>()
  const [loading, setLoading] = useState(true)
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [scopes, setScopes] = useState<ApiKeyScope[]>([])
  const [events, setEvents] = useState<WebhookEventInfo[]>([])
  const [orgs, setOrgs] = useState<any[]>([])
  const [queues, setQueues] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [managers, setManagers] = useState<any[]>([])

  // Wizard de criação
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardDir, setWizardDir] = useState<Tab>('out')
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<WebhookEndpoint | null>(null)
  const [createdKey, setCreatedKey] = useState<ApiKey | null>(null)

  // Edição
  const [editOut, setEditOut] = useState<WebhookEndpoint | null>(null)
  const [editKey, setEditKey] = useState<ApiKey | null>(null)

  // Logs
  const [logsFor, setLogsFor] = useState<WebhookEndpoint | null>(null)
  const [deliveries, setDeliveries] = useState<Paginated<WebhookDelivery> | null>(null)
  const [reqsForKey, setReqsForKey] = useState<ApiKey | null>(null)
  const [keyRequests, setKeyRequests] = useState<Paginated<ApiRequestLog> | null>(null)
  const [expandedReq, setExpandedReq] = useState<string | null>(null)

  const [exampleFor, setExampleFor] = useState<{ event: string; payload: any; schema: any } | null>(null)
  const [loadingExample, setLoadingExample] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; variant?: 'danger' | 'primary' | 'warning' } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const [wizardSchemaEvent, setWizardSchemaEvent] = useState<string>('')
  const [wizardSchema, setWizardSchema] = useState<any>(null)
  const [loadingWizardSchema, setLoadingWizardSchema] = useState<boolean>(false)
  const [schemasFor, setSchemasFor] = useState<WebhookEndpoint | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)

  const eventGroups = useMemo(() => {
    const groups: Record<string, WebhookEventInfo[]> = {}
    for (const ev of events) (groups[ev.group] ??= []).push(ev)
    return groups
  }, [events])

  const scopeGroups = useMemo(() => {
    const groups: Record<string, ApiKeyScope[]> = {}
    for (const s of scopes) (groups[SCOPE_META[s].group] ??= []).push(s)
    return groups
  }, [scopes])

  const orgById = useMemo(() => Object.fromEntries(orgs.map(o => [o.id, o.name])), [orgs])

  const load = async () => {
    try {
      const [epsRes, keysRes, evsRes, scsRes, orgListRes] = await Promise.allSettled([
        webhookService.getEndpoints(),
        apiKeyService.getKeys(),
        webhookService.getEvents(),
        apiKeyService.getScopes(),
        adminService.getOrganizations(),
      ])
      if (epsRes.status === 'fulfilled') setEndpoints(epsRes.value)
      if (keysRes.status === 'fulfilled') setApiKeys(keysRes.value)
      if (evsRes.status === 'fulfilled') setEvents(evsRes.value)
      if (scsRes.status === 'fulfilled') setScopes(scsRes.value)
      if (orgListRes.status === 'fulfilled') setOrgs(orgListRes.value)
    } catch (err) {
      console.error('[WebhooksPanel] Erro ao carregar webhooks:', err)
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
    webhookService.getEventSchema(wizardSchemaEvent)
      .then(setWizardSchema)
      .catch(err => {
        console.error('Erro ao buscar esquema JSON:', err)
        setWizardSchema(null)
      })
      .finally(() => {
        setLoadingWizardSchema(false)
      })
  }, [wizardSchemaEvent])

  // Dados auxiliares (filtros de saída) — carrega sob demanda
  const loadDefaultsData = () => {
    if (queues.length === 0) {
      adminService.getQueues().then(setQueues).catch(() => {})
      adminService.getCategories().then(setCategories).catch(() => {})
      adminService.getUsers({ role: 'manager,supervisor' }).then(setManagers).catch(() => {})
    }
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  const openWizard = () => {
    setWizardDir(tab); setWizardStep(1)
    setForm({ name: '', url: '', events: [], scopes: [], org_id: null, active: true, filters: {} })
    setCreatedSecret(null); setCreatedKey(null)
    loadDefaultsData()
    if (events.length === 0) {
      webhookService.getEvents().then(setEvents).catch(() => {})
    }
    if (scopes.length === 0) {
      apiKeyService.getScopes().then(setScopes).catch(() => {})
    }
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

  const toggleFilterArray = (key: string, value: string) => {
    const list: string[] = form.filters?.[key] || []
    const isRemoving = list.includes(value)
    const nextList = isRemoving ? list.filter(v => v !== value) : [...list, value]

    let nextFilters = {
      ...form.filters,
      [key]: nextList
    }

    if (key === 'category_ids' && isRemoving) {
      // Se removeu a categoria, removemos também todas as suas subcategorias que estavam marcadas
      const cat = categories.find(c => c.id === value)
      if (cat?.subcategories) {
        const subIds = cat.subcategories.map((s: any) => s.id)
        const currentSubs: string[] = form.filters?.subcategory_ids || []
        nextFilters.subcategory_ids = currentSubs.filter(id => !subIds.includes(id))
      }
    }

    setForm({ ...form, filters: nextFilters })
  }

  const loadExample = async (event: string) => {
    setLoadingExample(event)
    try {
      const [payload, schema] = await Promise.all([
        webhookService.getEventExample(event),
        webhookService.getEventSchema(event),
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

  const wizardNext = async () => {
    if (wizardStep === 1) {
      if (!(form.name || '').trim()) { setAlertInfo({ title: 'Validação', message: 'Dê um nome ao webhook.', variant: 'warning' }); return }
      if (wizardDir === 'out' && !(form.url || '').trim()) { setAlertInfo({ title: 'Validação', message: 'Informe a URL de destino.', variant: 'warning' }); return }
      setWizardStep(2); return
    }

    if (wizardStep === 2 && wizardDir === 'out') {
      if (!form.events?.length) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos um evento de gatilho.', variant: 'warning' }); return }
      setWizardStep(3); return
    }

    if (wizardStep === 2 && wizardDir === 'keys') {
      if (!form.scopes?.length) { setAlertInfo({ title: 'Validação', message: 'Selecione pelo menos uma permissão (escopo).', variant: 'warning' }); return }
    }

    // Passo de criação de fato:
    // Para Saída, é o Passo 3 (depois dos filtros). Para API keys, é o Passo 2.
    setSaving(true)
    try {
      if (wizardDir === 'out') {
        // Remove empty arrays from filters
        const cleanFilters = Object.fromEntries(
          Object.entries(form.filters || {}).filter(([_, v]) => Array.isArray(v) && v.length > 0)
        )

        const created = await webhookService.createEndpoint({ name: form.name.trim(), url: form.url.trim(), events: form.events, active: form.active, filters: Object.keys(cleanFilters).length ? cleanFilters : undefined })
        setCreatedSecret(created)
        setEndpoints(prev => [...prev, { ...created, secret: undefined }])
        setWizardStep(4)
      } else {
        const created = await apiKeyService.createKey({
          name: form.name.trim(), scopes: form.scopes, org_id: form.org_id || null, active: form.active,
        })
        setCreatedKey(created)
        setApiKeys(prev => [...prev, { ...created, key: undefined }])
        setWizardStep(3)
      }
    } catch (err: any) {
      console.error('[WebhooksPanel] Erro ao criar webhook:', err)
      setAlertInfo({ title: 'Erro', message: err?.response?.data?.error || 'Erro ao criar webhook.', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  // ── Ações das linhas ───────────────────────────────────────────────────────
  const toggleActive = async (item: WebhookEndpoint | ApiKey, kind: Tab) => {
    try {
      if (kind === 'out') {
        const updated = await webhookService.updateEndpoint(item.id, { active: !item.active })
        setEndpoints(prev => prev.map(e => e.id === item.id ? { ...e, ...updated } : e))
      } else {
        const updated = await apiKeyService.updateKey(item.id, { active: !item.active })
        setApiKeys(prev => prev.map(k => k.id === item.id ? { ...k, ...updated } : k))
      }
    } catch (err) {
      console.error('[WebhooksPanel] Erro ao ativar/desativar:', err)
      setAlertInfo({ title: 'Erro', message: 'Erro ao alterar o status do webhook.', variant: 'danger' })
    }
  }

  const testEndpoint = async (ep: WebhookEndpoint) => {
    setTesting(ep.id)
    try {
      const result = await webhookService.testEndpoint(ep.id)
      if (result?.status === 'success') {
        setAlertInfo({ title: 'Teste enviado', message: `Ping entregue com sucesso — HTTP ${result.response_status} em ${result.duration_ms} ms.`, variant: 'primary' })
      } else {
        setAlertInfo({ title: 'Teste falhou', message: `O destino não confirmou o recebimento: ${result?.error_message || `HTTP ${result?.response_status ?? '—'}`}. O sistema tentará reenviar automaticamente.`, variant: 'warning' })
      }
      load()
    } catch (err) {
      console.error('[WebhooksPanel] Erro no teste:', err)
      setAlertInfo({ title: 'Erro', message: 'Não foi possível executar o teste.', variant: 'danger' })
    } finally {
      setTesting(null)
    }
  }

  const openLogs = (ep: WebhookEndpoint, page = 1) => {
    setLogsFor(ep)
    webhookService.getDeliveries(ep.id, page).then(setDeliveries).catch(() => setDeliveries(null))
  }

  const openKeyRequests = (k: ApiKey, page = 1) => {
    setReqsForKey(k); setExpandedReq(null)
    apiKeyService.getKeyRequests(k.id, page).then(setKeyRequests).catch(() => setKeyRequests(null))
  }

  const retryDelivery = async (d: WebhookDelivery) => {
    try {
      await webhookService.retryDelivery(d.id)
      if (logsFor) openLogs(logsFor, deliveries?.meta.page || 1)
      setAlertInfo({ title: 'Reenvio', message: 'Reenvio executado. Confira o novo status na lista.', variant: 'primary' })
    } catch {
      setAlertInfo({ title: 'Erro', message: 'Não foi possível reenviar esta entrega.', variant: 'danger' })
    }
  }

  const removeOut = (ep: WebhookEndpoint) => setConfirm({
    title: 'Excluir webhook de saída',
    message: `Excluir "${ep.name}"? O histórico de entregas também será removido. Esta ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await webhookService.deleteEndpoint(ep.id)
        setEndpoints(prev => prev.filter(e => e.id !== ep.id))
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao excluir o webhook.', variant: 'danger' })
      }
      setConfirm(null)
    },
  })

  const removeKey = (k: ApiKey) => setConfirm({
    title: 'Excluir API key',
    message: `Excluir "${k.name}"? Ela deixará de autenticar imediatamente. Esta ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await apiKeyService.deleteKey(k.id)
        setApiKeys(prev => prev.filter(x => x.id !== k.id))
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao excluir a API key.', variant: 'danger' })
      }
      setConfirm(null)
    },
  })

  const regenerateSecret = (ep: WebhookEndpoint) => setConfirm({
    title: 'Regenerar secret',
    message: 'O secret atual deixará de funcionar imediatamente — o sistema de destino precisará ser atualizado. Continuar?',
    onConfirm: async () => {
      setConfirm(null)
      try {
        const updated = await webhookService.regenerateSecret(ep.id)
        setEditOut(null)
        setCreatedSecret(updated)
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao regenerar o secret.', variant: 'danger' })
      }
    },
  })

  const regenerateKey = (k: ApiKey) => setConfirm({
    title: 'Regenerar API key',
    message: 'A key atual deixará de funcionar imediatamente — o sistema externo precisará ser atualizado. Continuar?',
    onConfirm: async () => {
      setConfirm(null)
      try {
        const updated = await apiKeyService.regenerateKey(k.id)
        setEditKey(null)
        setCreatedKey(updated)
      } catch {
        setAlertInfo({ title: 'Erro', message: 'Erro ao regenerar a API key.', variant: 'danger' })
      }
    },
  })

  const saveEditOut = async () => {
    if (!editOut) return
    try {
      const cleanFilters = Object.fromEntries(
        Object.entries(form.filters || {}).filter(([_, v]) => Array.isArray(v) && v.length > 0)
      )

      const updated = await webhookService.updateEndpoint(editOut.id, {
        name: form.name?.trim(), url: form.url?.trim(), events: form.events, active: form.active, filters: Object.keys(cleanFilters).length ? cleanFilters : undefined
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
    try {
      const updated = await apiKeyService.updateKey(editKey.id, {
        name: form.name?.trim(), scopes: form.scopes, org_id: form.org_id || null, active: form.active,
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

  const eventChecklist = (
    <EventChecklist groups={eventGroups} selected={form.events || []} onToggle={toggleEvent}
      onToggleGroup={selectGroup} onExample={loadExample} loadingExample={loadingExample} />
  )

  const scopeChecklist = (
    <div>
      <p className="adm-note">Escolha <b>o que</b> esta key pode fazer. Uma key vazada só expõe o que foi liberado para ela.</p>
      {Object.entries(scopeGroups).map(([group, list]) => (
        <section key={group} aria-label={group}>
          <GroupHead title={group} all={list.every(s => (form.scopes || []).includes(s))} onToggle={() => selectScopeGroup(group)} />
          {list.map(s => (
            <CheckRow key={s} checked={(form.scopes || []).includes(s)} onToggle={() => toggleScope(s)} label={SCOPE_META[s].label} code={s} description={SCOPE_META[s].description} />
          ))}
        </section>
      ))}
    </div>
  )

  // Um campo por linha: rótulo em cima, opções marcáveis embaixo.
  const filterField = (label: string, key: string, options: { id: string; name: string }[], help?: string) => options.length > 0 && (
    <fieldset className="wh-filter">
      <legend>{label}</legend>
      <div>{options.map(o => <FilterChip key={o.id} active={(form.filters?.[key] || []).includes(o.id)} onClick={() => toggleFilterArray(key, o.id)} label={o.name} />)}</div>
      {help && <p className="adm-note">{help}</p>}
    </fieldset>
  )

  const orgLockField = (
    <Field label='Escopo da key — travada numa empresa ou multi-empresa?'>
      <SearchableSelect
        value={form.org_id || ''}
        onChange={v => setForm({ ...form, org_id: v || null })}
        placeholder="Multi-empresa — organization_id ou domínio do e-mail em cada requisição"
        searchPlaceholder="Buscar empresa..."
        options={[
          { value: '', label: 'Multi-empresa — organization_id ou domínio do e-mail em cada requisição' },
          ...orgs.map(o => ({ value: o.id, label: o.name })),
        ]}
      />
      <p className="adm-note">
        Travada numa empresa: todo chamado/usuário criado por esta key cai nessa empresa, ignorando qualquer organization_id enviado. Multi-empresa: resolve pelo organization_id do payload ou pelo domínio do e-mail do solicitante — ideal para um parceiro que atende vários clientes.
      </p>
    </Field>
  )

  const selectedCategoryIds = form.filters?.category_ids || []
  const availableSubcategories = categories
    .filter(c => selectedCategoryIds.includes(c.id))
    .flatMap(c => c.subcategories || [])

  const filtersUI = (
    <div>
      <p className="adm-note"><b>Filtros (opcional):</b> o webhook só é disparado quando o chamado atende a <b>todas</b> as condições (E). Dentro de cada campo a lógica é <b>OU</b>. Vale apenas para eventos de chamado.</p>
      {filterField('Tipos de chamado', 'types', [{ id: 'incident', name: 'Incidente' }, { id: 'request', name: 'Requisição' }])}
      {filterField('Prioridades', 'priorities', [{ id: 'low', name: 'Baixa' }, { id: 'medium', name: 'Média' }, { id: 'high', name: 'Alta' }])}
      {filterField('Filas', 'queues', queues)}
      {filterField('Categorias', 'category_ids', categories)}
      {filterField('Subcategorias', 'subcategory_ids', availableSubcategories)}
      {filterField('Gestor do analista responsável', 'manager_ids', managers, 'Dispara apenas para chamados cujo analista responsável (atual ou anterior, em caso de redirecionamento) está subordinado a um dos gestores selecionados.')}
      {filterField('Organizações', 'org_ids', orgs)}
    </div>
  )

  const hmacHelp = (
    <details className="wh-more">
      <summary>Como o destino valida a assinatura (para o time técnico)</summary>
      <CodeBlock>{`Cabeçalhos enviados em cada POST:
  X-Webhook-Event:      ticket.created
  X-Webhook-Timestamp:  2026-07-16T14:32:00.000Z
  X-Webhook-Signature:  sha256=<hex>

Validação no destino:
  esperado = HMAC_SHA256(secret, timestamp + "." + corpo_bruto)
  aceitar se "sha256=" + esperado == assinatura recebida`}</CodeBlock>
    </details>
  )

  const curlExamples = (k: ApiKey) => {
    const org = k.org_id ? orgs.find(o => o.id === k.org_id) : null
    const category = categories[0]
    const subcategory = category?.subcategories?.[0]
    const ctx: CurlCtx = {
      org: org ? { id: org.id, name: org.name } : null,
      category: category ? { id: category.id, name: category.name } : null,
      subcategory: subcategory ? { id: subcategory.id, name: subcategory.name } : null,
    }
    const blocks = (k.scopes || []).filter(s => SCOPE_EXAMPLE[s]).map(s => ({ scope: s, spec: SCOPE_EXAMPLE[s]!(ctx) }))
    if (blocks.length === 0) return null
    return (
      <details open className="wh-more">
        <summary>Exemplos completos para o sistema externo (Power Automate, Esquema JSON, curl)</summary>
        {blocks.map(b => (
          <div key={b.scope} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
            <div style={{ marginBottom: 8 }}>{SCOPE_META[b.scope].label} <code>{b.spec.method} {b.spec.path.split('?')[0]}</code></div>
            <ApiExample spec={b.spec} apiKey={k.key || '<api-key>'} onCopied={(what) => setAlertInfo({ title: 'Copiado', message: `${what} copiado para a área de transferência.`, variant: 'primary' })} />
          </div>
        ))}
      </details>
    )
  }

  const schemaView = (intro: ReactNode) => loadingWizardSchema ? <p className="adm-note">Gerando esquema...</p> : wizardSchema && <>
    <p className="adm-note">{intro}</p>
    <CodeBlock>{JSON.stringify(wizardSchema, null, 2)}</CodeBlock>
    <div><CopyBtn text={JSON.stringify(wizardSchema, null, 2)} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Esquema JSON copiado para a área de transferência.', variant: 'primary' })} /></div>
  </>

  const oneTimeWarning = (
    <p className="notice" style={{ margin: '16px 0 0' }}>Por segurança, este valor <b>não será exibido novamente</b>. Se perder, use "Regenerar" na edição.</p>
  )

  const outDocs = (
    <div className="wh-doc">
        <DocSection title='Como funciona'>
          1. Crie o webhook informando a <b>URL de destino</b> e os <b>eventos de gatilho</b> (ex.: chamado criado, chamado escalado).<br />
          2. Copie o <b>secret</b> exibido na criação — ele não aparece novamente (use "Regenerar secret" se perder).<br />
          3. A cada evento selecionado, enviamos um <b>POST</b> com JSON assinado (HMAC-SHA256) para a URL cadastrada.<br />
          4. Use o botão <b>"Testar"</b> na linha do webhook para disparar um evento de <code>ping</code> e confirmar que o destino está acessível.<br />
          5. Use <b>"Logs"</b> para ver o histórico de entregas (status, HTTP de resposta, duração) e <b>"Esquemas"</b> para copiar o JSON Schema de cada evento.
        </DocSection>

        <DocSection title='Catálogo de eventos disponíveis'>
          {Object.entries(eventGroups).map(([group, list]) => (
            <div key={group} style={{ marginTop: 16 }}>
              <div style={{ color: 'var(--text-1)' }}>{group}</div>
              <DocTable
                head={['Evento', 'Quando dispara']}
                rows={list.map(ev => [<code>{ev.event}</code>, ev.description])}
              />
            </div>
          ))}
        </DocSection>

        <DocSection title='Envelope do payload'>
          Todo evento chega com o mesmo envelope; <code>data</code> muda de formato conforme o evento (veja "Ver payload"/"Esquemas" na linha para o exemplo exato de cada um):
          <CodeBlock>{`{
  "event": "ticket.created",
  "timestamp": "2026-07-16T14:32:00.000Z",
  "delivery_id": "uuid",
  "data": { "ticket": { "id": "ISA-1042", "title": "...", "status": "open", ... } }
}`}</CodeBlock>
        </DocSection>

        <DocSection title='Validando a assinatura (para o time técnico do destino)'>
          Cada requisição chega com estes cabeçalhos:
          <CodeBlock>{`X-Webhook-Event:        ticket.created
X-Webhook-Timestamp:    2026-07-16T14:32:00.000Z
X-Webhook-Signature:    sha256=<hex>
X-Webhook-Delivery-Id:  <uuid>

Validação no destino:
  esperado = HMAC_SHA256(secret, timestamp + "." + corpo_bruto)
  aceitar se "sha256=" + esperado === assinatura recebida`}</CodeBlock>
        </DocSection>

        <DocSection title='Reenvio automático em caso de falha'>
          Se o destino não responder <b>HTTP 2xx</b> em até 10s, tentamos novamente automaticamente após <b>1 min, 5 min, 30 min, 2h e 12h</b> (5 tentativas no total).
          Depois da última tentativa, a entrega fica marcada como <b>falha</b> — é possível reenviar manualmente pela tela de <b>Logs</b>. O histórico de entregas fica disponível por 30 dias.
        </DocSection>

        <DocSection title='Filtros (opcional)'>
          Restrinja quando o evento deve disparar — válido apenas para eventos de chamado:
          <DocTable
            head={['Filtro', 'Compara com']}
            rows={[
              ['Tipos de chamado', 'incidente / requisição'],
              ['Prioridades', 'baixa / média / alta'],
              ['Filas', 'fila do chamado'],
              ['Categorias / subcategorias', 'categoria e subcategoria do chamado'],
              ['Organizações', 'empresa do chamado'],
            ]}
          />
          Todos os filtros preenchidos precisam ser satisfeitos (<b>E</b>); dentro de um mesmo filtro, qualquer valor marcado já satisfaz (<b>OU</b>). Sem nenhum filtro, o evento sempre dispara para os eventos selecionados.
        </DocSection>

        <DocSection title='Desativar / reativar'>
          Um webhook <b>inativo</b> deixa de disparar imediatamente (sem apagar histórico). Reative a qualquer momento pela chave na linha.
        </DocSection>

        <DocSection title='Power Automate / Zapier / n8n'>
          Na linha do webhook, use <b>"Esquemas"</b> para copiar o Esquema JSON (draft-07) de cada evento — cole no campo <i>"Solicitar Esquema JSON do Corpo"</i> do Power Automate para estruturar os dados recebidos automaticamente, sem precisar da etapa "gerar a partir de um exemplo". "Ver payload" (no checklist de eventos) mostra um exemplo de JSON real que também pode ser usado para essa geração.
        </DocSection>
    </div>
  )

  const keysDocs = (
    <div className="wh-doc">
        <DocSection title='Como funciona'>
          1. Crie a API key escolhendo as <b>permissões (escopos)</b> que ela terá.<br />
          2. Escolha se a key fica <b>travada numa empresa</b> ou é <b>multi-empresa</b> (resolve por domínio de e-mail ou <code>organization_id</code>).<br />
          3. Copie a <b>key</b> exibida na criação — ela não aparece novamente (use "Regenerar" se perder).<br />
          4. O sistema externo chama os endpoints REST abaixo, base <code>{apiBaseUrl()}</code>, com a key no cabeçalho.<br />
          Referência completa também em <code>docs/API_INTEGRATION.md</code> no repositório (mesmo conteúdo, formato markdown).
        </DocSection>

        <DocSection title='Autenticação'>
          Envie a key no cabeçalho <code>Authorization: Bearer &lt;key&gt;</code> (ou <code>X-Api-Key: &lt;key&gt;</code>).
          <DocTable
            head={['Situação', 'HTTP', 'code']}
            rows={[
              ['Key ausente', <code>401</code>, <code>API_KEY_MISSING</code>],
              ['Key inválida/inativa', <code>401</code>, <code>API_KEY_INVALID</code>],
              ['Key sem o escopo exigido pelo endpoint', <code>403</code>, <code>API_KEY_SCOPE_DENIED</code>],
              ['Key travada tentando ler/alterar recurso de outra empresa', <code>404</code>, <code>API_KEY_OUT_OF_SCOPE</code>],
            ]}
          />
        </DocSection>

        <DocSection title='Escopos (permissões) por endpoint'>
          <DocTable
            head={['Escopo', 'Libera']}
            rows={(Object.keys(SCOPE_META) as ApiKeyScope[]).map(s => [<code>{s}</code>, SCOPE_META[s].label])}
          />
        </DocSection>

        <DocSection title='Modo de organização da key'>
          <b>Travada numa empresa</b> (org selecionada no cadastro): todo chamado/usuário criado por essa key cai nessa empresa — qualquer <code>organization_id</code> enviado no payload é <b>ignorado</b>. Ler/atualizar um recurso de outra empresa retorna <code>404 API_KEY_OUT_OF_SCOPE</code>.<br /><br />
          <b>Multi-empresa</b> (nenhuma org selecionada): resolve por <code>organization_id</code> explícito no payload ou, se ausente, pelo domínio do e-mail do <code>requester</code> (a empresa precisa ter esse domínio cadastrado). Sem nenhum dos dois → <code>400 API_ORG_NOT_FOUND</code>.
        </DocSection>

        <DocSection title='POST /tickets — criar chamado'>
          Escopo: <code>create_ticket</code>.
          <CodeBlock>{`POST ${apiBaseUrl()}/tickets
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "external_request_id": "meu-id-unico-001",
  "organization_id": "uuid (só é lido se a key for multi-empresa)",
  "requester": { "email": "pessoa@empresa.com", "name": "Nome (opcional)" },
  "ticket": {
    "title": "Título do chamado",
    "description": "Detalhes...",
    "priority": "low | medium | high (opcional, padrão medium)",
    "queue": "id da fila (opcional, padrão 'geral')",
    "category_id": "uuid (opcional — 404 CATEGORY_NOT_FOUND se inválido/inativo)",
    "subcategory_id": "uuid (opcional — 404 SUBCATEGORY_NOT_FOUND se inválido/inativo)",
    "attachments": [
      { "name": "print.png", "content_type": "image/png", "content_bytes": "<base64>" }
    ]
  }
}`}</CodeBlock>
          <code>attachments</code> é opcional (até 20 arquivos, 10 MB cada, 30 MB no total do corpo). Aceita também o formato do Outlook (<code>contentType</code>/<code>contentBytes</code>): no Power Automate, passe <code>"attachments": "@triggerOutputs()?['body/attachments']"</code> direto. Arquivos maiores: use o endpoint abaixo, um por vez.
          Resposta <code>201</code>:
          <CodeBlock>{`{ "duplicate": false, "resource_type": "ticket", "resource_id": "ISA-1042", "ticket": { ... } }`}</CodeBlock>
        </DocSection>

        <DocSection title='POST /tickets/:id/attachments — anexar arquivo a um chamado existente'>
          Escopo: <code>create_ticket</code>. Um arquivo por chamada, conteúdo em <b>base64</b> (sem prefixo <code>data:</code>). Máx. 10 MB por arquivo. Tipos aceitos: imagens (png, jpg, gif, webp), pdf, Office, txt/csv/log/json, zip/rar. Se <code>content_type</code> vier genérico (<code>application/octet-stream</code>), o tipo é deduzido pela extensão do <code>name</code>.
          <CodeBlock>{`POST ${apiBaseUrl()}/tickets/ISA-1042/attachments
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "external_request_id": "id-unico-do-anexo (opcional, evita duplicar em retry)",
  "name": "print.png",
  "content_type": "image/png",
  "content_bytes": "iVBORw0KGgoAAAANSUhEUg..."
}`}</CodeBlock>
          Resposta <code>201</code>:
          <CodeBlock>{`{ "duplicate": false, "resource_type": "ticket", "resource_id": "ISA-1042",
  "attachment": { "id": "uuid", "name": "print.png", "size": 71444, "type": "image" } }`}</CodeBlock>
          <b>Power Automate (Outlook):</b> no gatilho <i>When a new email arrives (V3)</i> ligue <i>Include Attachments = Sim</i>. Depois do <code>POST /tickets</code>, faça um <i>Apply to each</i> em <code>triggerOutputs()?['body/attachments']</code> (não condicione a <code>hasAttachments</code> — imagens coladas no corpo vêm com <code>isInline: true</code> e esse campo fica <code>false</code>) com o corpo:
          <CodeBlock>{`{
  "external_request_id": "@{items('Apply_to_each')?['id']}",
  "name": "@{items('Apply_to_each')?['name']}",
  "content_type": "@{items('Apply_to_each')?['contentType']}",
  "content_bytes": "@{items('Apply_to_each')?['contentBytes']}"
}`}</CodeBlock>
          O id do chamado vem de <code>body('HTTP')?['resource_id']</code> da criação. Para ignorar logos de assinatura, filtre <code>isInline</code> antes do loop.
        </DocSection>

        <DocSection title='Variante: subcategoria especial (ex.: onboarding/offboarding)'>
          Algumas subcategorias substituem título/descrição livres por um <b>formulário dinâmico</b> (<code>is_special: true</code>). Antes de montar o payload, consulte <code>GET /subcategories</code> e confira cada item:
          <CodeBlock>{`{
  "id": "uuid", "name": "Admissão de colaborador", "category_id": "uuid",
  "is_special": true,
  "special_title_template": "Admissão — {nome_completo}",
  "special_form_schema": [
    { "key": "nome_completo", "label": "Nome completo", "type": "text", "required": true },
    { "key": "ambientes", "label": "Ambientes", "type": "select", "multiple": true,
      "required": true, "options": [
        { "value": "production", "label": "Produção" },
        { "value": "homologation", "label": "Homologação" }
      ]
    },
    { "key": "data_admissao", "label": "Data de admissão", "type": "date", "required": false }
  ]
}`}</CodeBlock>
          Se <code>is_special</code> for <code>true</code> para o <code>subcategory_id</code> escolhido:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li><b>Não envie</b> <code>title</code>/<code>description</code> — são ignorados; o título final vem de <code>special_title_template</code> com <code>{'{chave}'}</code> substituído pelos valores enviados.</li>
            <li><b>Envie</b> <code>ticket.special_data</code> com um valor para cada <code>key</code>; listas usam uma <code>string</code> ou uma lista de <code>string</code> conforme <code>multiple</code>.</li>
            <li>Campo marcado <code>required: true</code> ausente/vazio → <code>400 SPECIAL_FORM_MISSING_FIELDS</code> com a lista de campos faltantes.</li>
            <li>Valores de <code>select</code> precisam existir em <code>options[].value</code>.</li>
            <li>Chaves fora do schema declarado são descartadas.</li>
          </ul>
          <CodeBlock>{`{
  "external_request_id": "onboarding-042",
  "requester": { "email": "rh@empresa.com" },
  "ticket": {
    "subcategory_id": "<uuid da subcategoria especial>",
    "special_data": { "nome_completo": "Maria Souza", "cargo": "Analista", "data_admissao": "2026-08-01" }
  }
}`}</CodeBlock>
          Se <code>is_special</code> for <code>false</code> (ou o campo não existir), vale o padrão: <code>title</code>/<code>description</code> obrigatórios, <code>special_data</code> é ignorado.
        </DocSection>

        <DocSection title='PATCH /tickets/:id — atualizar chamado'>
          Escopo: <code>update_ticket</code>. Ao menos um campo:
          <CodeBlock>{`PATCH ${apiBaseUrl()}/tickets/ISA-1042
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "status": "open | in_progress | pending | resolved | closed",
  "priority": "low | medium | high",
  "queue": "id da fila",
  "assigned_to_email": "analista@empresa.com",
  "note": "Nota da alteração"
}`}</CodeBlock>
          Chamado inexistente ou de outra empresa (key travada) → <code>404 TICKET_NOT_FOUND</code>. <code>assigned_to_email</code> sem correspondência → <code>404 ASSIGNEE_NOT_FOUND</code>. Nenhum campo enviado → <code>400 API_EMPTY_UPDATE</code>.
        </DocSection>

        <DocSection title='POST /tickets/:id/closure — resolver ou fechar'>
          Escopo: <code>close_ticket</code>. O campo <code>status</code> é obrigatório e aceita apenas <code>resolved</code> ou <code>closed</code>; <code>note</code> e <code>external_request_id</code> são opcionais.
          <CodeBlock>{`POST ${apiBaseUrl()}/tickets/ISA-1042/closure
Authorization: Bearer <api-key>
Content-Type: application/json

{ "status": "resolved", "note": "Tratativa concluída", "external_request_id": "closure-001" }`}</CodeBlock>
          O endpoint aplica auditoria, timestamps e webhooks do fluxo interno. Reenviar o mesmo <code>external_request_id</code> retorna <code>duplicate: true</code> sem repetir a transição.
        </DocSection>

        <DocSection title='POST /users — criar usuário'>
          Escopo: <code>create_user</code>. Sempre cria como <b>usuário final</b> (nunca staff).
          <CodeBlock>{`POST ${apiBaseUrl()}/users
Authorization: Bearer <api-key>
Content-Type: application/json

{ "external_request_id": "...", "name": "Nome Sobrenome", "email": "pessoa@empresa.com", "organization_id": "uuid (se a key for multi-empresa)" }`}</CodeBlock>
        </DocSection>

        <DocSection title='PATCH /users/:idOuEmail — atualizar usuário'>
          Escopo: <code>update_user</code>. <code>:idOuEmail</code> aceita o UUID do usuário ou o e-mail. Só localiza/altera <b>usuários finais</b>.
          <CodeBlock>{`PATCH ${apiBaseUrl()}/users/pessoa@empresa.com
Authorization: Bearer <api-key>
Content-Type: application/json

{ "changes": { "name": "...", "email": "...", "active": false, "organization_id": "uuid ou null" } }`}</CodeBlock>
        </DocSection>

        <DocSection title='Leituras de referência (GET)'>
          Não têm efeito colateral — não precisam de <code>external_request_id</code>.
          <DocTable
            head={['Endpoint', 'Escopo', 'Retorna']}
            rows={[
              [<code>GET /categories?requester_email=</code>, <code>read_categories</code>, 'id, name, description, icon, color, image_url — só o plano da empresa quando a key é travada ou com organization_id/requester_email'],
              [<code>GET /subcategories?category_id=</code>, <code>read_subcategories</code>, 'id, name, category_id, description, icon, image_url, is_special, special_form_schema, special_title_template (filtros opcionais; mesmo escopo de empresa de /categories)'],
              [<code>GET /queues</code>, <code>read_queues</code>, 'id, name'],
              [<code>GET /organizations</code>, <code>read_organizations</code>, 'id (use como organization_id), name, domains (key travada recebe só a própria)'],
              [<code>GET /tickets?page=&per_page=&status=&organization_id=&updated_since=&created_since=&requester_email=&order=</code>, <code>read_tickets</code>, 'data[] (com portal_url) + pagination (per_page máx. 100; status aceita lista separada por vírgula; order asc|desc por updated_at, padrão asc)'],
              [<code>GET /tickets/:idOuNumero</code>, <code>read_tickets</code>, 'um chamado, por id ou display_number, com portal_url e survey_url (pesquisa pendente de chamado encerrado)'],
              [<code>GET /tickets/:id/messages?requester_email=</code>, <code>read_messages</code>, 'conversa pública: id, type, text, author_name, from_requester, has_attachment, created_at'],
              [<code>POST /tickets/:id/messages</code>, <code>create_message</code>, '{ requester_email, text, attachments? (até 5) } — resposta do solicitante; chamado fechado recusa'],
            ]}
          />
        </DocSection>

        <DocSection title='Evitando duplicidade (idempotência)'>
          Operações de escrita aceitam <code>external_request_id</code> (string única escolhida por você).
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
          <code>{'{ "error": "mensagem", "code": "CODIGO", "details"?: any }'}</code>
          <DocTable
            head={['code', 'HTTP', 'Significado']}
            rows={[
              [<code>VALIDATION_ERROR</code>, '400', 'Payload não passou na validação (ver details)'],
              [<code>CATEGORY_NOT_FOUND</code> , '404', 'category_id inválido ou inativo'],
              [<code>SUBCATEGORY_NOT_FOUND</code>, '404', 'subcategory_id inválido ou inativo'],
              [<code>SPECIAL_FORM_MISSING_FIELDS</code>, '400', 'Campo obrigatório do formulário especial não enviado'],
              [<code>SPECIAL_FORM_INVALID_OPTION</code>, '400', 'Valor de lista não existe nas opções configuradas'],
              [<code>TICKET_NOT_FOUND</code>, '404', 'Chamado inexistente ou fora do escopo da key'],
              [<code>API_ORG_NOT_FOUND</code> , '400', 'organization_id/domínio não resolveu nenhuma empresa (multi-empresa)'],
              [<code>API_ORG_INVALID</code>, '400', 'organization_id não existe ou está inativa'],
              [<code>API_REQUEST_IN_FLIGHT</code>, '409', 'Mesmo external_request_id ainda em processamento'],
            ]}
          />
        </DocSection>

        <DocSection title='Rate limit'>
          60 requisições/minuto por API key + IP. Acima disso, <code>429 RATE_LIMIT_EXCEEDED</code>.
        </DocSection>

        <DocSection title='Acompanhando as requisições recebidas'>
          Na linha da key, use <b>"Requisições"</b> para ver cada chamada recebida: método, caminho, status, recurso criado/afetado, mensagem de erro e o payload bruto enviado.
        </DocSection>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="adm">
      <PageHeader
        title='Integrações'
        subtitle='Integre o ISA a outros sistemas: envie avisos quando algo acontecer aqui, ou libere uma API key para criar chamados e usuários a partir de fora.'
        actions={<>
          <Btn variant='secondary' onClick={() => setDocsOpen(true)}>Documentação</Btn>
          <Btn onClick={openWizard}>Novo</Btn>
        </>}
      />
      <div className="adm-body" style={{ gap: 0 }}>
        <div role="tablist" aria-label="Direção da integração" className="subtabs" style={{ marginLeft: -14 }}>
          {([
            { key: 'out' as Tab, label: 'Saída, enviamos para outros sistemas', count: endpoints.length },
            { key: 'keys' as Tab, label: 'API externa, outros sistemas nos chamam', count: apiKeys.length },
          ]).map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label} ({t.count})</button>
          ))}
        </div>
        <p className="adm-note" style={{ padding: '14px 0 20px', maxWidth: 820 }}>{tab === 'out'
          ? 'Cadastre a URL do sistema que deve ser avisado e escolha os eventos. A cada evento enviamos um POST JSON assinado (HMAC-SHA256). Se o destino estiver fora do ar, tentamos de novo automaticamente por até 5 vezes.'
          : 'Crie uma API key com as permissões que ela precisa. O sistema externo chama os endpoints REST de /integrations/v1 com a key no cabeçalho: criar/atualizar chamado e usuário, ou ler categorias/subcategorias/filas/organizações.'}</p>

        <div className="adm-scroll">
          {tab === 'out' ? (
            <table className="table" aria-label="Webhooks de saída" style={{ minWidth: 900 }}>
              <thead><tr>{['Webhook', 'Eventos', 'Entregas', 'Ativo'].map(h => <th key={h} scope="col">{h}</th>)}<th scope="col" aria-label="Ações" /></tr></thead>
              <tbody>
                {endpoints.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>Nenhum webhook de saída cadastrado ainda.</td></tr>}
                {endpoints.map(ep => (
                  <tr key={ep.id}>
                    <td style={{ maxWidth: 280 }}><div style={{ fontWeight: 500 }}>{ep.name}</div><span className="adm-clip adm-sub adm-mono" title={ep.url}>{ep.url}</span></td>
                    <td title={ep.events.join(', ')}>{brief(ep.events)}</td>
                    <td><DeliveryHealth summary={ep.recent_deliveries} /></td>
                    <td><Toggle value={ep.active} onChange={() => toggleActive(ep, 'out')} label={ep.active ? `Pausar ${ep.name}` : `Ativar ${ep.name}`} /></td>
                    <td>
                      <div className="adm-actions">
                        <Btn variant='ghost' size='xs' onClick={() => openLogs(ep)}>Logs</Btn>
                        <Btn variant='ghost' size='xs' disabled={testing === ep.id} onClick={() => testEndpoint(ep)}>{testing === ep.id ? 'Enviando…' : 'Testar'}</Btn>
                        <Btn variant='ghost' size='xs' onClick={() => setSchemasFor(ep)}>Esquemas</Btn>
                        <button type="button" className="icon-act" aria-label={`Editar ${ep.name}`} title="Editar" onClick={() => { loadDefaultsData(); setForm({ name: ep.name, url: ep.url, events: [...ep.events], active: ep.active, filters: ep.filters || {} }); setEditOut(ep) }}><Pencil size={15} aria-hidden /></button>
                        <button type="button" className="icon-act danger" aria-label={`Excluir ${ep.name}`} title="Excluir" onClick={() => removeOut(ep)}><Trash2 size={15} aria-hidden /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table" aria-label="API keys" style={{ minWidth: 900 }}>
              <thead><tr>{['Key', 'Empresa', 'Permissões', 'Uso', 'Ativa'].map(h => <th key={h} scope="col">{h}</th>)}<th scope="col" aria-label="Ações" /></tr></thead>
              <tbody>
                {apiKeys.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-3)' }}>Nenhuma API key cadastrada ainda.</td></tr>}
                {apiKeys.map(k => (
                  <tr key={k.id}>
                    <td><div style={{ fontWeight: 500 }}>{k.name}</div><div className="adm-sub adm-mono">{k.key_prefix}…</div></td>
                    <td>{k.org_id ? `Travada em: ${orgById[k.org_id] || k.org_id}` : 'Multi-empresa'}{!k.org_id && <div className="adm-sub">por domínio ou organization_id</div>}</td>
                    <td>{brief(k.scopes.map(s => SCOPE_META[s]?.label || s))}</td>
                    <td>{k.requests_count ?? 0} requisição(ões)<div className="adm-sub">{k.last_used_at ? `último uso ${fmtDate(k.last_used_at)}` : 'nunca usada'}</div></td>
                    <td><Toggle value={k.active} onChange={() => toggleActive(k, 'keys')} label={k.active ? `Pausar ${k.name}` : `Ativar ${k.name}`} /></td>
                    <td>
                      <div className="adm-actions">
                        <Btn variant='ghost' size='xs' onClick={() => openKeyRequests(k)}>Requisições</Btn>
                        <button type="button" className="icon-act" aria-label={`Editar ${k.name}`} title="Editar" onClick={() => { loadDefaultsData(); setForm({ name: k.name, scopes: [...k.scopes], org_id: k.org_id, active: k.active }); setEditKey(k) }}><Pencil size={15} aria-hidden /></button>
                        <button type="button" className="icon-act danger" aria-label={`Excluir ${k.name}`} title="Excluir" onClick={() => removeKey(k)}><Trash2 size={15} aria-hidden /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend style={{ padding: 0, marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>O que você quer fazer?</legend>
                {([
                  { dir: 'out' as Tab, title: 'Enviar avisos para outro sistema', desc: 'Quando algo acontecer no ISA (ex.: chamado criado), avisamos uma URL externa.' },
                  { dir: 'keys' as Tab, title: 'Deixar outro sistema nos chamar', desc: 'Gere uma API key com permissões: o sistema externo cria/atualiza chamados e usuários via API REST.' },
                ]).map(opt => (
                  <CheckRow key={opt.dir} type="radio" name="wizard-dir" checked={wizardDir === opt.dir} onToggle={() => setWizardDir(opt.dir)} label={opt.title} description={opt.desc} />
                ))}
              </fieldset>
              <Field label={wizardDir === 'out' ? 'Nome do webhook' : 'Nome da API key'} required>
                <Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={wizardDir === 'out' ? 'Ex.: Alertas no Teams (TI)' : 'Ex.: Integração Portal Cliente ACME'} maxLength={120} showCount />
                <p className="adm-note">Só para identificação interna: aparece na listagem e nos logs.</p>
              </Field>
              {wizardDir === 'out' && (
                <Field label='URL de destino' required>
                  <Inp value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} placeholder='https://sistema-externo.com/webhook' maxLength={500} showCount />
                  <p className="adm-note">Para onde enviaremos o POST JSON. Você poderá testar depois de criar.</p>
                </Field>
              )}
            </div>
          )}

          {wizardStep === 2 && wizardDir === 'out' && eventChecklist}
          {wizardStep === 3 && wizardDir === 'out' && filtersUI}

          {wizardStep === 2 && wizardDir === 'keys' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {orgLockField}
              {scopeChecklist}
            </div>
          )}

          {wizardStep === 4 && createdSecret && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="adm-note">Cada envio será assinado com o secret abaixo, para o destino confirmar que fomos nós.</p>
              <Field label='Secret de assinatura — copie agora'>
                <SecretBox value={createdSecret.secret || ''} />
                <div style={{ marginTop: 6 }}><CopyBtn text={createdSecret.secret || ''} onCopied={() => setAlertInfo({ title: 'Copiado', message: 'Secret copiado para a área de transferência.', variant: 'primary' })} /></div>
              </Field>
              {oneTimeWarning}
              {hmacHelp}

              <details className="wh-more">
                <summary>Esquema JSON do payload (para Power Automate / Zapier)</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 14 }}>
                  {form.events && form.events.length > 1 && (
                    <Field label='Selecione o evento'>
                      <Sel value={wizardSchemaEvent} onChange={e => setWizardSchemaEvent(e.target.value)}>
                        {(form.events as string[]).map((ev: string) => (
                          <option key={ev} value={ev}>{ev}</option>
                        ))}
                      </Sel>
                    </Field>
                  )}
                  {schemaView(<>Copie este esquema e cole no campo <b>"Solicitar Esquema JSON do Corpo"</b> do Power Automate:</>) ?? <p className="adm-note">Nenhum esquema disponível.</p>}
                </div>
              </details>

              <div>
                <Btn variant='secondary' size='sm' disabled={testing === createdSecret.id} onClick={() => testEndpoint(createdSecret)}>
                  {testing === createdSecret.id ? 'Enviando ping…' : 'Enviar evento de teste (ping)'}
                </Btn>
              </div>
            </div>
          )}

          {wizardStep === 3 && wizardDir === 'keys' && createdKey && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="adm-note">Entregue ao sistema externo a API key abaixo.</p>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label='Nome' required><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} showCount /></Field>
            <Field label='URL de destino' required><Inp value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} maxLength={500} showCount /></Field>
            <Field label='Status'>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Toggle value={form.active} onChange={() => setForm({ ...form, active: !form.active })} />
                <span>{form.active ? 'Ativo' : 'Inativo'}</span>
              </div>
            </Field>
            {eventChecklist}
            {filtersUI}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label='Nome' required><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} showCount /></Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Toggle value={form.active !== false} onChange={v => setForm({ ...form, active: v })} />
              <span>Key ativa</span>
            </div>
            {orgLockField}
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
            <p className="adm-note">Nenhuma entrega registrada ainda.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 640, fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Evento', 'Status', 'Tentativas', 'HTTP', 'Duração', 'Quando', ''].map(h => (
                      <th key={h} scope="col">{h && <SortHeader label={h} {...deliverySort.header(h)} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Ordena só a página carregada */}
                  {deliverySort.apply(deliveries.data, {
                    'Evento': d => d.event,
                    'Status': d => d.status,
                    'Tentativas': d => d.attempts,
                    'HTTP': d => d.response_status,
                    'Duração': d => d.duration_ms,
                    'Quando': d => new Date(d.created_at),
                  }).map(d => (
                    <tr key={d.id}>
                      <td>{d.event}</td>
                      <td>{statusText(d.status, DELIVERY_LABEL)}</td>
                      <td>{d.attempts}{d.status === 'pending' && d.next_retry_at ? ` · próx. ${fmtDate(d.next_retry_at)}` : ''}</td>
                      <td title={d.error_message || ''}>{d.response_status ?? (d.error_message ? 'erro' : '—')}</td>
                      <td>{d.duration_ms != null ? `${d.duration_ms} ms` : '—'}</td>
                      <td>{fmtDate(d.created_at)}</td>
                      <td>
                        {d.status !== 'success' && <Btn variant='ghost' size='xs' onClick={() => retryDelivery(d)}>Reenviar</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <span className="adm-note">Falhas são retentadas automaticamente (1min → 5min → 30min → 2h → 12h). Histórico de 30 dias.</span>
                {deliveries.meta.pages > 1 && (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, fontSize: 13, color: 'var(--text-3)' }}>
                    <Btn variant='ghost' size='xs' disabled={deliveries.meta.page <= 1} onClick={() => openLogs(logsFor, deliveries.meta.page - 1)}>Anterior</Btn>
                    {deliveries.meta.page} / {deliveries.meta.pages}
                    <Btn variant='ghost' size='xs' disabled={deliveries.meta.page >= deliveries.meta.pages} onClick={() => openLogs(logsFor, deliveries.meta.page + 1)}>Próxima</Btn>
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
            <p className="adm-note">Nenhuma requisição recebida ainda.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 640, fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Status', 'Método', 'Caminho', 'ID externo', 'Recurso', 'Erro', 'Quando', ''].map(h => (
                      <th key={h} scope="col">{h && <SortHeader label={h} {...requestSort.header(h)} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requestSort.apply(keyRequests.data, {
                    'Status': r => r.status,
                    'Método': r => r.method,
                    'Caminho': r => r.path,
                    'ID externo': r => r.external_request_id,
                    'Recurso': r => r.resource_type,
                    'Erro': r => r.error_message,
                    'Quando': r => new Date(r.created_at),
                  }).map(r => (
                    <Fragment key={r.id}>
                      <tr>
                        <td>{statusText(r.status, REQUEST_LABEL)}</td>
                        <td className="adm-mono">{r.method}</td>
                        <td className="adm-mono">{r.path}</td>
                        <td className="adm-mono">{r.external_request_id || '—'}</td>
                        <td>{r.resource_type ? `${r.resource_type === 'ticket' ? 'Chamado' : 'Usuário'} ${r.resource_id}` : '—'}</td>
                        <td style={{ color: r.error_message ? 'var(--danger)' : undefined, maxWidth: 160, overflow: 'hidden' }}><TruncatedText text={r.error_message || '—'} style={{ display: 'block' }} /></td>
                        <td>{fmtDate(r.created_at)}</td>
                        <td>
                          <Btn variant='ghost' size='xs' onClick={() => setExpandedReq(expandedReq === r.id ? null : r.id)}>{expandedReq === r.id ? 'Ocultar' : 'Payload'}</Btn>
                        </td>
                      </tr>
                      {expandedReq === r.id && (
                        <tr>
                          <td colSpan={8}>
                            <CodeBlock>{JSON.stringify(r.request_payload, null, 2)}</CodeBlock>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {keyRequests.meta.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--text-3)' }}>
                  <Btn variant='ghost' size='xs' disabled={keyRequests.meta.page <= 1} onClick={() => openKeyRequests(reqsForKey, keyRequests.meta.page - 1)}>Anterior</Btn>
                  {keyRequests.meta.page} / {keyRequests.meta.pages}
                  <Btn variant='ghost' size='xs' disabled={keyRequests.meta.page >= keyRequests.meta.pages} onClick={() => openKeyRequests(reqsForKey, keyRequests.meta.page + 1)}>Próxima</Btn>
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
          onClose={() => setExampleFor(null)}
          onCopied={message => setAlertInfo({ title: 'Copiado', message, variant: 'primary' })} />
      )}

      {schemasFor && (
        <Modal isOpen onClose={() => { setSchemasFor(null); setWizardSchemaEvent(''); setWizardSchema(null) }} title={`Esquemas JSON — ${schemasFor.name}`} width={560}
          footer={<Btn onClick={() => { setSchemasFor(null); setWizardSchemaEvent(''); setWizardSchema(null) }}>Fechar</Btn>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="adm-note">
              Selecione um dos eventos deste webhook para visualizar e copiar o Esquema JSON correspondente (usado no Power Automate, Zapier, etc.).
            </p>

            <Field label='Selecione o evento'>
              <Sel value={wizardSchemaEvent} onChange={(e: any) => setWizardSchemaEvent(e.target.value)}>
                <option value=''>— Selecione um evento —</option>
                {(schemasFor.events as string[]).map((ev: string) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </Sel>
            </Field>

            {schemaView(<>Esquema JSON pronto para o campo <b>"Solicitar Esquema JSON do Corpo"</b>:</>) ?? (wizardSchemaEvent && <p className="adm-note">Nenhum esquema disponível.</p>)}
          </div>
        </Modal>
      )}

      {docsOpen && (
        <Modal isOpen onClose={() => setDocsOpen(false)}
          title={tab === 'out' ? 'Documentação — Webhooks de saída' : 'Documentação — API externa de integração'}
          width={780}
          footer={<Btn onClick={() => setDocsOpen(false)}>Fechar</Btn>}>
          {tab === 'out' ? outDocs : keysDocs}
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
