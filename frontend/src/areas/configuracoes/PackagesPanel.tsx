import { toast } from '@/store/toastStore'
import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import type { AdditionalPackage } from '@/types'
import {
  Btn,
  Field,
  Inp,
  Txta,
  Modal,
  Toggle,
  PageHeader,
  AlertModal,
  ConfirmModal,
} from '@/components/ui'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { Edit } from 'lucide-react'
import './configuracoes.css'

// Tela de gestão do catálogo de Pacotes adicionais (feature 196).
// Cadastro/edição/ativação — sem exclusão (segue o padrão de Macros).
// Desativar um pacote o remove das alocações dos planos.
export function PackagesPanel() {
  const [packages, setPackages] = useState<AdditionalPackage[]>([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editPkg, setEditPkg] = useState<AdditionalPackage | null>(null)
  const [form, setForm] = useState<{ name: string; description: string }>({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<AdditionalPackage | null>(null)
  const [alert, setAlert] = useState<{ isOpen: boolean; title: string; message: string; variant: 'danger' | 'warning' | 'primary' }>(
    { isOpen: false, title: '', message: '', variant: 'warning' }
  )

  const loadData = () => {
    adminService.getAllPackages().then(setPackages).catch(() => {
      setAlert({ isOpen: true, title: 'Erro', message: 'Não foi possível carregar os pacotes adicionais.', variant: 'danger' })
    })
  }

  useEffect(() => { loadData() }, [])

  const openNew = () => {
    setEditPkg(null)
    setForm({ name: '', description: '' })
    setShowModal(true)
  }

  const openEdit = (pkg: AdditionalPackage) => {
    setEditPkg(pkg)
    setForm({ name: pkg.name, description: pkg.description ?? '' })
    setShowModal(true)
  }

  const save = async () => {
    const name = form.name.trim()
    const description = form.description.trim()
    if (!name) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O nome do pacote é obrigatório.', variant: 'warning' })
      return
    }
    setSaving(true)
    try {
      if (editPkg) await adminService.updatePackage(editPkg.id, { name, description: description || null })
      else await adminService.createPackage({ name, description: description || null })
      setShowModal(false)
      loadData()
      toast.success(editPkg ? 'Pacote atualizado.' : 'Pacote criado.')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Erro ao salvar o pacote adicional.'
      setAlert({ isOpen: true, title: 'Erro', message: msg, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const setActive = async (pkg: AdditionalPackage, active: boolean) => {
    try {
      const updated = await adminService.updatePackage(pkg.id, { active })
      setPackages(prev => prev.map(p => (p.id === pkg.id ? { ...p, active: updated.active } : p)))
    } catch {
      setAlert({ isOpen: true, title: 'Erro', message: 'Erro ao atualizar o pacote.', variant: 'danger' })
    }
  }

  // Ativar é direto; desativar pede confirmação (remove o pacote dos planos).
  const onToggle = (pkg: AdditionalPackage) => {
    if (pkg.active) setConfirmDeactivate(pkg)
    else setActive(pkg, true)
  }

  const filtered = packages.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
  const activeCount = packages.filter(p => p.active).length

  return (
    <div className="cfg-page">
      <PageHeader
        title="Pacotes"
        subtitle={`${activeCount} ativos · ${packages.length} no catálogo`}
        actions={<Btn size="sm" onClick={openNew}>Novo pacote</Btn>}
      />

      <div className="cfg-body">
        <div style={{ marginBottom: 16, display: 'flex' }}>
          <FilterSearchInput placeholder="Buscar pacote pelo nome..." value={search} onChange={setSearch} width={280} maxLength={100} />
        </div>
        {filtered.length === 0 ? (
          <div className="cfg-empty">Nenhum pacote adicional encontrado.</div>
        ) : (
          <div className="cfg-scroll">
            <table className="table">
              <thead>
                <tr><th>Pacote</th><th>Descrição</th><th>Ativo</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {filtered.map(pkg => (
                  <tr key={pkg.id}>
                    <td className={pkg.active ? 'cfg-strong' : 'cfg-off'}>{pkg.name}</td>
                    <td title={pkg.description || undefined}><div className="cfg-clamp">{pkg.description}</div></td>
                    <td title={pkg.active ? 'Desativar' : 'Ativar'}><Toggle value={pkg.active} onChange={() => onToggle(pkg)} label={`${pkg.name} ativo`} /></td>
                    <td><div className="cfg-actions"><button type="button" className="icon-act" aria-label={`Editar ${pkg.name}`} title="Editar" onClick={() => openEdit(pkg)}><Edit size={15} /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        width={520}
        title={editPkg ? 'Editar pacote adicional' : 'Novo pacote adicional'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? '...' : 'Salvar'}</Btn>
          </>
        }
      >
        <div className="cfg-form">
          <Field label="Nome" required>
            <Inp value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Suporte 24x7" maxLength={120} showCount />
          </Field>
          <Field label="Descrição">
            <Txta value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} placeholder="O que este pacote adiciona ao plano..." style={{ resize: 'vertical' }} maxLength={500} showCount />
          </Field>
        </div>
      </Modal>

      {confirmDeactivate && (
        <ConfirmModal
          isOpen={!!confirmDeactivate}
          onClose={() => setConfirmDeactivate(null)}
          onConfirm={() => setActive(confirmDeactivate, false)}
          title="Desativar pacote adicional"
          message={`Desativar "${confirmDeactivate.name}" o removerá de todos os planos onde está alocado e impedirá novas alocações. Deseja continuar?`}
          confirmText="Desativar"
          variant="danger"
        />
      )}

      <AlertModal
        isOpen={alert.isOpen}
        onClose={() => setAlert({ ...alert, isOpen: false })}
        title={alert.title}
        message={alert.message}
        variant={alert.variant}
      />
    </div>
  )
}
