import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Btn, ConfirmModal, Modal, Sel, Loading } from '@/components/ui'
import { listMembers, updateMemberRole, removeMember, addProjectMember } from '@/services/projectsService'
import { ProjectMemberWithUser, ProjectMemberRole } from '@/types/projects'
import { useAuthStore } from '@/store/auth'
import { UserPicker } from '@/components/projects/UserPicker'
import { useProjectRole } from '@/components/projects/projectRole'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import '@/components/projects/insights/projects.css'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'

const ROLE_LABEL: Record<ProjectMemberRole, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  member: 'Membro',
  viewer: 'Visualizador',
}

export default function ProjectMembersPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const currentUser = useAuthStore(s => s.user)!
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [removeTarget, setRemoveTarget] = useState<ProjectMemberWithUser | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pendingUser, setPendingUser] = useState<{ id: string; name: string } | null>(null)
  const [pendingRole, setPendingRole] = useState<ProjectMemberRole>('member')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    listMembers(projectId)
      .then(setMembers)
      .catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar os membros do projeto.')))
      .finally(() => setLoading(false))
  }, [projectId])

  // Papel efetivo vem do shell (GET /projects/:id): admin é dono efetivo sem
  // estar na lista de membros, então não dá para derivar da lista.
  const { canConfigure: canManage, isOwner } = useProjectRole()

  // Dono mexe em qualquer um, inclusive outros donos; a própria linha de dono
  // fica travada (o backend recusa tirar o último dono com LAST_OWNER).
  const canTouch = (member: ProjectMemberWithUser) =>
    member.role !== 'owner' || (isOwner && member.userId !== currentUser.id)

  async function handleRoleChange(userId: string, role: ProjectMemberRole) {
    if (!projectId) return
    try {
      const updated = await updateMemberRole(projectId, userId, role)
      // A resposta do PATCH não traz `user`: só o papel muda na linha.
      setMembers(prev => prev.map(m => (m.userId === userId ? { ...m, role: updated?.role ?? role } : m)))
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível alterar o papel.'))
    }
  }

  async function handleRemoveConfirmed() {
    if (!projectId || !removeTarget) return
    // O ConfirmModal fecha (e zera removeTarget) antes de a chamada terminar.
    const target = removeTarget
    try {
      await removeMember(projectId, target.userId)
      setMembers(prev => prev.filter(m => m.userId !== target.userId))
    } catch (err) {
      toast.error(apiErrorMessage(err, `Não foi possível remover ${target.user.name}.`))
    } finally {
      setRemoveTarget(null)
    }
  }

  function openAdd() {
    setPendingUser(null)
    setPendingRole('member')
    setAddError(null)
    setAddOpen(true)
  }

  async function handleAddConfirmed() {
    if (!projectId || !pendingUser || adding) return
    setAdding(true)
    setAddError(null)
    try {
      await addProjectMember(projectId, pendingUser.id, pendingRole)
      const updated = await listMembers(projectId)
      setMembers(updated)
      setAddOpen(false)
    } catch (err: any) {
      setAddError(err?.response?.data?.error ?? 'Não foi possível adicionar esta pessoa.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="prj-body" style={{ gap: 12 }}>
      <div className="prj-tools" style={{ justifyContent: 'space-between' }}>
        <span className="prj-note">{loading ? '' : `${members.length} pessoa(s) neste projeto`}</span>
        {canManage && <Btn variant="primary" size="sm" onClick={openAdd}>Adicionar membro</Btn>}
      </div>
      {loading ? <Loading size="compact" label="Carregando membros…" /> : (
        <div className="prj-scroll">
          <table className="table prj">
            <thead><tr><th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col"><span style={visuallyHidden}>Ação</span></th></tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td style={{ color: 'var(--text-1)' }}>{member.user.name}</td>
                  <td>
                    <select
                      className="prj-select"
                      value={member.role}
                      disabled={!isOwner || !canTouch(member)} // trocar papel: só o dono (backend)
                      aria-label={`Papel de ${member.user.name}`}
                      onChange={e => handleRoleChange(member.userId, e.target.value as ProjectMemberRole)}
                    >
                      {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    {canManage && canTouch(member) && <Btn variant="ghost" size="xs" onClick={() => setRemoveTarget(member)}>Remover</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveConfirmed}
        title="Remover membro"
        message={`Remover ${removeTarget?.user.name} deste projeto?`}
        confirmText="Confirmar"
        variant="danger"
      />

      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Adicionar membro"
        footer={
          <Btn variant="primary" size="sm" onClick={handleAddConfirmed} disabled={!pendingUser || adding}>
            {adding ? 'Adicionando…' : 'Adicionar'}
          </Btn>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {addError && <div role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>{addError}</div>}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>Pessoa</label>
            <UserPicker onSelect={setPendingUser} />
            {pendingUser && (
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)' }}>
                Selecionado: <strong style={{ color: 'var(--text-1)' }}>{pendingUser.name}</strong>
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>Papel no projeto</label>
            <Sel value={pendingRole} onChange={(e: any) => setPendingRole(e.target.value as ProjectMemberRole)}>
              {/* Só o dono adiciona outro dono */}
              {Object.entries(ROLE_LABEL).filter(([value]) => value !== 'owner' || isOwner).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Sel>
          </div>
        </div>
      </Modal>
    </div>
  )
}
