import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'
import { useStaticDataStore } from '@/store/staticData'
import { ticketService } from '@/services/ticketService'
import { TierBadge, StatusBadge, PriorityBadge, SLABadge, isAiResolved, StatCard, Figures, Btn, Inp, Txta, PwdInp, Sel, Toggle, PageHeader, EmptyState, ConfirmModal, Modal, SortHeader, Pagination, CopyableId, copyToClipboard, Loading } from '@/components/ui'
import { toggleCsv } from '@/components/ui/SearchableSelect'
import { X } from 'lucide-react'
import { toast } from '@/store/toastStore'
import { validateNewUser, describeApiError } from '@/utils/userValidation'
import { validateDomainList } from '@/utils/domainValidation'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterField } from '@/components/filters/FilterField'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { AuthorizedDomainsTab } from './AuthorizedDomainsTab'
import { DetailHead, Row, Section, TextFilter } from './Blocks'
import { useTableSort } from '@/hooks/useTableSort'
import { useTicketPage, serverSort } from '@/hooks/useTicketPage'
import { apiErrorMessage } from '@/services/api'
import type { OrgServedBy } from '@/types'


type Org = { id: string; name: string; domains: string[]; tier: string; active: boolean; manager_global: boolean; address?: string; phone?: string; notes?: string; location?: string; zip_code?: string; website?: string; queues?: any[]; queue_access?: any[]; expires_at?: string; expiry_message?: string; warning_active?: boolean; email_reply_enabled?: boolean; sla_config?: any }

export { copyToClipboard as copyOrganizationId }

