import { toast } from '@/store/toastStore'
import { useState, useEffect, type ReactNode } from 'react'
import { adminService } from '@/services/adminService'
import type { SlaConfig } from '@/types'
import { Btn, Field, Inp, Sel, Modal, PageHeader, ConfirmModal, AlertModal } from '@/components/ui'
import { Edit, Trash2 } from 'lucide-react'
import { ColorSwatch } from './parts'

const safeInt = (val: string): number | '' => val === '' ? '' : parseInt(val, 10)

function NumericInput({ value, onChange }: { value: number | '', onChange: (v: number | '') => void }) {
  return (
    <Inp
      type="number"
      min={1}
      value={value}
      onChange={e => onChange(safeInt(e.target.value))}
    />
  )
}

function ColorPicker({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  return (
    <div className="cfg-row">
      Cor
      <span className="cfg-inline"><code className="cfg-mono">{value.startsWith('#') ? value.toUpperCase() : 'Padrão'}</code><ColorSwatch value={value.startsWith('#') ? value : '#0f73ac'} onChange={onChange} /></span>
    </div>
  )
}

/** Seleção múltipla dos pacotes adicionais e das categorias do plano. */
function CheckList({ items, selectedIds, onChange, emptyText }: {
  items: any[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  emptyText: string
}) {
  if (items.length === 0) return <div className="cfg-sub">{emptyText}</div>
  return (
    <div className="cfg-lines" style={{ maxHeight: 240, overflowY: 'auto' }}>
      {items.map((item: any) => (
        <label key={item.id} className="cfg-check">
          <input
            type="checkbox"
            checked={selectedIds.includes(item.id)}
            onChange={() => onChange(selectedIds.includes(item.id) ? selectedIds.filter(x => x !== item.id) : [...selectedIds, item.id])}
          />
          <span>{item.name}{item.description && <small>{item.description}</small>}</span>
        </label>
      ))}
    </div>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const TYPE_KEYS = ['incident', 'request', 'problem', 'change'] as const
const TYPE_LABELS: Record<string, string> = { incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança' }

const numericTypeFields = (f: Record<string, any>) => {
  const out: Record<string, number> = {}
  for (const t of TYPE_KEYS) {
    out[`${t}_first_response_hours`] = Number(f[`${t}_first_response_hours`])
    out[`${t}_resolution_hours`] = Number(f[`${t}_resolution_hours`])
  }
  return out
}

export function SLAPanel() {
  const [slaConfigs, setSlaConfigs] = useState<SlaConfig[]>([])
  const [orgs, setOrgs] = useState<any[]>([])
  const [queues, setQueues] = useState<any[]>([])
  const [allPackages, setAllPackages] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTier, setEditingTier] = useState<SlaConfig | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [newForm, setNewForm] = useState<Record<string, any>>({
    tier: '', color: '#0f73ac', default_queue: '', escalation_queue: '', escalation_minutes: 30,
    incident_first_response_hours: 4, incident_resolution_hours: 24,
    request_first_response_hours: 8, request_resolution_hours: 48,
    problem_first_response_hours: 8, problem_resolution_hours: 72,
    change_first_response_hours: 24, change_resolution_hours: 120,
  })
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string, tier: string } | null>(null)
  const [alert, setAlert] = useState<{ isOpen: boolean, title: string, message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(TYPE_KEYS))

  const loadData = () => {
    Promise.all([
      adminService.getSlaConfigs(),
      adminService.getOrganizations(),
      adminService.getQueues(),
      adminService.getAdditionalPackages(),
      adminService.getCategories(),
      adminService.getTicketTypeConfigs(),
    ]).then(([s, o, q, pkgs, cats, typeConfigs]) => {
      setSlaConfigs(s)
      setOrgs(o)
      setQueues(q)
      setAllPackages(pkgs)
      setCategories(cats)
      setEnabledTypes(new Set((typeConfigs as { type: string; enabled: boolean }[]).filter(c => c.enabled).map(c => c.type)))
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  const validateForm = (f: Record<string, any>): string | null => {
    for (const t of TYPE_KEYS) {
      if (!enabledTypes.has(t)) continue
      const r = Number(f[`${t}_first_response_hours`])
      const res = Number(f[`${t}_resolution_hours`])
      if (!f[`${t}_first_response_hours`] && f[`${t}_first_response_hours`] !== 0) return `Informe o tempo de 1ª resposta de ${TYPE_LABELS[t]}.`
      if (isNaN(r) || r < 1) return `1ª Resposta de ${TYPE_LABELS[t]} deve ser no mínimo 1 hora.`
      if (!f[`${t}_resolution_hours`] && f[`${t}_resolution_hours`] !== 0) return `Informe o tempo de resolução de ${TYPE_LABELS[t]}.`
      if (isNaN(res) || res < 1) return `Resolução de ${TYPE_LABELS[t]} deve ser no mínimo 1 hora.`
    }
    const esc = Number(f.escalation_minutes)
    if (f.escalation_minutes !== undefined && (isNaN(esc) || esc < 1)) return 'Antecedência de escalonamento deve ser no mínimo 1 minuto.'
    return null
  }

  const openEdit = (config: any) => {
    setEditingTier(config)
    setForm({ ...config, color: config.color || 'var(--accent)' })
    // Pré-seleciona os pacotes e categorias já vinculados ao plano
    setSelectedPackageIds((config.packages ?? []).map((p: any) => p.id))
    setSelectedCategoryIds((config.categories ?? []).map((c: any) => c.id))
    setShowEditModal(true)
  }

  // Fila salva no plano que não existe mais no cadastro: mostra vazio para forçar escolha
  // (senão o select exibe a 1ª fila mas mantém o id fantasma, e a 1ª fila nem dispara onChange).
  const queueName = (id: string | null | undefined) => queues.find(q => q.id === id)?.name
  const queueOrEmpty = (id: string | null | undefined) => (queueName(id) ? (id as string) : '')
  const missingQueueError = (f: Record<string, any>) =>
    !queueOrEmpty(f.default_queue) ? 'Escolha a fila padrão do plano (a fila salva não existe mais ou não foi selecionada).'
      : !queueOrEmpty(f.escalation_queue) ? 'Escolha a fila de escalonamento do plano (a fila salva não existe mais ou não foi selecionada).'
        : null

  const saveSla = async () => {
    if (!editingTier) return
    const err = validateForm(form) || missingQueueError(form)
    if (err) return setAlert({ isOpen: true, title: 'Dados inválidos', message: err })
    setSaving(true)
    try {
      // Salva o plano base, a alocação de pacotes e as categorias em paralelo
      await Promise.all([
        adminService.updateSlaConfig(editingTier.id, {
          ...form,
          ...numericTypeFields(form),
          escalation_minutes: Number(form.escalation_minutes) || 30,
        }),
        adminService.setPlanPackages(editingTier.id, selectedPackageIds),
        adminService.setPlanCategories(editingTier.id, selectedCategoryIds),
      ])
      setShowEditModal(false)
      setEditingTier(null)
      loadData()
      toast.success('Plano de SLA salvo.')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Não foi possível salvar o plano. Tente novamente.'
      setAlert({ isOpen: true, title: 'Erro ao salvar', message: msg })
    } finally {
      setSaving(false)
    }
  }

  const deleteSla = (config: SlaConfig) => {
    setConfirmDelete({ isOpen: true, id: config.id, tier: config.tier })
  }

  const performDeleteSla = async (id: string) => {
    try {
      await adminService.deleteSlaConfig(id)
      loadData()
      toast.success('Plano de SLA excluído.')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Não foi possível excluir o plano. Tente novamente.'
      setAlert({ isOpen: true, title: 'Erro ao excluir', message: msg })
    }
  }

  const createSla = async () => {
    if (!newForm.tier) return setAlert({ isOpen: true, title: 'Erro', message: 'O nome do tier é obrigatório.' })
    const err = validateForm(newForm) || missingQueueError(newForm)
    if (err) return setAlert({ isOpen: true, title: 'Dados inválidos', message: err })
    try {
      await adminService.createSlaConfig({
        ...newForm,
        ...numericTypeFields(newForm),
        escalation_minutes: Number(newForm.escalation_minutes) || 30,
      })
      setShowNewModal(false)
      setNewForm({
        tier: '', color: '#0f73ac', default_queue: '', escalation_queue: '', escalation_minutes: 30,
        incident_first_response_hours: 4, incident_resolution_hours: 24,
        request_first_response_hours: 8, request_resolution_hours: 48,
        problem_first_response_hours: 8, problem_resolution_hours: 72,
        change_first_response_hours: 24, change_resolution_hours: 120,
      })
      loadData()
      toast.success('Plano de SLA criado.')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Não foi possível criar o tier. Tente novamente.'
      setAlert({ isOpen: true, title: 'Erro ao criar', message: msg })
    }
  }

  const dataRow = (label: ReactNode, cell: (config: any) => ReactNode, key?: string) => (
    <tr key={key}>
      <th scope="row">{label}</th>
      {slaConfigs.map(config => <td key={config.id}>{cell(config)}</td>)}
    </tr>
  )
  const group = (label: string) => <tr><th scope="rowgroup" colSpan={slaConfigs.length + 1}>{label}</th></tr>
  const names = (list: any[] | undefined) => list?.length ? list.map(x => x.name).join(', ') : <span className="cfg-off">Nenhum</span>
  const missing = (id: string | null | undefined) => !queueName(id)

  const planFields = (f: Record<string, any>, set: (f: Record<string, any>) => void) => (
    <>
      {TYPE_KEYS.filter(t => enabledTypes.has(t)).map(t => (
        <div key={t} className="cfg-pair">
          <Field label={`1ª Resposta, ${TYPE_LABELS[t]} (h)`} required>
            <NumericInput value={f[`${t}_first_response_hours`]} onChange={v => set({ ...f, [`${t}_first_response_hours`]: v })} />
          </Field>
          <Field label={`Resolução, ${TYPE_LABELS[t]} (h)`} required>
            <NumericInput value={f[`${t}_resolution_hours`]} onChange={v => set({ ...f, [`${t}_resolution_hours`]: v })} />
          </Field>
        </div>
      ))}
      <div className="cfg-pair">
        {([['default_queue', 'Fila padrão'], ['escalation_queue', 'Fila de escalação']] as const).map(([key, label]) => (
          <Field key={key} label={label}>
            <Sel value={queueOrEmpty(f[key])} onChange={e => set({ ...f, [key]: e.target.value })} aria-label={label} aria-invalid={!queueOrEmpty(f[key])}>
              <option value="" disabled>Selecione uma fila…</option>
              {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
            </Sel>
          </Field>
        ))}
      </div>
      <Field label="Escalonamento automático (min. antes do vencimento)" required>
        <NumericInput value={f.escalation_minutes ?? 30} onChange={v => set({ ...f, escalation_minutes: v })} />
      </Field>
      <ColorPicker value={f.color || 'var(--accent)'} onChange={v => set({ ...f, color: v })} />
    </>
  )

  return (
    <div className="cfg-page">
      <PageHeader title="Planos" subtitle="Acordos de nível de serviço por tier de cliente" actions={<Btn size="sm" onClick={() => setShowNewModal(true)}>Novo plano</Btn>} />
      <div className="cfg-body">
        <div className="cfg-scroll">
          <table className="table sla-table" style={{ minWidth: 220 + slaConfigs.length * 160 }}>
            <colgroup><col /></colgroup>
            <thead>
              <tr>
                <th aria-label="Prazo" />
                {slaConfigs.map(config => (
                  <th key={config.id} scope="col">
                    <strong>{cap(config.tier)}</strong>
                    <div className="cfg-actions">
                      <button type="button" className="icon-act" aria-label={`Editar plano ${config.tier}`} title="Editar" onClick={() => openEdit(config)}><Edit size={14} /></button>
                      <button type="button" className="icon-act danger" aria-label={`Excluir plano ${config.tier}`} title="Excluir" onClick={() => deleteSla(config)}><Trash2 size={14} /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group('Primeira resposta')}
              {TYPE_KEYS.filter(t => t === 'incident' || enabledTypes.has(t)).map(t => dataRow(TYPE_LABELS[t], c => `${c[`${t}_first_response_hours`]}h`, t))}
            </tbody>
            <tbody>
              {group('Resolução')}
              {TYPE_KEYS.filter(t => t === 'incident' || enabledTypes.has(t)).map(t => dataRow(TYPE_LABELS[t], c => `${c[`${t}_resolution_hours`]}h`, t))}
              {dataRow('Escalonamento antes do vencimento', c => `${c.escalation_minutes ?? 30}min`)}
            </tbody>
            <tbody>
              {group('Filas')}
              {queues.map(q => dataRow(q.name, c => [c.default_queue === q.id && 'Padrão', c.escalation_queue === q.id && 'Escalação'].filter(Boolean).join(' e '), q.id))}
              {slaConfigs.some((c: any) => missing(c.default_queue) || missing(c.escalation_queue)) && dataRow('Fila inexistente', c => {
                const roles = [missing(c.default_queue) && 'Padrão', missing(c.escalation_queue) && 'Escalação'].filter(Boolean)
                return roles.length > 0 && <span className="cfg-error">{roles.join(' e ')}: edite o plano</span>
              })}
            </tbody>
            <tbody>
              {group('Cobertura')}
              {dataRow('Organizações', c => orgs.filter(o => o.tier === c.tier).length)}
              {dataRow('Categorias vinculadas', c => names(c.categories))}
              {dataRow('Pacotes adicionais', c => names(c.packages))}
            </tbody>
          </table>
        </div>

        {showEditModal && editingTier && (
          <Modal isOpen onClose={() => setShowEditModal(false)} title={`Editar SLA: ${cap(editingTier.tier)}`} width={560}
            footer={<>
              <Btn variant="secondary" onClick={() => setShowEditModal(false)} disabled={saving}>Cancelar</Btn>
              <Btn onClick={saveSla} disabled={saving}>{saving ? 'Salvando…' : 'Salvar SLA'}</Btn>
            </>}>
            <div className="cfg-form">
              {planFields(form, setForm)}

              <div className="cfg-group">
                <div className="cfg-group-head">
                  <h4>Categorias vinculadas</h4>
                  <span className="cfg-sub">{selectedCategoryIds.length} vinculada{selectedCategoryIds.length !== 1 ? 's' : ''}</span>
                </div>
                <CheckList items={categories} selectedIds={selectedCategoryIds} onChange={setSelectedCategoryIds} emptyText="Nenhuma categoria cadastrada." />
                <div className="cfg-sub" style={{ margin: 0 }}>O usuário só vê e abre chamados das categorias do seu plano (enquanto o plano não estiver vencido).</div>
              </div>

              <div className="cfg-group">
                <div className="cfg-group-head">
                  <h4>Pacotes adicionais</h4>
                  {selectedPackageIds.length > 0 && <button type="button" className="cfg-link" onClick={() => setSelectedPackageIds([])}>Remover todos os pacotes</button>}
                </div>
                <CheckList items={allPackages} selectedIds={selectedPackageIds} onChange={setSelectedPackageIds} emptyText="Nenhum pacote adicional cadastrado no catálogo." />
              </div>
            </div>
          </Modal>
        )}

        {showNewModal && (
          <Modal isOpen onClose={() => setShowNewModal(false)} title="Novo plano" width={560}
            footer={<>
              <Btn variant="secondary" onClick={() => setShowNewModal(false)}>Cancelar</Btn>
              <Btn onClick={createSla}>Criar plano</Btn>
            </>}>
            <div className="cfg-form">
              <Field label="Nome do plano (ex: diamond)" required>
                <Inp value={newForm.tier} onChange={e => setNewForm({ ...newForm, tier: e.target.value })} placeholder="Identificador único" maxLength={50} showCount />
              </Field>
              {planFields(newForm, setNewForm)}
              <div className="notice">Categorias e pacotes adicionais podem ser vinculados após criar o tier, via "Editar SLA".</div>
            </div>
          </Modal>
        )}
      </div>

      {/* 'orgs' já está carregado para a tabela — conta sem nova chamada de API.
          Em uso => AlertModal (sem botão de confirmar); livre => ConfirmModal normal. */}
      {confirmDelete && (() => {
        const emUso = orgs.filter(o => o.tier === confirmDelete.tier).length
        const nome = confirmDelete.tier.toUpperCase()
        return emUso > 0 ? (
          <AlertModal
            isOpen={confirmDelete.isOpen}
            onClose={() => setConfirmDelete(null)}
            title="Plano em uso"
            message={`O plano "${nome}" está vinculado a ${emUso} organizaç${emUso === 1 ? 'ão' : 'ões'} e não pode ser excluído. Reatribua ${emUso === 1 ? 'essa organização' : 'essas organizações'} a outro plano antes de excluir.`}
            variant="danger"
          />
        ) : (
          <ConfirmModal
            isOpen={confirmDelete.isOpen}
            onClose={() => setConfirmDelete(null)}
            onConfirm={() => performDeleteSla(confirmDelete.id)}
            title="Excluir plano"
            message={`Tem certeza que deseja excluir o tier "${nome}"? Nenhuma organização está vinculada a ele.`}
            confirmText="Excluir"
            variant="danger"
          />
        )
      })()}
      {alert && (
        <AlertModal
          isOpen={alert.isOpen}
          onClose={() => setAlert(null)}
          title={alert.title}
          message={alert.message}
        />
      )}
    </div>
  )
}
