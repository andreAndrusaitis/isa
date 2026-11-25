import { apiErrorMessage } from '@/services/api'
import { useState, useEffect, type ReactNode } from 'react'
import { adminService } from '@/services/adminService'
import { macroService } from '@/services/macroService'
import { webhookService } from '@/services/webhookService'
import { Btn, Field, Inp, Sel, Toggle, Modal, PageHeader, ConfirmModal, SearchableSelect, Loading } from '@/components/ui'
import { GripVertical, Edit, Trash2, X } from 'lucide-react'
import './configuracoes.css'
import { toast } from '@/store/toastStore'
import { validateSingleDomain, validateDomainList } from '@/utils/domainValidation'
import { EMAIL_RE } from '@/utils/userValidation'

type Condition = { field: string; operator: string; value: string }
type Action    = { type: string; value: string }
type Rule      = { id: string; name: string; enabled: boolean; priority: number; conditions: Condition[]; matchType: 'all' | 'any'; actions: Action[]; elseActions?: Action[]; trigger: string; triggerHours: number | null; stopProcessing: boolean }

// Catálogo vindo de GET /routing/schema — o painel não tem listas próprias.
type Option     = { id: string; label: string }
type FieldDef   = { id: string; label: string; kind: string; operators: string[]; options?: Option[] }
type ActionDef  = { id: string; label: string; kind: string; options?: Option[] }
type OperatorDef = { id: string; label: string; multi?: boolean; noValue?: boolean }
type Catalog    = { triggers: (Option & { needsHours?: boolean })[]; operators: OperatorDef[]; fields: FieldDef[]; actions: ActionDef[] }

// Ações de projeto: só projetos onde quem configura edita (GET /routing/project-targets).
type ProjectTarget = { id: string; name: string; taskTypes: { id: string; name: string; prefix: string }[]; tasks: { id: string; key: string; title: string; dueDate: string }[] }
type TaskTemplate = { projectId: string; taskTypeId: string; dueInDays: number }
const parseTemplate = (value: string): Partial<TaskTemplate> => { try { return JSON.parse(value) || {} } catch { return {} } }
const fmtDay = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

// Operadores de valor exato — os únicos em que domínio/e-mail precisam ser válidos.
const EXACT_OPS = ['equals', 'not_equals', 'in', 'not_in']