export function OrgsPanel() {
  const orgSort = useTableSort<string>()
  const orgTicketSort = useTableSort<string>()
  const user = useAuthStore((s) => s.user)
  const role = user?.role
  const hasOrgsPerm = hasAreaPermission(user, 'orgs')
  // Quem atende: admin edita (grava na carteira do gerente); TM/gerente só consultam (ou quem tem permissão orgs).
  // Carteira do gerente: só o admin altera (o servidor recusa os demais).
  const canEditServedBy = role === 'admin'
  const canSeeServedBy = role === 'admin' || role === 'manager' || role === 'supervisor' || hasOrgsPerm
  // Criar/excluir empresa = Ticket Manager (supervisor) + Gerente + Admin, ou com permissão orgs.
  const canMutateOrg = role === 'supervisor' || role === 'manager' || role === 'admin' || hasOrgsPerm
  const [orgs, setOrgs] = useState<Org[]>([])
  const [slaConfigs, setSlaConfigs] = useState<any[]>([])
  const [queues, setQueues] = useState<any[]>([])
  // Contagem por status de cada empresa / de cada solicitante da empresa selecionada (servidor)
  const [orgCounts, setOrgCounts] = useState<Record<string, Record<string, number>>>({})
  const [requesterCounts, setRequesterCounts] = useState<Record<string, Record<string, number>> | null>(null)
  const [overdueCount, setOverdueCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('orgs'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const [selected, setSelected] = useState<Org|null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<Record<string,any>>({})
  const [orgTab, setOrgTab] = useState('info')
  // Aba "Chamados": lista da empresa paginada no servidor
  const orgTickets = useTicketPage({
    orgId: selected?.id,
    ...serverSort(orgTicketSort.sort, { '#': 'id', 'Título': 'title', 'Status': 'status', 'Prioridade': 'priority', 'SLA': 'sla' }, { sort: 'date', dir: 'desc' }),
  }, { enabled: !!selected && orgTab === 'tickets' })
  const [users, setUsers] = useState<any[]>([])
  // Add user modal
  const [showUserModal, setShowUserModal] = useState(false)
  const [addUserMode, setAddUserMode] = useState<'link'|'new'>('link')
  const [linkUserId, setLinkUserId] = useState('')
  const [userForm, setUserForm] = useState<Record<string,any>>({})
  const [savingUser, setSavingUser] = useState(false)
  // Supervisor links
  const [servedBy, setServedBy] = useState<OrgServedBy | null>(null)
  const [servedByError, setServedByError] = useState<string | null>(null)
  const [addManagerId, setAddManagerId] = useState('')
  const [confirmRemoveServed, setConfirmRemoveServed] = useState<{ id: string; name: string } | null>(null)

  const maskPhone = (value: string) => {
    let v = value.replace(/\D/g, '')
    if (v.length <= 10) {
      v = v.replace(/^(\d{2})(\d)/g, '($1) $2')
      v = v.replace(/(\d{4})(\d)/, '$1-$2')
    } else {
      v = v.replace(/^(\d{2})(\d)/g, '($1) $2')
      v = v.replace(/(\d{5})(\d)/, '$1-$2')
    }
    return v.substring(0, 15)
  }

  const maskZipCode = (value: string) => {
    let v = value.replace(/\D/g, '')
    v = v.replace(/^(\d{5})(\d)/, '$1-$2')
    return v.substring(0, 9)
  }
  // Queue access
  // Ticket detail modal
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<any>(null)
  const [ticketMessages, setTicketMessages] = useState<any[]>([])
  const [ticketLoading, setTicketLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string } | null>(null)
  const [inlineEditMode, setInlineEditMode] = useState(false)

  const [orgPage, setOrgPage] = useState(1)
  const [orgPageSize, setOrgPageSize] = useState(25)
  const [orgUsersPage, setOrgUsersPage] = useState(1)
  const [orgUsersPageSize, setOrgUsersPageSize] = useState(25)

  useEffect(() => {
    setOrgPage(1)
  }, [search, tierFilter, statusFilter])

  useEffect(() => {
    setOrgUsersPage(1)
  }, [selected?.id, orgTab])

  useEffect(() => {
    Promise.all([
      adminService.getOrganizations(),
      adminService.getSlaConfigs(),
      adminService.getQueues(),
      adminService.getUsers()
    ]).then(([o, s, q, u]) => {
      setOrgs(o); setSlaConfigs(s); setQueues(q); setUsers(u); setLoading(false)
    }).catch(err => {
      console.error('[OrgsPanel] Erro ao carregar dados:', err)
      setError('Erro ao carregar organizações. Verifique a conexão com o servidor.')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    ticketService.getGroupedCounts('org').then(setOrgCounts).catch(() => {})
  }, [])

  // Solicitantes e SLA vencido da empresa selecionada
  useEffect(() => {
    if (!selected) return
    let isMounted = true
    setRequesterCounts(null)
    Promise.all([
      ticketService.getGroupedCounts('requester', selected.id),
      ticketService.getTicketsPage({ orgId: selected.id, overdue: true, page: 1, pageSize: 1 }),
    ]).then(([req, overdue]) => {
      if (!isMounted) return
      setRequesterCounts(req)
      setOverdueCount(overdue.total)
    }).catch(err => console.error('[OrgsPanel] Erro ao carregar contagens da org:', err))
    return () => { isMounted = false }
  }, [selected?.id])

  useEffect(() => {
    if (!selected || orgTab !== 'served') return
    let alive = true
    setServedBy(null); setServedByError(null)
    adminService.getOrgServedBy(selected.id)
      .then(d => { if (alive) setServedBy(d) })
      .catch(err => { if (alive) setServedByError(apiErrorMessage(err, 'Não foi possível carregar quem atende esta empresa.')) })
    return () => { alive = false }
  }, [selected?.id, orgTab])

  if (loading) return <Loading label="Carregando organizações…" />
  if (error) return <EmptyState title="Erro ao carregar dados" desc={error} action={<Btn variant="secondary" onClick={()=>window.location.reload()}>Tentar novamente</Btn>} />

  const openNew  = () => { 
    const defaultTier = slaConfigs[0]?.tier || 'bronze'
    setForm({
      name:'', domains:'', tier: defaultTier, active:true,
      address:'', phone:'', notes:'', location:'', zip_code:'', website:'', queue_ids: [],
      expires_at: '', expiry_message: '', warning_active: true, email_reply_enabled: false
    })
    setShowModal(true) 
  }

  const startInlineEdit = (org: Org) => {
    setForm({ 
      ...org, 
      domains: org.domains.join(', '), 
      queue_ids: org.queues?.map((q:any)=>q.id) || [],
      expires_at: org.expires_at ? org.expires_at.slice(0, 10) : '',
      expiry_message: org.expiry_message || '',
      warning_active: org.warning_active !== false
    })
    setInlineEditMode(true)
  }

  const saveOrg = async () => {
    if (!String(form.name || '').trim()) {
      toast.warning('Nome da organização é obrigatório.')
      return
    }
    const domainCheck = validateDomainList(form.domains, { required: true })
    if (!domainCheck.ok) {
      toast.warning(domainCheck.error)
      return
    }
    try {
      const parsed = { ...form, name: String(form.name).trim(), domains: domainCheck.domains }
      const created = await adminService.createOrganization(parsed)
      setOrgs([...orgs, created])
      useStaticDataStore.getState().invalidate()
      toast.success('Organização criada com sucesso!')
      setShowModal(false)
    } catch (err: any) {
      toast.error('Erro ao salvar organização: ' + (err.response?.data?.error || err.message))
    }
  }

  const saveInlineOrg = async () => {
    if (!selected) return
    if (!String(form.name || '').trim()) {
      toast.warning('Nome da organização é obrigatório.')
      return
    }
    const domainCheck = validateDomainList(form.domains, { required: true })
    if (!domainCheck.ok) {
      toast.warning(domainCheck.error)
      return
    }
    try {
      const parsed = { ...form, name: String(form.name).trim(), domains: domainCheck.domains }
      const updated = await adminService.updateOrganization(selected.id, parsed)
      setOrgs(orgs.map(o => o.id === selected.id ? updated : o))
      setSelected(updated)
      setInlineEditMode(false)
      useStaticDataStore.getState().invalidate()
      toast.success('Organização atualizada!')
    } catch (err: any) {
      toast.error('Erro ao salvar organização: ' + (err.response?.data?.error || err.message))
    }
  }

  const toggleActive = async (id:string) => {
    try {
      const org = orgs.find(o=>o.id===id); if (!org) return
      const updated = await adminService.updateOrganization(id, { active: !org.active })
      setOrgs(orgs.map(o=>o.id===id ? updated : o))
      if (selected?.id===id) setSelected(updated)
      useStaticDataStore.getState().invalidate()
      toast.success(updated.active ? 'Organização ativada!' : 'Organização desativada!')
    } catch (err: any) { toast.error('Erro ao alterar status: ' + err.message) }
  }

  const deleteOrg = (id:string) => setConfirmDelete({ isOpen: true, id })

  const performDeleteOrg = async (id: string) => {
    try {
      await adminService.deleteOrganization(id)
      setOrgs(orgs.filter(o=>o.id!==id))
      if (selected?.id===id) setSelected(null)
      useStaticDataStore.getState().invalidate()
      toast.success('Organização excluída com sucesso!')
    } catch (err: any) { toast.error('Erro ao excluir organização: ' + err.message) }
  }

  const openAddUser = () => {
    if (!selected) return
    setAddUserMode('link')
    setLinkUserId('')
    setUserForm({ name: '', email: '', password: '', role: 'user', orgId: selected.id, active: true })
    setSavingUser(false)
    setShowUserModal(true)
  }

  const handleAddUser = async () => {
    if (savingUser) return
    if (addUserMode === 'link') {
      if (!linkUserId) { toast.warning('Selecione um usuário.'); return }
      try {
        setSavingUser(true)
        const updated = await adminService.updateUser(linkUserId, { orgId: selected!.id })
        setUsers(users.map(u => u.id === linkUserId ? updated : u))
        setShowUserModal(false)
        toast.success('Usuário vinculado com sucesso!')
      } catch (err: any) {
        toast.error('Erro ao vincular usuário: ' + (err.response?.data?.error || err.message))
      } finally {
        setSavingUser(false)
      }
    } else {
      const check = validateNewUser(userForm)
      if (!check.ok) { toast.warning(check.message); return }
      try {
        setSavingUser(true)
        const created = await adminService.createUser({ ...userForm, ...check.values })
        setUsers([...users, created])
        setShowUserModal(false)
        toast.success('Usuário criado e vinculado com sucesso!')
      } catch (err: any) {
        toast.error('Erro ao criar usuário: ' + describeApiError(err, 'Não foi possível criar o usuário.'))
      } finally {
        setSavingUser(false)
      }
    }
  }

  const openTicket = async (ticketId: string) => {
    setShowTicketModal(true)
    setSelectedTicket(null)
    setTicketMessages([])
    setTicketLoading(true)
    try {
      const [ticket, messages] = await Promise.all([
        ticketService.getTicket(ticketId),
        ticketService.getMessages(ticketId),
      ])
      setSelectedTicket(ticket)
      setTicketMessages(messages)
    } catch (err) {
      console.error('[OrgsPanel] Erro ao carregar chamado:', err)
    } finally {
      setTicketLoading(false)
    }
  }



  const managersAvailable = servedBy
    ? users.filter(u => u.role === 'manager' && u.active !== false && !u.manager_global && !servedBy.managers.some(m => m.id === u.id))
    : []
  const ROLE_NAME: Record<string, string> = { agent: 'Analista', supervisor: 'Ticket Manager', manager: 'Gerente' }
  const queueName = (id: string) => queues.find(q => q.id === id)?.name ?? id

  const addServedBy = async (orgId: string) => {
    if (!addManagerId) return
    try {
      setServedBy(await adminService.addOrgServedBy(orgId, addManagerId))
      setAddManagerId('')
      toast.success('Empresa adicionada à carteira do gerente. A equipe dele passa a atendê-la.')
    } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível adicionar à carteira.')) }
  }

  const removeServedBy = async (orgId: string, userId: string) => {
    try {
      setServedBy(await adminService.removeOrgServedBy(orgId, userId))
      toast.success('Empresa removida da carteira do gerente.')
    } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível remover da carteira.')) }
    finally { setConfirmRemoveServed(null) }
  }

  const getOrgUsers   = (id:string) => users.filter(u => u.org_id === id || u.orgId === id)
  const sumStatus = (c: Record<string, number> | undefined, ...st: string[]) =>
    st.length ? st.reduce((n, k) => n + (c?.[k] ?? 0), 0) : Object.values(c ?? {}).reduce((n, v) => n + v, 0)
  const orgTicketTotal = (id: string) => sumStatus(orgCounts[id])
  const getQueue      = (id:string) => queues.find(q=>q.id===id)
  // Users eligible to link: role='user', not already in this org
  const linkableUsers = selected ? users.filter(u => u.role === 'user' && u.org_id !== selected.id && u.orgId !== selected.id) : []

  const filteredOrgs = orgs.filter(o =>
    matchesFilter(tierFilter, o.tier) &&
    matchesFilter(statusFilter, o.active !== false ? 'active' : 'inactive') &&
    (o.name.toLowerCase().includes(search.toLowerCase()) || o.domains.some(d => d.toLowerCase().includes(search.toLowerCase())))
  )

  const totalOrgs = filteredOrgs.length
  const totalOrgPages = Math.max(1, Math.ceil(totalOrgs / orgPageSize))
  const currentOrgPage = Math.min(orgPage, totalOrgPages)

  const totalOrgUsers = selected ? getOrgUsers(selected.id).length : 0
  const totalOrgUsersPages = Math.max(1, Math.ceil(totalOrgUsers / orgUsersPageSize))
  const currentOrgUsersPage = Math.min(orgUsersPage, totalOrgUsersPages)

  const ORGS_DEFAULTS = { statusFilter: 'all' }
  const activeFilterCount = countActiveFilters({ statusFilter }, ORGS_DEFAULTS)

  const handleClearFilters = () => { setSearch(''); setTierFilter('all'); setStatusFilter('all'); setActiveSavedFilter(null); setOrgPage(1) }
  const handleSelectSavedFilter = (sf: SavedFilter) => {
    const f = sf.filters
    if (f.search !== undefined) setSearch(f.search as string)
    if (f.tierFilter !== undefined) setTierFilter(f.tierFilter as string)
    if (f.statusFilter !== undefined) setStatusFilter(f.statusFilter as string)
    setActiveSavedFilter(sf)
    setOrgPage(1)
  }
  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: { search, tierFilter, statusFilter } }
    saveFilter('orgs', sf)
    setSavedFilters(getSavedFilters('orgs'))
  }
  const handleDeleteSavedFilter = (id: string) => {
    deleteFilter('orgs', id)
    setSavedFilters(getSavedFilters('orgs'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }


  const expiry = (org: Org) => {
    if (!org.expires_at || org.warning_active === false) return null
    const left = new Date(org.expires_at).getTime() - Date.now()
    if (left < 0) return { text: 'Acesso expirado', tone: 'var(--danger)' }
    return left <= 90 * 86400000 ? { text: 'Expira em menos de 90 dias', tone: 'var(--warning)' } : null
  }
  const defaultQueueName = (org: Org) => getQueue(org.sla_config?.default_queue || slaConfigs.find(c=>c.tier===org.tier)?.default_queue)?.name
  const openCount = (id: string) => sumStatus(orgCounts[id], 'open', 'in_progress')
  const tierName = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1)

  const orgFields = (
    <>
      <Row label="Nome" required><Inp value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} maxLength={150} showCount /></Row>
      <Row label="Plano" hint="Define o SLA e a fila padrão">
        <Sel value={form.tier||'bronze'} onChange={e=>setForm({...form, tier: e.target.value})}>
          {slaConfigs.map(t=><option key={t.tier} value={t.tier}>{tierName(t.tier)}: SLA {t.incident_resolution_hours}h / {t.incident_first_response_hours}h</option>)}
        </Sel>
      </Row>
      <Row label="Domínios de e-mail" required hint="Apenas o trecho após o @ com TLD válido (.com, .com.br). Múltiplos domínios separados por vírgula.">
        <Inp
          value={form.domains||''}
          onChange={e=>setForm({...form,domains:e.target.value})}
          onBlur={() => {
            const res = validateDomainList(form.domains, { required: false })
            if (res.ok && res.rawNormalized) setForm((f: any) => ({ ...f, domains: res.rawNormalized }))
          }}
          placeholder="ex: suaempresa.com, outraempresa.com.br"
          maxLength={255}
        />
      </Row>
      <Row label="Telefone"><Inp value={form.phone||''} onChange={e=>setForm({...form,phone:maskPhone(e.target.value)})} maxLength={20} /></Row>
      <Row label="Localização"><Inp value={form.location||''} onChange={e=>setForm({...form,location:e.target.value})} placeholder="ex: São Paulo, SP" maxLength={100} /></Row>
      <Row label="CEP"><Inp value={form.zip_code||''} onChange={e=>setForm({...form,zip_code:maskZipCode(e.target.value)})} maxLength={10} /></Row>
      <Row label="Website"><Inp value={form.website||''} onChange={e=>setForm({...form,website:e.target.value})} placeholder="https://..." maxLength={255} /></Row>

      <h3>Vencimento do contrato</h3>
      <Row label="Data de vencimento"><Inp type="date" value={form.expires_at || ''} onChange={e=>setForm({...form, expires_at: e.target.value})}/></Row>
      <Row label="Mensagem ao expirar"><Inp value={form.expiry_message || ''} onChange={e=>setForm({...form, expiry_message: e.target.value})} placeholder="Mensagem de aviso/bloqueio" maxLength={255} showCount /></Row>
      <Row flat label="Alerta de vencimento"><Toggle value={form.warning_active !== false} onChange={v=>setForm({...form, warning_active: v})} label="Alerta de vencimento ativo"/></Row>

      <h3>Atendimento</h3>
      <Row flat label="Permitir resposta por e-mail" hint="O cliente responde o e-mail do chamado e a resposta entra no chamado. Desligado: o e-mail pede para não responder e traz o link do chamado.">
        <Toggle value={form.email_reply_enabled === true} onChange={v=>setForm({...form, email_reply_enabled: v})} label="Permitir resposta por e-mail"/>
      </Row>
      <Row label="Observações internas"><Txta value={form.notes||''} onChange={e=>setForm({...form,notes:e.target.value})} rows={3} maxLength={1000} showCount /></Row>
      <Row flat label="Empresa ativa"><Toggle value={form.active!==false} onChange={v=>setForm({...form,active:v})} label="Empresa ativa"/></Row>
    </>
  )

  return (
    <div style={{display:'flex',height:'100%',minHeight:0,width:'100%'}}>
      <div className="cad-page" hidden={!!selected}>
        <PageHeader title="Empresas" subtitle={`${orgs.length} empresas cadastradas`} actions={canMutateOrg ? <Btn onClick={openNew}>Nova empresa</Btn> : undefined}/>
        <div className="cad-filters">
          <TextFilter
            label="Plano"
            value={tierFilter}
            options={[
              { value: 'all', label: 'Todas', count: orgs.length },
              ...slaConfigs.map(c => ({ value: c.tier, label: tierName(c.tier), count: orgs.filter(o=>o.tier===c.tier).length })).filter(o => o.count > 0),
            ]}
            onPick={v => setTierFilter(toggleCsv(tierFilter, v, ['all'], 'all'))}
          />
          <FilterSearchInput value={search} onChange={setSearch} placeholder="Nome ou domínio" />
          <div style={{ position: 'relative' }}>
            <FilterButton
              activeCount={activeFilterCount}
              activeSavedFilter={activeSavedFilter}
              onOpen={() => setFilterOpen((v) => !v)}
              onClearSaved={() => { setActiveSavedFilter(null); handleClearFilters() }}
              isOpen={filterOpen}
            />
            <FilterDropdown
              isOpen={filterOpen}
              onClose={() => setFilterOpen(false)}
              savedFilters={savedFilters}
              onSelectSaved={handleSelectSavedFilter}
              onSaveNew={handleSaveFilter}
              onDeleteSaved={handleDeleteSavedFilter}
              onApply={() => {}}
              onClear={handleClearFilters}
              dateFrom=""
              dateTo=""
              onDateFromChange={() => {}}
              onDateToChange={() => {}}
              showDateFilter={false}
            >
              <FilterField label="Status">
                <FilterSelect value={statusFilter} onChange={v => setStatusFilter(v)}>
                  <option value="all">Todos</option>
                  <option value="active">Ativas</option>
                  <option value="inactive">Inativas</option>
                </FilterSelect>
              </FilterField>
            </FilterDropdown>
          </div>
        </div>
        {filteredOrgs.length === 0 ? (
          <EmptyState title="Nenhuma empresa encontrada" desc="Ajuste os filtros ou o termo de busca." />
        ) : (
          <div className="cad-body">
            <div className="cad-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {['Empresa','Plano','Fila padrão','Usuários','Chamados','Em aberto'].map(h=>(
                      <th key={h} className={h==='Fila padrão'||h==='Usuários'||h==='Chamados'?'cad-wide':undefined}><SortHeader label={h} {...orgSort.header(h)}/></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgSort.apply(filteredOrgs, {
                    'Empresa': org => org.name,
                    'Plano': org => org.tier,
                    'Fila padrão': defaultQueueName,
                    'Usuários': org => getOrgUsers(org.id).length,
                    'Chamados': org => orgTicketTotal(org.id),
                    'Em aberto': org => openCount(org.id),
                  })
                  .slice((currentOrgPage - 1) * orgPageSize, currentOrgPage * orgPageSize)
                  .map(org => {
                    const alert = expiry(org)
                    return (
                      <tr key={org.id} data-open onClick={()=>{setSelected(org);setOrgTab('info');setInlineEditMode(false)}}>
                        <td>
                          <button type="button" className="cad-main">{org.name}</button>
                          <span className="cad-sub">{org.domains[0]}{org.active===false && ' · Inativa'}</span>
                          {alert && <span className="cad-sub" style={{color:alert.tone}}>{alert.text}</span>}
                        </td>
                        <td><TierBadge tier={org.tier}/></td>
                        <td className="cad-wide" style={{color:'var(--text-2)'}}>{defaultQueueName(org) ?? '—'}</td>
                        <td className="cad-wide">{getOrgUsers(org.id).length}</td>
                        <td className="cad-wide">{orgTicketTotal(org.id)}</td>
                        <td>{openCount(org.id)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="cad-pages">
              <Pagination
                variant="toolbar"
                page={currentOrgPage}
                pageSize={orgPageSize}
                total={totalOrgs}
                onPageChange={setOrgPage}
                onPageSizeChange={(newSize) => {
                  setOrgPageSize(newSize)
                  setOrgPage(1)
                }}
              />
            </div>
          </div>
        )}
      </div>

      {selected && inlineEditMode && (
        <div className="cad-page">
          <DetailHead back={selected.name} onBack={()=>setInlineEditMode(false)} title="Editar empresa" meta={[selected.domains.join(', ')]} />
          <div className="cad-body">
            <div className="cad-form" style={{height:'auto'}}>
              {orgFields}
              <div className="cad-save">
                <Btn onClick={saveInlineOrg}>Salvar alterações</Btn>
                <Btn variant="ghost" onClick={()=>setInlineEditMode(false)}>Cancelar</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && !inlineEditMode && (
        <div className="cad-page">
          <DetailHead back="Empresas" onBack={()=>{setSelected(null);setInlineEditMode(false)}} title={selected.name}
            meta={[selected.domains.join(', '), `Plano ${tierName(selected.tier)}`, selected.active===false && 'Inativa']}>
            <Btn onClick={()=>startInlineEdit(selected)}>Editar</Btn>
            {canMutateOrg && <Btn variant="danger" onClick={()=>deleteOrg(selected.id)}>Excluir</Btn>}
          </DetailHead>
          <div className="cad-body">
            <div className="subtabs" style={{marginBottom:28}}>
              {[['info','Informações'],['served','Quem atende'],['users','Usuários'],['tickets','Chamados'],['sso_domains','Domínios autorizados']].filter(([id])=>id!=='served'||canSeeServedBy).map(([id,label])=>(
                <button key={id} type="button" aria-pressed={orgTab===id} onClick={()=>setOrgTab(id)}>{label}</button>
              ))}
            </div>

            {orgTab==='info' && (() => {
              const config = selected.sla_config || slaConfigs.find(c => c.tier === selected.tier)
              const expired = !!selected.expires_at && new Date(selected.expires_at) < new Date()
              return (
                <>
                  <Figures style={{marginBottom:40}}>
                    <StatCard label="Usuários ativos" value={getOrgUsers(selected.id).length}/>
                    <StatCard label="Chamados abertos" value={openCount(selected.id)}/>
                    <StatCard label="Total de chamados" value={orgTicketTotal(selected.id)}/>
                    <StatCard label="SLA vencidos" value={overdueCount}/>
                  </Figures>
                  <Section title="Atendimento">
                    <Row label="Fila padrão">{getQueue(config?.default_queue)?.name ?? '—'}</Row>
                    <Row label="Escalação">{getQueue(config?.escalation_queue)?.name ?? '—'}</Row>
                    <Row label="SLA de 1ª resposta">{config?.incident_first_response_hours ?? 4}h</Row>
                    <Row label="SLA de resolução">{config?.incident_resolution_hours ?? 24}h</Row>
                    <Row label="Empresa ativa"><Toggle value={selected.active!==false} onChange={()=>toggleActive(selected.id)} label="Empresa ativa"/></Row>
                  </Section>
                  <Section title="Contato">
                    <Row label="Local">{selected.location||'—'}</Row>
                    <Row label="Telefone">{selected.phone||'—'}</Row>
                    <Row label="Website">{selected.website ? <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer" style={{color:'var(--accent-fg)'}}>{selected.website}</a> : '—'}</Row>
                  </Section>
                  <Section title="Contrato">
                    <Row label="Vencimento"><span style={expired ? {color:'var(--danger)'} : undefined}>{selected.expires_at ? new Date(selected.expires_at).toLocaleDateString('pt-BR') : 'Sem expiração'}</span></Row>
                    <Row label="Alerta de vencimento">{selected.warning_active !== false ? 'Ativo' : 'Inativo'}</Row>
                    <Row label="Mensagem personalizada">{selected.expiry_message || 'Nenhuma mensagem configurada'}</Row>
                  </Section>
                  {selected.notes && <Section title="Notas"><p style={{margin:0,lineHeight:1.6,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{selected.notes}</p></Section>}
                  <Section title="Integrações" hint={<>Use este ID como <code>organization_id</code> nas integrações.</>}>
                    <CopyableId id={selected.id} size="sm" showLabel copyLabel="Copiar ID" toastMessage="ID da organização copiado!" />
                  </Section>
                </>
              )
            })()}

            {orgTab==='served' && (
              <>
                {servedByError && <p role="alert" className="cad-alert">{servedByError}</p>}
                {!servedBy && !servedByError && <Loading size="compact" label="Carregando quem atende…" />}
                {servedBy && (
                  <>
                    <Section title={`Gerentes (${servedBy.managers.length})`} hint="Vem da carteira de cada gerente. Analistas e Ticket Managers abaixo deles herdam automaticamente.">
                      {servedBy.managers.length === 0 ? (
                        <p className="cad-alert" role="alert">
                          Nenhum gerente atende esta empresa — ninguém verá os chamados dela.{canEditServedBy ? ' Adicione abaixo.' : ' Peça ao administrador para incluí-la na carteira de um gerente.'}
                        </p>
                      ) : (
                        <table className="table">
                          <tbody>
                            {servedBy.managers.map(m => (
                              <tr key={m.id}>
                                <td><span className="cad-main">{m.name}</span><span className="cad-sub">{m.email}</span></td>
                                <td style={{color:'var(--text-2)'}} title={m.mode === 'all' ? 'Atende todas as empresas, inclusive novas' : 'Empresa selecionada na carteira'}>
                                  {m.mode === 'all' ? 'Todas as empresas' : 'Selecionada'}
                                </td>
                                <td style={{width:40}}>
                                  {canEditServedBy && m.mode === 'selected' && (
                                    <button type="button" className="icon-act danger" onClick={()=>setConfirmRemoveServed({ id: m.id, name: m.name })} aria-label={`Remover ${selected.name} da carteira de ${m.name}`} title="Remover da carteira">
                                      <X size={15} aria-hidden/>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {canEditServedBy && (
                        <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:16}}>
                          <Sel value={addManagerId} onChange={e=>setAddManagerId(e.target.value)} style={{flex:'1 1 220px',maxWidth:420}} aria-label="Gerente para adicionar">
                            <option value="">{managersAvailable.length ? 'Adicionar à carteira de um gerente...' : 'Todos os gerentes já atendem esta empresa'}</option>
                            {managersAvailable.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </Sel>
                          <Btn variant="secondary" onClick={()=>addServedBy(selected.id)} disabled={!addManagerId}>Adicionar</Btn>
                        </div>
                      )}
                    </Section>

                    <Section title={`Equipe com acesso (${servedBy.team.length})`}>
                      {servedBy.team.length === 0 ? 'Nenhum analista ou Ticket Manager atende esta empresa.' : (
                        <div className="cad-scroll">
                          <table className="table">
                            <thead><tr><th>Nome</th><th>Carteira</th><th className="cad-wide">Filas</th></tr></thead>
                            <tbody>
                              {servedBy.team.map(t => (
                                <tr key={t.id}>
                                  <td><span className="cad-main">{t.name}</span><span className="cad-sub">{ROLE_NAME[t.role] ?? t.role}</span></td>
                                  <td style={{color:'var(--text-2)'}}>{t.mode === 'inherit' ? 'Herda do chefe' : 'Carteira restrita'}</td>
                                  <td className="cad-wide">
                                    {t.role !== 'agent' ? '—' : t.queues.length ? t.queues.map(queueName).join(', ') : <span style={{color:'var(--danger)'}}>Sem fila — não vê chamados</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Section>
                  </>
                )}
              </>
            )}

            {orgTab==='users' && (
              <>
                <Btn variant="secondary" onClick={openAddUser} style={{marginBottom:14}}>Adicionar usuário</Btn>
                {totalOrgUsers === 0 ? <p className="notice">Nenhum usuário pertence a esta empresa.</p> : (
                  <>
                    <table className="table">
                      <thead><tr><th>Usuário</th><th>Chamados</th></tr></thead>
                      <tbody>
                        {getOrgUsers(selected.id)
                          .slice((currentOrgUsersPage - 1) * orgUsersPageSize, currentOrgUsersPage * orgUsersPageSize)
                          .map((u:any)=>(
                            <tr key={u.id}>
                              <td><span className="cad-main">{u.name}</span><span className="cad-sub">{u.email}</span></td>
                              <td>{!requesterCounts ? '...' : sumStatus(requesterCounts[u.id])}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <div className="cad-pages">
                      <Pagination
                        variant="toolbar"
                        page={currentOrgUsersPage}
                        pageSize={orgUsersPageSize}
                        total={totalOrgUsers}
                        onPageChange={setOrgUsersPage}
                        onPageSizeChange={(newSize) => {
                          setOrgUsersPageSize(newSize)
                          setOrgUsersPage(1)
                        }}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {orgTab==='tickets' && (
              orgTickets.loading && orgTickets.rows.length===0 ? (
                <Loading size="compact" label="Carregando chamados da organização…" />
              ) : orgTickets.rows.length===0 ? (
                <p className="notice">Esta empresa não possui chamados.</p>
              ) : (
                <>
                  <div className="cad-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          {[['Título','Chamado'],['Status','Situação'],['Prioridade','Prioridade'],['SLA','SLA']].map(([key,label])=>(
                            <th key={key} className={key==='Prioridade'||key==='SLA'?'cad-wide':undefined}><SortHeader label={label} {...orgTicketSort.header(key)}/></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orgTickets.rows.map(t=>(
                          <tr key={t.id} data-open onClick={()=>openTicket(t.id)}>
                            <td><button type="button" className="cad-main">{t.title}</button><span className="cad-sub">{String(t.id).slice(0,8)}</span></td>
                            <td><StatusBadge status={t.status}/></td>
                            <td className="cad-wide"><PriorityBadge priority={t.priority}/></td>
                            <td className="cad-wide">{isAiResolved(t) ? <span style={{ color: 'var(--text-3)' }}>—</span> : <SLABadge deadline={t.slaDeadline} status={t.status} resolvedAt={t.resolved_at} compact/>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="cad-pages">
                    <Pagination
                      variant="toolbar"
                      page={orgTickets.page}
                      pageSize={orgTickets.pageSize}
                      total={orgTickets.total}
                      onPageChange={orgTickets.setPage}
                      onPageSizeChange={orgTickets.setPageSize}
                    />
                  </div>
                </>
              )
            )}

            {orgTab==='sso_domains' && (
              <AuthorizedDomainsTab orgId={selected.id} onAdded={domain => {
                if (selected.domains.includes(domain)) return
                const updated = { ...selected, domains: [...selected.domains, domain] }
                setSelected(updated)
                setOrgs(orgs.map(o => o.id === updated.id ? updated : o))
              }} />
            )}
          </div>
        </div>
      )}

      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title="Nova empresa" width={760}
        footer={<><Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancelar</Btn><Btn onClick={saveOrg}>Salvar</Btn></>}>
        <div className="cad-form" style={{height:'auto'}}>{orgFields}</div>
      </Modal>

      <Modal isOpen={showUserModal} onClose={()=>setShowUserModal(false)} title={`Adicionar usuário a ${selected?.name ?? ''}`} width={620}
        footer={<>
          <Btn variant="ghost" onClick={()=>setShowUserModal(false)} disabled={savingUser}>Cancelar</Btn>
          <Btn onClick={handleAddUser} disabled={savingUser}>{savingUser ? 'Salvando...' : (addUserMode==='link'?'Vincular':'Criar usuário')}</Btn>
        </>}>
        <div className="subtabs" style={{marginBottom:20}}>
          {[['link','Vincular usuário existente'],['new','Criar novo usuário']].map(([id,label])=>(
            <button key={id} type="button" aria-pressed={addUserMode===id} onClick={()=>setAddUserMode(id as 'link'|'new')}>{label}</button>
          ))}
        </div>
        <div className="cad-form" style={{height:'auto'}}>
          {addUserMode==='link' ? (
            linkableUsers.length === 0 ? (
              <p className="notice">Nenhum usuário disponível para vincular. Crie um novo.</p>
            ) : (
              <Row label="Usuário" required hint="Só quem tem o perfil Usuário final.">
                <Sel value={linkUserId} onChange={e=>setLinkUserId(e.target.value)}>
                  <option value="">Selecione um usuário...</option>
                  {linkableUsers.map(u=>(
                    <option key={u.id} value={u.id}>{u.name} — {u.email}{u.org_id ? ' (já em outra org.)' : ''}</option>
                  ))}
                </Sel>
              </Row>
            )
          ) : (
            <>
              <Row label="Nome completo" required><Inp value={userForm.name||''} onChange={e=>setUserForm({...userForm,name:e.target.value})} maxLength={100} showCount /></Row>
              <Row label="E-mail" required><Inp value={userForm.email||''} onChange={e=>setUserForm({...userForm,email:e.target.value})} maxLength={100} showCount /></Row>
              <Row label="Senha" required><PwdInp value={userForm.password||''} onChange={e=>setUserForm({...userForm,password:e.target.value})} placeholder="Mínimo 8 caracteres" maxLength={100} /></Row>
              <Row label="Cargo"><Inp value={userForm.position||''} onChange={e=>setUserForm({...userForm,position:e.target.value})} maxLength={80} showCount /></Row>
              <Row flat label="Usuário ativo"><Toggle value={userForm.active!==false} onChange={v=>setUserForm({...userForm,active:v})} label="Usuário ativo"/></Row>
            </>
          )}
        </div>
      </Modal>

      <Modal isOpen={showTicketModal} onClose={()=>setShowTicketModal(false)} title={selectedTicket?.title ?? 'Chamado'} width={680}>
        {ticketLoading ? (
          <Loading size="compact" />
        ) : !selectedTicket ? (
          <p className="cad-alert">Erro ao carregar chamado.</p>
        ) : (
          <>
            <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'6px 20px',fontSize:14,color:'var(--text-3)'}}>
              <span>{String(selectedTicket.id).slice(0,8)}</span>
              <StatusBadge status={selectedTicket.status}/>
              <PriorityBadge priority={selectedTicket.priority}/>
              {selectedTicket.slaDeadline && <SLABadge deadline={selectedTicket.slaDeadline} status={selectedTicket.status} resolvedAt={selectedTicket.resolved_at} compact/>}
            </div>
            {selectedTicket.description && (
              <p style={{fontSize:14.5,color:'var(--text-1)',lineHeight:1.6,margin:'20px 0 0',overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{selectedTicket.description}</p>
            )}
            <h4 style={{margin:'32px 0 0',paddingTop:16,borderTop:'1px solid var(--rule)',fontSize:18,fontWeight:500}}>Histórico de atendimento</h4>
            {ticketMessages.length === 0 && <p className="cad-sub">Nenhuma mensagem ainda.</p>}
            {ticketMessages.map((msg: any) => (
              <div key={msg.id} style={{padding:'14px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{fontSize:13,color:'var(--text-3)'}}>
                  <strong style={{fontWeight:600,color:'var(--text-1)'}}>{msg.sender?.name||'Usuário'}</strong>
                  {msg.type==='internal' ? ', nota interna' : msg.type==='email' ? ', por e-mail' : ''}
                  {' · '}{new Date(msg.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
                </div>
                <p style={{fontSize:14,color:'var(--text-1)',lineHeight:1.55,margin:'4px 0 0',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{msg.text}</p>
              </div>
            ))}
          </>
        )}
      </Modal>

      {confirmRemoveServed && selected && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmRemoveServed(null)}
          onConfirm={() => removeServedBy(selected.id, confirmRemoveServed.id)}
          title="Remover da carteira"
          message={`Remover ${selected.name} da carteira de ${confirmRemoveServed.name}? Ele e a equipe que herda dele deixam de ver os chamados desta empresa. Se for a última empresa da carteira, ele ficará sem acesso a chamados.`}
          confirmText="Remover"
          variant="danger"
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => performDeleteOrg(confirmDelete.id)}
          title="Excluir organização"
          message="Deseja realmente excluir esta organização? Os dados históricos serão mantidos, mas a organização não aparecerá mais nas listagens ativas."
          confirmText="Excluir"
          variant="danger"
        />
      )}
    </div>
  )
}
