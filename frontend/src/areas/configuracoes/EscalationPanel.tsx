import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { Btn, Field, Inp, Sel, Toggle, Modal, PageHeader, ConfirmModal, Loading, SearchableSelect } from '@/components/ui'
import { toast } from '@/store/toastStore'
import { Edit, Trash2 } from 'lucide-react'
import './configuracoes.css'
import { TYPE_META, describeRule, type EscalationRule, type EscalationType, type TargetMode } from './escalationRules'

const EMPTY_FORM: Partial<EscalationRule> = {
  name: '', type: 'transfer', target_queue_id: null, target_category_id: null, auto_description: null,
  active: true, target_mode: 'queue', target_agent_id: null, keep_origin: false, require_note: false,
  target_priority: null, source_queue_ids: [],
}

const TYPES: EscalationType[] = ['transfer', 'same_ticket', 'child_ticket', 'category_change']

/** Destinos possíveis por tipo (atuação conjunta via fila = fila colaboradora). */
const MODES: Record<Exclude<EscalationType, 'category_change'>, { value: TargetMode; label: string }[]> = {
  transfer: [
    { value: 'queue', label: 'Fila, sem responsável (alguém da fila assume)' },
    { value: 'agent_pick', label: 'Analista escolhido na hora de escalonar' },
    { value: 'agent_fixed', label: 'Analista fixo' },
  ],
  same_ticket: [
    { value: 'agent_pick', label: 'Analista escolhido na hora de escalonar' },
    { value: 'agent_fixed', label: 'Analista fixo' },
    { value: 'queue', label: 'Qualquer analista da fila de destino' },
  ],
  child_ticket: [
    { value: 'queue', label: 'Fila, sem responsável (alguém da fila assume)' },
    { value: 'agent_pick', label: 'Analista escolhido na hora de escalonar' },
    { value: 'agent_fixed', label: 'Analista fixo' },
  ],
}