export function RoutingPanel() {
  const [rules, setRules]         = useState<Rule[]>([])
  const [catalog, setCatalog]     = useState<Catalog | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [editing, setEditing]     = useState<string | null>(null)
  const [editForm, setEditForm]   = useState<any | null>(null)
  const [dragOver, setDragOver]   = useState<number | null>(null)
  const [dragItem, setDragItem]   = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string } | null>(null)

  const [orgs, setOrgs]           = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [users, setUsers]         = useState<any[]>([])
  const [queues, setQueues]       = useState<any[]>([])
  const [slaConfigs, setSlaConfigs] = useState<any[]>([])
  const [macros, setMacros]       = useState<any[]>([])
  const [webhooks, setWebhooks]   = useState<any[]>([])
  const [projectTargets, setProjectTargets] = useState<ProjectTarget[]>([])

  useEffect(() => {
    Promise.all([
      adminService.getRoutingSchema(),
      adminService.getRoutingRules(),
      adminService.getOrganizations(),
      adminService.getCategories(),
      adminService.getUsers(),
      adminService.getQueues(),
      adminService.getSlaConfigs(),
      macroService.getMacros(),
      // Webhooks são área só do admin: para os demais perfis a ação fica sem opções.
      webhookService.getEndpoints().catch(() => []),
      adminService.getRoutingProjectTargets().catch(() => []),
    ]).then(([schema, r, o, c, u, q, s, m, w, pt]) => {
      setCatalog(schema); setRules(r); setOrgs(o); setCategories(c); setUsers(u); setQueues(q); setSlaConfigs(s); setMacros(m); setWebhooks(w); setProjectTargets(pt)
      setLoading(false)
    }).catch(err => {
      console.error('[RoutingPanel]', err)
      setError('Erro ao carregar regras de roteamento.')
      setLoading(false)
    })
  }, [])

  if (loading) return <Loading label="Carregando regras de roteamento…" />

  if (error || !catalog) return (
    <div style={{ flex: 1, padding: '48px var(--page-gutter)' }}>
      <div style={{ fontSize: 18, fontWeight: 500 }}>Erro ao carregar dados</div>
      <p style={{ margin: '4px 0 16px', fontSize: 14, color: 'var(--text-3)' }}>{error}</p>
      <Btn variant="secondary" size="sm" onClick={() => window.location.reload()}>Tentar novamente</Btn>
    </div>
  )

  const condField  = (f: string) => catalog.fields.find(x => x.id === f)
  const actionType = (t: string) => catalog.actions.find(x => x.id === t)
  const operator   = (o: string) => catalog.operators.find(x => x.id === o)
  const triggerOf  = (t: string) => catalog.triggers.find(x => x.id === t)

  // Opções de valor pelo tipo declarado no catálogo (enum fixo ou entidade cadastrada).
  const optionsFor = (kind: string, options?: Option[]): Option[] | null => {
    if (options) return options
    switch (kind) {
      case 'queue':       return queues.map(q => ({ id: q.id, label: q.name }))
      case 'org':         return orgs.map(o => ({ id: o.id, label: o.name }))
      case 'tier':        return slaConfigs.map(t => ({ id: t.tier, label: t.tier.toUpperCase() }))
      case 'category':    return categories.map(c => ({ id: c.id, label: c.name }))
      case 'subcategory': return categories.flatMap(c => (c.subcategories || []).map((s: any) => ({ id: s.id, label: `${c.name} › ${s.name}` })))
      case 'requester':   return users.filter(u => u.role === 'user').map(u => ({ id: u.id, label: u.name }))
      case 'staff':       return users.filter(u => u.role !== 'user').map(u => ({ id: u.id, label: u.name }))
      case 'agent':       return users.filter(u => u.role === 'agent').map(u => ({ id: u.id, label: u.name }))
      case 'macro':       return macros.filter(m => m.active !== false).map(m => ({ id: m.id, label: m.title }))
      case 'webhook':     return webhooks.map(w => ({ id: w.id, label: w.name }))
      case 'project_task': return projectTargets.flatMap(p => p.tasks.map(t => ({ id: t.id, label: `${p.name} › ${t.key} ${t.title} · prazo ${fmtDay(t.dueDate)}` })))
      default:            return null
    }
  }
  const labelOf = (kind: string, options: Option[] | undefined, value: string) => {
    if (kind === 'project_task_template') {
      const tpl = parseTemplate(value)
      const project = projectTargets.find(p => p.id === tpl.projectId)
      if (!project) return 'projeto em que você não é membro'
      return `${project.name} · ${project.taskTypes.find(t => t.id === tpl.taskTypeId)?.name ?? 'tipo'} · prazo ${tpl.dueInDays} dia(s)`
    }
    if (kind === 'project_task' && !optionsFor(kind)?.some(o => o.id === value)) return 'task de projeto em que você não é membro ou já concluída'
    const opts = optionsFor(kind, options)
    return value.split(',').map(v => v.trim()).filter(Boolean).map(v => opts?.find(o => o.id === v)?.label || v).join(', ')
  }

  const toggleEnabled = async (id: string) => {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    try {
      const updated = await adminService.updateRoutingRule(id, { enabled: !rule.enabled })
      setRules(rules.map(r => r.id === id ? updated : r))
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível alterar a regra.'))
    }
  }
  const deleteRule = (id: string) => {
    setConfirmDelete({ isOpen: true, id })
  }

  const performDeleteRule = async (id: string) => {
    try {
      await adminService.deleteRoutingRule(id)
      setRules(rules.filter(r => r.id !== id))
      toast.success('Regra excluída.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível excluir a regra.'))
    }
  }
  const firstField = catalog.fields[0]
  const blankCondition = () => ({ field: firstField.id, operator: firstField.operators[0], value: '' })
  const blankAction = () => ({ type: catalog.actions[0].id, value: '' })

  const startEdit = (rule: Rule) => { setEditing(rule.id); setEditForm(JSON.parse(JSON.stringify(rule))) }
  const startNew  = () => {
    setEditing('new')
    setEditForm({
      name: 'Nova regra',
      enabled: true,
      priority: rules.length + 1,
      matchType: 'all',
      trigger: catalog.triggers[0].id,
      triggerHours: null,
      stopProcessing: true,
      conditions: [blankCondition()],
      actions: [blankAction()],
      elseActions: []
    })
  }
  const saveEdit = async () => {
    if (!editForm) return
    if (!String(editForm.name || '').trim()) {
      toast.warning('Nome da regra é obrigatório.')
      return
    }

    for (let ci = 0; ci < editForm.conditions.length; ci++) {
      const cond = editForm.conditions[ci]
      if (!EXACT_OPS.includes(cond.operator)) continue
      const multi = cond.operator === 'in' || cond.operator === 'not_in'
      if (cond.field === 'email_domain') {
        const check = multi ? validateDomainList(cond.value, { required: true }) : validateSingleDomain(cond.value, { required: true })
        if (!check.ok) {
          toast.warning(`Condição #${ci + 1}: ${check.error}`)
          return
        }
        cond.value = 'rawNormalized' in check ? check.rawNormalized : check.domain
      }
      if (cond.field === 'email') {
        const emails = (multi ? cond.value.split(',') : [cond.value]).map((e: string) => e.trim().toLowerCase()).filter(Boolean)
        const bad = emails.find((e: string) => !EMAIL_RE.test(e))
        if (!emails.length || bad) {
          toast.warning(`Condição #${ci + 1}: ${bad ? `e-mail inválido "${bad}"` : 'informe o e-mail'}.`)
          return
        }
        cond.value = emails.join(', ')
      }
    }

    const payload = { ...editForm, triggerHours: triggerOf(editForm.trigger)?.needsHours ? Number(editForm.triggerHours) || null : null }
    try {
      if (editing === 'new') {
        const created = await adminService.createRoutingRule(payload)
        setRules([...rules, created])
        toast.success('Regra criada com sucesso!')
      } else {
        const updated = await adminService.updateRoutingRule(editing!, payload)
        setRules(rules.map(r => r.id === editing ? updated : r))
        toast.success('Regra atualizada com sucesso!')
      }
      setEditing(null); setEditForm(null)
    } catch (err: any) {
      toast.error('Erro ao salvar regra: ' + (err.response?.data?.error || err.message))
    }
  }

  const updateList = (list: 'conditions' | 'actions' | 'elseActions', i: number, patch: object) =>
    setEditForm((prev: any) => prev && ({ ...prev, [list]: (prev[list] || []).map((x: any, idx: number) => idx === i ? { ...x, ...patch } : x) }))
  const addTo      = (list: 'conditions' | 'actions' | 'elseActions', item: object) => setEditForm((prev: any) => prev && ({ ...prev, [list]: [...(prev[list] || []), item] }))
  const removeFrom = (list: 'conditions' | 'actions' | 'elseActions', i: number) => setEditForm((prev: any) => prev && ({ ...prev, [list]: (prev[list] || []).filter((_: any, idx: number) => idx !== i) }))

  // Trocar o campo reinicia operador e valor — o operador antigo pode não valer para o novo campo.
  const changeField = (i: number, fieldId: string) => updateList('conditions', i, { field: fieldId, operator: condField(fieldId)?.operators[0] ?? 'equals', value: '' })

  const handleDrop = async (i: number) => {
    if (dragItem === null || dragItem === i) return
    const r = [...rules]; const [moved] = r.splice(dragItem, 1); r.splice(i, 0, moved)
    const newRules = r.map((x, idx) => ({ ...x, priority: idx + 1 }))
    const previous = rules
    setRules(newRules)
    setDragItem(null); setDragOver(null)
    try {
      await adminService.reorderRoutingRules(newRules.map(x => x.id))
    } catch (err) {
      setRules(previous)
      toast.error(apiErrorMessage(err, 'Não foi possível salvar a nova ordem das regras.'))
    }
  }

  const renderValue = (kind: string, options: Option[] | undefined, op: OperatorDef | undefined, value: string, onChange: (v: string) => void, ariaLabel: string, placeholder = 'Valor...') => {
    if (kind === 'none' || op?.noValue) return <div className="cfg-off">Sem valor</div>
    if (kind === 'project_task_template') return <TaskTemplateEditor value={value} onChange={onChange} projects={projectTargets} ariaLabel={ariaLabel} />
    if (kind === 'project_task' && projectTargets.length === 0) return <NoProjectsHint />
    const opts = optionsFor(kind, options)
    if (opts && op?.multi) {
      const selected = value.split(',').map(v => v.trim()).filter(Boolean)
      return (
        <Sel multiple aria-label={ariaLabel} value={selected} size={Math.min(5, Math.max(3, opts.length))}
          onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value).join(', '))}
         >
          {opts.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </Sel>
      )
    }
    if (opts && opts.length > 12) return (
      <div style={{ minWidth: 0 }}>
        <SearchableSelect value={value} onChange={onChange} placeholder="Selecione..." searchPlaceholder="Buscar..."
          options={[{ value: '', label: 'Selecione...' }, ...opts.map(o => ({ value: o.id, label: o.label }))]} />
      </div>
    )
    if (opts) return (
      <Sel aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Selecione...</option>
        {opts.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
      </Sel>
    )
    return <Inp aria-label={ariaLabel} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={op?.multi ? 'Valores separados por vírgula' : placeholder} maxLength={1000} />
  }

  const condPlaceholder = (cond: Condition) => {
    const multi = cond.operator === 'in' || cond.operator === 'not_in'
    if (cond.field === 'email_domain') return multi ? 'ex: suaempresa.com, outraempresa.com.br' : 'ex: suaempresa.com.br'
    if (cond.field === 'email') return multi ? 'ex: fulano@suaempresa.com.br, ciclano@suaempresa.com.br' : 'ex: fulano@suaempresa.com.br'
    return 'Valor...'
  }

  const closeEditor = () => { setEditing(null); setEditForm(null) }

  const renderActions = (list: 'actions' | 'elseActions', canRemoveLast: boolean) => (editForm[list] || []).map((action: Action, i: number) => {
    const def = actionType(action.type)
    return (
      <div key={i} className="rule-line" data-action>
        <Sel aria-label={`Ação ${i + 1}`} value={action.type} onChange={e => updateList(list, i, { type: e.target.value, value: '' })}>
          {catalog.actions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Sel>
        {renderValue(def?.kind ?? 'text', def?.options, undefined, action.value, v => updateList(list, i, { value: v }), `Valor da ação ${i + 1}`)}
        {(canRemoveLast || editForm[list].length > 1) && <button type="button" className="icon-act danger" onClick={() => removeFrom(list, i)} aria-label="Remover ação"><X size={15}/></button>}
      </div>
    )
  })

  const block = (title: string, children: ReactNode) => <section className="rule-block"><h4>{title}</h4><div>{children}</div></section>
  const addLink = (onClick: () => void, label: string) => <button type="button" className="cfg-link" style={{ marginTop: 6 }} onClick={onClick}>{label}</button>

  return (
    <div className="cfg-page">
      <PageHeader title="Roteamento" subtitle={`${rules.length} regras — processadas em ordem de prioridade`} actions={<Btn size="sm" onClick={startNew}>Nova regra</Btn>} />
      <div className="cfg-body">
        <p className="cfg-sub" style={{ margin: '0 0 16px' }}>
          Arraste para reordenar. Em cada gatilho as regras rodam em ordem; uma regra marcada para "parar aqui" encerra a avaliação.
        </p>
        <div className="rule-row" data-head>
          {['Ordem', 'Regra', 'Se', 'Então', 'Ativa', ''].map((h, i) => <span key={i}>{h}</span>)}
        </div>
        {rules.map((rule, i) => (
          <div key={rule.id} draggable className="rule-row" data-over={dragOver === i || undefined} data-drag={dragItem === i || undefined}
            onDragStart={() => setDragItem(i)} onDragOver={e => { e.preventDefault(); setDragOver(i) }}
            onDragLeave={() => setDragOver(null)} onDrop={() => handleDrop(i)} onDragEnd={() => { setDragItem(null); setDragOver(null) }}>
            <div className="rule-grip"><GripVertical size={14}/>{rule.priority}</div>
            <div>
              <div className={rule.enabled ? 'cfg-strong' : 'cfg-off'}>{rule.name}</div>
              <div className="cfg-sub" style={{ margin: 0 }}>
                {[(triggerOf(rule.trigger)?.label || rule.trigger).replace(' X ', ` ${rule.triggerHours ?? 'X'} `), !rule.stopProcessing && 'continua avaliando', !rule.enabled && 'desativada'].filter(Boolean).join(', ')}
              </div>
            </div>
            <div className="rule-text">
              {Array.isArray(rule.conditions) && rule.conditions.map((c, ci) => {
                const f = condField(c.field)
                const op = operator(c.operator)
                return (
                  <div key={ci}>
                    {ci > 0 && (rule.matchType === 'any' ? 'ou ' : 'e ')}{f?.label || c.field} {op?.label || c.operator}
                    {!op?.noValue && <> <b>{labelOf(f?.kind ?? 'text', f?.options, c.value)}</b></>}
                  </div>
                )
              })}
            </div>
            <div className="rule-text">
              {Array.isArray(rule.actions) && rule.actions.map((a, ai) => {
                const def = actionType(a.type)
                return <div key={ai}>{def?.label || a.type}{def?.kind !== 'none' && <>: <b>{labelOf(def?.kind ?? 'text', def?.options, a.value)}</b></>}</div>
              })}
            </div>
            <div className="rule-ctl" style={{ paddingTop: 2 }}><Toggle value={rule.enabled} onChange={() => toggleEnabled(rule.id)} label={`${rule.name} ativa`} /></div>
            <div className="rule-ctl cfg-actions" style={{ marginTop: -5 }}>
              <button type="button" className="icon-act" onClick={() => startEdit(rule)} aria-label="Editar regra" title="Editar"><Edit size={15}/></button>
              <button type="button" className="icon-act danger" onClick={() => deleteRule(rule.id)} aria-label="Excluir regra" title="Excluir"><Trash2 size={15}/></button>
            </div>
          </div>
        ))}
      </div>

      {editing && editForm && (
        <Modal isOpen onClose={closeEditor} preventBackdropClose title={editing === 'new' ? 'Nova regra' : 'Editar regra'} width={860}
          footer={<>
            <Btn variant="secondary" onClick={closeEditor}>Cancelar</Btn>
            <Btn onClick={saveEdit}>Salvar regra</Btn>
          </>}>
          <Field label="Nome da regra" required style={{ marginBottom: 20 }}>
            <Inp value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} maxLength={120} showCount />
          </Field>

          {block('Quando', (
            <div className="cfg-pair">
              <Sel aria-label="Quando" value={editForm.trigger} onChange={e => setEditForm({ ...editForm, trigger: e.target.value })}>
                {catalog.triggers.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Sel>
              {triggerOf(editForm.trigger)?.needsHours && (
                <label className="cfg-inline" style={{ flexWrap: 'nowrap', fontSize: 14 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>Horas parado</span>
                  <Inp type="number" min={1} max={720} value={editForm.triggerHours ?? ''} onChange={e => setEditForm({ ...editForm, triggerHours: e.target.value })} />
                </label>
              )}
            </div>
          ))}

          {block('Se', <>
            {editForm.conditions.length > 1 && (
              <Sel aria-label="Combinar condições" value={editForm.matchType || 'all'} onChange={e => setEditForm({ ...editForm, matchType: e.target.value })} style={{ width: 260, marginBottom: 6 }}>
                <option value="all">Todas as condições valem</option>
                <option value="any">Qualquer uma das condições vale</option>
              </Sel>
            )}
            <div>
              {editForm.conditions.map((cond: Condition, i: number) => {
                const f = condField(cond.field)
                return (
                  <div key={i} className="rule-line">
                    <Sel aria-label={`Campo da condição ${i + 1}`} value={cond.field} onChange={e => changeField(i, e.target.value)}>
                      {catalog.fields.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </Sel>
                    <Sel aria-label={`Operador da condição ${i + 1}`} value={cond.operator} onChange={e => updateList('conditions', i, { operator: e.target.value, ...(operator(e.target.value)?.noValue ? { value: '' } : {}) })}>
                      {(f?.operators ?? []).map(id => <option key={id} value={id}>{operator(id)?.label || id}</option>)}
                    </Sel>
                    {renderValue(f?.kind ?? 'text', f?.options, operator(cond.operator), cond.value, v => updateList('conditions', i, { value: v }), `Valor da condição ${i + 1}`, condPlaceholder(cond))}
                    {editForm.conditions.length > 1 && <button type="button" className="icon-act danger" onClick={() => removeFrom('conditions', i)} aria-label="Remover condição"><X size={15}/></button>}
                  </div>
                )
              })}
            </div>
            {addLink(() => addTo('conditions', blankCondition()), 'Adicionar condição')}
          </>)}

          {block('Então', <>
            <div>{renderActions('actions', false)}</div>
            {addLink(() => addTo('actions', blankAction()), 'Adicionar ação')}
          </>)}

          {block('Senão', <>
            {editForm.elseActions?.length > 0
              ? <div>{renderActions('elseActions', true)}</div>
              : <div className="cfg-off" style={{ fontSize: 14, margin: '8px 0 0' }}>Nenhuma ação alternativa configurada.</div>}
            {addLink(() => addTo('elseActions', blankAction()), 'Adicionar ação alternativa')}
          </>)}

          {block('Depois', (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8, fontSize: 14 }}>
              <span className="cfg-inline">
                <Toggle value={editForm.stopProcessing} onChange={v => setEditForm({ ...editForm, stopProcessing: v })} label="Parar aqui quando aplicada" />
                {editForm.stopProcessing ? 'Para aqui quando aplicada' : 'Continua avaliando as próximas regras'}
              </span>
              <span className="cfg-inline">
                <Toggle value={editForm.enabled} onChange={v => setEditForm({ ...editForm, enabled: v })} label="Regra ativa" />
                Regra ativa
              </span>
            </div>
          ))}

          {block('Testar', <RuleTester form={editForm} />)}
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => performDeleteRule(confirmDelete.id)}
          title="Excluir regra"
          message="Deseja realmente excluir esta regra de roteamento? O tráfego será reprocessado pelas regras restantes."
          confirmText="Excluir"
          variant="danger"
        />
      )}
    </div>
  )
}

