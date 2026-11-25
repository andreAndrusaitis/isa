import { useState, useEffect } from 'react'
import { Modal, Btn, Field, Toggle, PageHeader, TruncatedText, Loading } from '@/components/ui'
import { ticketService } from '@/services/ticketService'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import { useUserScope } from '@/hooks/useUserScope'
import { CarteiraField } from '@/components/CarteiraField'
import './gestao.css'

export function AgentsPanel({ supervisorId, userRole }: { supervisorId: string, userRole?: string }) {
  const [data, setData] = useState<any>({ counts: {}, users: [], queues: [], orgs: [] })
  const [loading, setLoading] = useState(true)
  const [editingUser, setEditingUser] = useState<any>(null)
  // Carteira efetiva do chefe de quem está sendo editado (regra vem do backend).
  const chiefScope = useUserScope(editingUser?.manager_id || editingUser?.managerId || null)
  const [isSaving, setIsSaving] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      ticketService.getGroupedCounts('assignee'),
      adminService.getUsers(),
      adminService.getQueues(),
      adminService.getOrganizations(),
    ]).then(([c, u, q, o]) => {
      setData({ counts: c, users: u, queues: q, orgs: o })
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [supervisorId])

  const handleSave = async () => {
    if (!editingUser) return
    setIsSaving(true)
    try {
      await adminService.updateUser(editingUser.id, {
        queues: editingUser.queues,
        active: editingUser.active,
        name: editingUser.name,
        org_scope_ids: editingUser.org_scope_ids,
      })
      setEditingUser(null)
      toast.success('Usuário atualizado com sucesso!')
      loadData()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao salvar usuário'))
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) return <Loading label="Carregando agentes…" />

  const { counts: COUNTS, users: USERS, queues: QUEUES, orgs: ORGS } = data
  const isManager = userRole === 'manager'

  // Supervisores (ticket masters) diretamente sob este gerente
  const supervisors = isManager
    ? USERS.filter((u: any) => u.role === 'supervisor' && u.manager_id === supervisorId)
    : []
  const supervisorIds = new Set(supervisors.map((s: any) => s.id))

  // Agentes diretamente sob este usuário OU sob um supervisor subordinado
  const agents = USERS.filter((u: any) => {
    if (u.role !== 'agent') return false
    if (u.manager_id === supervisorId) return true
    return isManager && supervisorIds.has(u.manager_id)
  })


  const section = (title: string, items: any[]) => (
    <section className="sect" style={{ marginTop: 0 }}>
      <h3>{title}<small>{items.length}</small></h3>
      {items.length === 0 ? <p className="empty-line">Nenhum encontrado.</p> : (
        <div className="scroll-x sect-body">
          <table className="table">
            <thead><tr><th>Nome</th><th>Filas</th><th>Empresas</th><th>Em aberto</th><th>Resolvidos</th><th></th></tr></thead>
            <tbody>
              {items.map((u: any) => {
                const c = COUNTS[u.id] ?? {}
                const scopeIds: string[] = u.orgScopeIds || u.org_scope_ids || []
                const queues = u.queues.map((q: any) => QUEUES.find((x: any) => x.id === q)?.name ?? q).join(', ')
                const scope = scopeIds.map(id => ORGS.find((o: any) => o.id === id)?.name ?? id).join(', ')
                return (
                  <tr key={u.id}>
                    <td className="main" style={{ width: '28%' }}><TruncatedText text={u.name} /><small title={u.email}>{u.email}</small></td>
                    <td className="main" style={{ width: '26%' }}><TruncatedText text={queues || 'Todas as filas'} /></td>
                    <td className="main" style={{ width: '26%' }}><TruncatedText text={scope || 'Herda do gerente'} /></td>
                    <td className="num">{(c.open ?? 0) + (c.in_progress ?? 0)}</td>
                    <td className="num">{(c.resolved ?? 0) + (c.closed ?? 0)}</td>
                    <td style={{ width: 1 }}><Btn variant="ghost" size="xs" onClick={() => setEditingUser({ ...u, org_scope_ids: scopeIds })}>Editar</Btn></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 48 }}>
      <PageHeader title={isManager ? 'Equipe' : 'Equipe de agentes'} />
      <div style={{ padding: '0 var(--page-gutter)', display: 'grid', gap: 32 }}>
        {isManager && section('Ticket Masters (Supervisores)', supervisors)}
        {section(isManager ? 'Analistas' : 'Agentes', agents)}
      </div>

      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Editar ${editingUser?.role === 'supervisor' ? 'Ticket Master' : 'Analista'}`}
        footer={<>
          <Btn variant="ghost" onClick={() => setEditingUser(null)}>Cancelar</Btn>
          <Btn onClick={handleSave} disabled={isSaving}>{isSaving ? 'Salvando...' : 'Salvar alterações'}</Btn>
        </>}
      >
        {editingUser && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <Field label="Status da conta">
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <Toggle value={editingUser.active} onChange={(v) => setEditingUser({...editingUser, active: v})} />
                <span style={{ fontSize:13, color:'var(--text-2)' }}>{editingUser.active ? 'Ativo' : 'Inativo'}</span>
              </div>
            </Field>

            <Field label="Filas de atendimento">
              <div>
                {QUEUES.map((q: any) => {
                  const isChecked = editingUser.queues.includes(q.id)
                  return (
                    <label key={q.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderTop:'1px solid var(--border)', fontSize:14, cursor:'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...editingUser.queues, q.id]
                            : editingUser.queues.filter((id: string) => id !== q.id)
                          setEditingUser({...editingUser, queues: next})
                        }}
                      />
                      {q.name}
                    </label>
                  )
                })}
              </div>
            </Field>

            <CarteiraField
              key={editingUser.id}
              role={editingUser.role}
              allOrgs={ORGS}
              chiefScope={chiefScope}
              chiefName={USERS.find((u: any) => u.id === (editingUser.manager_id || editingUser.managerId))?.name}
              orgIds={editingUser.org_scope_ids || []}
              all={false}
              canSetAll={false}
              hasQueues={(editingUser.queues || []).length > 0}
              onChange={({ orgIds }) => setEditingUser({ ...editingUser, org_scope_ids: orgIds })}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