export function EscalationPanel() {
  const [rules, setRules] = useState<EscalationRule[]>([])
  const [queues, setQueues] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRule, setEditRule] = useState<EscalationRule | null>(null)
  const [form, setForm] = useState<Partial<EscalationRule>>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; id: string } | null>(null)

  useEffect(() => {
    Promise.all([
      adminService.getEscalationRules(),
      adminService.getQueues(),
      adminService.getCategories(),
      adminService.getUsers().catch(() => []),
    ]).then(([r, q, c, u]) => {
      setRules(r); setQueues(q); setCategories(c)
      setStaff((u || []).filter((x: any) => ['agent', 'supervisor', 'manager'].includes(x.role) && x.active !== false && !x.deleted_at))
    }).finally(() => setLoading(false))
  }, [])

  function openNew() { setEditRule(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(rule: EscalationRule) { setEditRule(rule); setForm({ ...EMPTY_FORM, ...rule }); setShowModal(true) }

  const type = (form.type || 'transfer') as EscalationType
  const mode = (form.target_mode || 'queue') as TargetMode
  const needsQueue = type !== 'category_change'

  function setType(t: EscalationType) {
    // Atuação conjunta começa pelo caso mais comum (analista escolhido); os demais pela fila.
    setForm(f => ({ ...f, type: t, target_mode: t === 'same_ticket' ? 'agent_pick' : 'queue', target_agent_id: null, keep_origin: false, target_queue_id: t === 'category_change' ? null : f.target_queue_id }))
  }

  function validate(): string | null {
    if (!form.name?.trim()) return 'Dê um nome para a regra'
    if (needsQueue && !form.target_queue_id) return type === 'child_ticket' ? 'Escolha a fila onde o filho será aberto' : 'Escolha a fila de destino'
    if (type !== 'category_change' && mode === 'agent_fixed' && !form.target_agent_id) return 'Escolha o analista de destino'
    if (type === 'category_change' && !form.target_category_id) return 'Escolha a categoria de destino'
    return null
  }

  async function save() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name!.trim(),
        type,
        target_mode: type === 'category_change' ? 'queue' : mode,
        target_queue_id: type === 'category_change' ? null : (form.target_queue_id || null),
        target_agent_id: mode === 'agent_fixed' ? (form.target_agent_id || null) : null,
        target_category_id: form.target_category_id || null,
        auto_description: form.auto_description?.trim() || null,
        keep_origin: (type === 'transfer' || type === 'child_ticket') ? !!form.keep_origin : false,
        require_note: !!form.require_note,
        target_priority: form.target_priority || null,
        source_queue_ids: form.source_queue_ids ?? [],
        active: form.active ?? true,
      }
      if (editRule) {
        const updated = await adminService.updateEscalationRule(editRule.id, payload)
        setRules(rules.map(r => r.id === editRule.id ? updated : r))
        toast.success('Regra de escalonamento atualizada!')
      } else {
        const created = await adminService.createEscalationRule(payload)
        setRules([...rules, created])
        toast.success('Regra de escalonamento criada com sucesso!')
      }
      setShowModal(false)
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  async function performDelete(id: string) {
    try {
      await adminService.deleteEscalationRule(id)
      setRules(rules.filter(r => r.id !== id))
      toast.success('Regra de escalonamento excluída com sucesso!')
    } catch (err: any) {
      toast.error('Erro ao excluir regra: ' + (err.response?.data?.error || err.message))
    }
  }

  const queueName = (id: string) => queues.find(q => q.id === id)?.name ?? id

  if (loading) return <Loading label="Carregando regras…" />

  return (
    <div className="cfg-page">
      <PageHeader title="Regras de escalonamento" subtitle={`${rules.length} regras configuradas`} actions={<Btn size="sm" onClick={openNew}>Nova regra</Btn>}/>

      <div className="cfg-body">
        {rules.length === 0 ? (
          <div className="cfg-empty">
            Nenhuma regra configurada. Crie regras de escalonamento para que agentes possam escalonar chamados de forma estruturada.
            <div style={{ marginTop: 12 }}><button type="button" className="cfg-link" onClick={openNew}>Criar primeira regra</button></div>
          </div>
        ) : (
          <div className="cfg-scroll">
            <table className="table">
              <thead>
                <tr><th>Regra</th><th>Tipo</th><th>O que faz</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {rules.map(rule => {
                  const t = (TYPE_META[rule.type] ? rule.type : 'same_ticket') as EscalationType
                  const limits = [rule.require_note && 'Exige justificativa', rule.source_queue_ids?.length > 0 && `Só nas filas: ${rule.source_queue_ids.map(queueName).join(', ')}`].filter(Boolean)
                  return (
                    <tr key={rule.id} data-testid={`escalation-rule-${rule.id}`}>
                      <td><span className={rule.active ? 'cfg-strong' : 'cfg-off'}>{rule.name}</span>{!rule.active && <span className="cfg-off"> (inativa)</span>}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{TYPE_META[t].label}</td>
                      <td style={{ color: 'var(--text-2)' }}>
                        {describeRule(rule, queues, staff, categories)}
                        {limits.length > 0 && <div className="cfg-sub">{limits.join(' · ')}</div>}
                      </td>
                      <td>
                        <div className="cfg-actions">
                          <button type="button" className="icon-act" aria-label={`Editar ${rule.name}`} title="Editar" onClick={() => openEdit(rule)}><Edit size={15}/></button>
                          <button type="button" className="icon-act danger" aria-label={`Excluir ${rule.name}`} title="Excluir" onClick={() => setConfirmDelete({ isOpen: true, id: rule.id })}><Trash2 size={15}/></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <Modal isOpen onClose={() => setShowModal(false)} title={editRule ? 'Editar regra' : 'Nova regra de escalonamento'} width={600}
          footer={<>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={!form.name?.trim() || saving}>{saving ? 'Salvando...' : editRule ? 'Salvar' : 'Criar regra'}</Btn>
          </>}>
          <div className="cfg-form">
            <Field label="Nome da regra" required>
              <Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Transferir para Fila de Segurança" maxLength={120} showCount aria-label="Nome da regra" />
            </Field>

            <Field label="O que a regra faz">
              <div role="radiogroup" aria-label="Tipo de escalonamento">
                {TYPES.map(t => (
                  <button key={t} type="button" role="radio" aria-checked={type === t} className="cfg-radio" onClick={() => setType(t)} data-testid={`rule-type-${t}`}>
                    <span>{TYPE_META[t].label}</span>
                    <small>{TYPE_META[t].short}</small>
                  </button>
                ))}
              </div>
            </Field>

            {type !== 'category_change' && (
              <Field label={type === 'same_ticket' ? 'Quem atua junto' : type === 'child_ticket' ? 'Quem recebe o chamado filho' : 'Quem recebe o chamado'}>
                <Sel value={mode} aria-label="Quem recebe" onChange={e => setForm({ ...form, target_mode: e.target.value as TargetMode, target_agent_id: null })}>
                  {MODES[type].map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Sel>
              </Field>
            )}

            {needsQueue && (
              <Field label={type === 'child_ticket' ? 'Fila do chamado filho' : 'Fila de destino'} required>
                <Sel value={form.target_queue_id || ''} aria-label="Fila de destino" onChange={e => setForm({ ...form, target_queue_id: e.target.value || null })}>
                  <option value="">Selecione uma fila...</option>
                  {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </Sel>
                <div className="cfg-sub">
                  {type === 'transfer' && 'O chamado passa para esta fila. Quem recebe vê, assume e resolve o chamado mesmo sem a empresa na carteira.'}
                  {type === 'child_ticket' && 'O filho é aberto nesta fila, com o mesmo solicitante e empresa, vinculado a este chamado. A fila atua no filho mesmo sem a empresa na carteira.'}
                  {type === 'same_ticket' && 'O chamado passa para esta fila e o responsável continua o mesmo. Quem atua junto acessa o chamado mesmo sem a empresa na carteira.'}
                </div>
              </Field>
            )}

            {type !== 'category_change' && mode === 'agent_fixed' && (
              <Field label="Analista de destino" required>
                <SearchableSelect value={form.target_agent_id || ''} aria-label="Analista de destino" onChange={v => setForm({ ...form, target_agent_id: v || null })}
                  placeholder="Selecione o analista..." searchPlaceholder="Buscar analista..."
                  options={[{ value: '', label: 'Selecione o analista...' }, ...staff.map(u => ({ value: u.id, label: u.name }))]} />
                <div className="cfg-sub">Ganha acesso ao chamado pelo escalonamento, mesmo sem a empresa na carteira.</div>
              </Field>
            )}

            {type === 'category_change' && (
              <Field label="Categoria destino" required>
                <Sel value={form.target_category_id || ''} aria-label="Categoria destino" onChange={e => setForm({ ...form, target_category_id: e.target.value || null })}>
                  <option value="">Selecione uma categoria...</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Sel>
              </Field>
            )}

            <div className="cfg-group">
              <h4>Opções</h4>

              {(type === 'transfer' || type === 'child_ticket') && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, cursor: 'pointer' }}>
                  <Toggle value={!!form.keep_origin} onChange={v => setForm({ ...form, keep_origin: v })} label="Manter quem escalonou" />
                  <span>{type === 'transfer' ? 'Quem transferiu continua no chamado como colaborador' : 'Quem escalonou acompanha o chamado filho como colaborador'}</span>
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, cursor: 'pointer' }}>
                <Toggle value={!!form.require_note} onChange={v => setForm({ ...form, require_note: v })} label="Exigir justificativa" />
                <span>Exigir justificativa de quem escalona (vai para a nota interna{type === 'child_ticket' ? ' e para o filho' : ''})</span>
              </label>

              <div className="cfg-pair">
                <Field label="Prioridade ao escalonar">
                  <Sel value={form.target_priority || ''} aria-label="Prioridade ao escalonar" onChange={e => setForm({ ...form, target_priority: (e.target.value || null) as any })}>
                    <option value="">Manter a do chamado</option>
                    <option value="high">Alta</option>
                    <option value="medium">Média</option>
                    <option value="low">Baixa</option>
                  </Sel>
                </Field>
                {type !== 'category_change' && (
                  <Field label="Mudar a categoria (opcional)">
                    <Sel value={form.target_category_id || ''} aria-label="Mudar a categoria" onChange={e => setForm({ ...form, target_category_id: e.target.value || null })}>
                      <option value="">Manter a do chamado</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Sel>
                  </Field>
                )}
              </div>

              <Field label="Disponível nas filas">
                <SearchableSelect multiple value={(form.source_queue_ids ?? []).join(',')} aria-label="Disponível nas filas"
                  onChange={v => setForm({ ...form, source_queue_ids: v.split(',').filter(x => x && x !== 'all') })}
                  placeholder="Todas as filas" searchPlaceholder="Buscar fila..."
                  options={[{ value: 'all', label: 'Todas as filas' }, ...queues.map(q => ({ value: q.id, label: q.name }))]} />
                <div className="cfg-sub">A regra só aparece para chamados que estão nestas filas. Vazio = todas.</div>
              </Field>

              <Field label="Nota automática (opcional)">
                <Inp value={form.auto_description || ''} onChange={e => setForm({ ...form, auto_description: e.target.value || null })} placeholder="Ex: Em análise pela equipe de Segurança" maxLength={255} showCount aria-label="Nota automática" />
              </Field>
            </div>

            <div className="notice" aria-live="polite">
              {describeRule({ ...(EMPTY_FORM as EscalationRule), ...form, type, target_mode: mode } as EscalationRule, queues, staff, categories)}
            </div>

            <div className="cfg-row" style={{ borderTop: 0, paddingTop: 0 }}>
              Regra ativa
              <Toggle value={form.active !== false} onChange={v => setForm({ ...form, active: v })} label="Regra ativa" />
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal isOpen={confirmDelete.isOpen} onClose={() => setConfirmDelete(null)} onConfirm={() => performDelete(confirmDelete.id)}
          title="Excluir regra" message="Deseja excluir esta regra de escalonamento? Esta ação não pode ser desfeita." confirmText="Excluir" variant="danger"/>
      )}
    </div>
  )
}