type TestResult = {
  ticket: { id: string; displayNumber: string; title: string }
  matched: boolean
  branch: 'then' | 'else' | null
  conditions: { field: string; operator: string; expected: string; actual: string; result: boolean }[]
  actions: { description: string; warning: string | null }[]
}

// Roda a regra em edição (mesmo sem salvar) contra um chamado real, sem aplicar nada.
function RuleTester({ form }: { form: any }) {
  const [ticket, setTicket]   = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult]   = useState<TestResult | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const run = async () => {
    if (!ticket.trim()) return
    setRunning(true); setError(null); setResult(null)
    try {
      setResult(await adminService.testRoutingRule({ ...form, triggerHours: Number(form.triggerHours) || null }, ticket.trim()))
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <p className="cfg-sub" style={{ margin: '8px 0 10px' }}>Mostra o que esta regra faria em um chamado existente. Nada é alterado.</p>
      <form onSubmit={e => { e.preventDefault(); run() }} style={{ display: 'flex', gap: 8 }}>
        <Inp aria-label="Número do chamado" value={ticket} onChange={e => setTicket(e.target.value)} placeholder="Nº do chamado (ex: ISA-1234)" maxLength={60} />
        <Btn variant="secondary" type="submit" disabled={running || !ticket.trim()}>{running ? 'Testando...' : 'Testar'}</Btn>
      </form>

      {error && <div role="alert" className="cfg-error" style={{ marginTop: 10 }}>{error}</div>}

      {result && (
        <div aria-live="polite" style={{ marginTop: 18, fontSize: 14, lineHeight: 1.5 }}>
          <div><b style={{ fontWeight: 500 }}>{result.ticket.displayNumber}</b> {result.ticket.title}</div>
          <div style={{ fontWeight: 600, margin: '4px 0 10px' }}>{result.matched ? 'Condições atendidas' : 'Condições não atendidas'}</div>
          <ul className="cfg-lines">
            {result.conditions.map((c, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 12, padding: '8px 0', overflowWrap: 'anywhere' }}>
                <span style={{ color: c.result ? 'var(--text-2)' : 'var(--danger)' }}>{c.result ? 'Atende' : 'Não atende'}</span>
                <span>
                  {c.field} {c.operator} {c.expected && <b style={{ fontWeight: 500 }}>{c.expected}</b>}
                  <span className="cfg-sub" style={{ display: 'block', margin: 0 }}>No chamado: {c.actual || '—'}</span>
                </span>
              </li>
            ))}
          </ul>
          <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>
            {result.branch === 'then' ? 'Aplicaria (Então)' : result.branch === 'else' ? 'Aplicaria (Senão)' : 'Nenhuma ação seria aplicada'}
          </div>
          {result.actions.length > 0 && (
            <ul className="cfg-lines">
              {result.actions.map((a, i) => (
                <li key={i} style={{ padding: '8px 0' }}>
                  {a.description}
                  {a.warning && <div style={{ fontSize: 13, color: 'var(--warning)' }}>Seria ignorada: {a.warning}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function NoProjectsHint() {
  return <div className="cfg-off" style={{ fontSize: 14 }}>Você não é membro (com edição) de nenhum projeto ativo.</div>
}

/** Valor da ação "Criar task no projeto e vincular": projeto, tipo e prazo em dias (JSON). */
function TaskTemplateEditor({ value, onChange, projects, ariaLabel }: { value: string; onChange: (v: string) => void; projects: ProjectTarget[]; ariaLabel: string }) {
  if (projects.length === 0) return <NoProjectsHint />
  const tpl = parseTemplate(value)
  const project = projects.find(p => p.id === tpl.projectId)
  const set = (patch: Partial<TaskTemplate>) => {
    const next = { projectId: tpl.projectId ?? '', taskTypeId: tpl.taskTypeId ?? '', dueInDays: tpl.dueInDays ?? 5, ...patch }
    onChange(JSON.stringify(next))
  }
  return (
    <div style={{ minWidth: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Sel aria-label={`${ariaLabel}: projeto`} value={tpl.projectId ?? ''} onChange={e => set({ projectId: e.target.value, taskTypeId: '' })} style={{ flex: '1 1 140px' }}>
        <option value="">Projeto...</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Sel>
      <Sel aria-label={`${ariaLabel}: tipo da task`} value={tpl.taskTypeId ?? ''} disabled={!project} onChange={e => set({ taskTypeId: e.target.value })} style={{ flex: '1 1 110px' }}>
        <option value="">Tipo...</option>
        {project?.taskTypes.map(t => <option key={t.id} value={t.id}>{t.prefix} · {t.name}</option>)}
      </Sel>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
        Prazo
        <Inp aria-label={`${ariaLabel}: prazo em dias`} type="number" min={1} max={365} value={String(tpl.dueInDays ?? 5)}
          onChange={e => set({ dueInDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} style={{ width: 72 }} />
        dias
      </label>
    </div>
  )
}
