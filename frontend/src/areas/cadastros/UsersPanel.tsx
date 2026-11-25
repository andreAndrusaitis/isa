import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'
import { connectSocket } from '@/services/socketService'
import { Modal, ConfirmModal, AlertModal, EmptyState, Field, PwdInp, Btn, Loading } from '@/components/ui'
import {
  validateNewUser,
  isValidPhoneDigits,
  describeApiError,
  validateUpdateUserAuth,
} from '@/utils/userValidation'
import { UserList, UserDetailView, UserForm } from './users'
import { DetailHead } from './Blocks'

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const currentUserRole = useAuthStore((s) => s.user?.role)

  const [users, setUsers] = useState<any[]>([])
  const [orgs, setOrgs] = useState<any[]>([])
  const [queues, setQueues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<any | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [userTab, setUserTab] = useState('info')
  const [logs, setLogs] = useState<any[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Modal Alterar Senha
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirm: '' })

  // Modal Novo usuário
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState<Record<string, any>>({})

  // Modais de Alerta e Confirmação
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; id: string } | null>(null)
  const [alertInfo, setAlertInfo] = useState<{
    isOpen: boolean
    title: string
    message: string
    variant?: 'danger' | 'primary'
  } | null>(null)

  const accessToken = useAuthStore((s) => s.accessToken)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing

  useEffect(() => {
    Promise.all([
      adminService.getUsers(),
      adminService.getOrganizations(),
      adminService.getQueues(),
    ])
      .then(([u, o, q]) => {
        setUsers(u)
        setOrgs(o)
        setQueues(q)
        setLoading(false)
      })
      .catch((err) => {
        console.error('[UsersPanel] Erro ao carregar dados:', err)
        setError('Erro ao carregar usuários. Verifique a conexão com o servidor.')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (selected && userTab === 'activity') {
      setLogsLoading(true)
      adminService
        .getAuditLogs({ userId: selected.id, limit: 100 })
        .then((data) => {
          setLogs(data.items)
          setLogsLoading(false)
        })
        .catch((err) => {
          console.error('[UsersPanel] Erro ao carregar logs:', err)
          setLogsLoading(false)
        })
    }
  }, [selected, userTab])

  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)

    const handleUserCreated = (data: { user: any; actorId?: string }) => {
      if (!data?.user?.id) return
      setUsers((prev) => {
        if (prev.some((u) => u.id === data.user.id)) return prev
        return [data.user, ...prev]
      })
    }

    const handleUserUpdated = (data: { user: any; actorId?: string }) => {
      if (!data?.user?.id) return
      setUsers((prev) =>
        prev.map((u) => (u.id === data.user.id ? { ...u, ...data.user } : u))
      )
      if (selectedRef.current?.id === data.user.id) {
        setSelected((prev: any) => (prev ? { ...prev, ...data.user } : prev))
        if (!isEditingRef.current) {
          setForm((prev: any) => ({
            ...prev,
            ...data.user,
            authProvider: data.user.authProvider || data.user.auth_provider || 'local',
            orgId: data.user.orgId || data.user.org_id || '',
            manager_id: data.user.managerId || data.user.manager_id || '',
            org_scope_ids: data.user.orgScopeIds || data.user.org_scope_ids || [],
            permissions: data.user.permissions || [],
            newPasswordForLocal: '',
          }))
        }
      }
      if (data.user.id === currentUserId) {
        const currentUser = useAuthStore.getState().user
        if (currentUser) {
          useAuthStore.getState().setAuth(
            {
              ...currentUser,
              name: data.user.name || currentUser.name,
              email: data.user.email || currentUser.email,
              role: data.user.role || currentUser.role,
              permissions: data.user.permissions ?? currentUser.permissions,
              authProvider:
                data.user.authProvider || data.user.auth_provider || currentUser.authProvider,
            },
            useAuthStore.getState().accessToken || ''
          )
        }
      }
    }

    const handleUserDeleted = (data: { userId: string; name?: string }) => {
      if (!data?.userId) return
      setUsers((prev) => prev.filter((u) => u.id !== data.userId))
      if (selectedRef.current?.id === data.userId) {
        setSelected(null)
        setIsEditing(false)
      }
    }

    socket.on('user:created', handleUserCreated)
    socket.on('user:updated', handleUserUpdated)
    socket.on('user:deleted', handleUserDeleted)

    return () => {
      socket.off('user:created', handleUserCreated)
      socket.off('user:updated', handleUserUpdated)
      socket.off('user:deleted', handleUserDeleted)
    }
  }, [accessToken, currentUserId])

  const handleSelectUser = (u: any) => {
    const auth = u.authProvider || u.auth_provider || 'local'
    setSelected(u)
    setForm({
      ...u,
      authProvider: auth,
      orgId: u.orgId || u.org_id || '',
      manager_id: u.manager_id || u.manager?.id || '',
      org_scope_ids: u.orgScopeIds || u.org_scope_ids || [],
      permissions: u.permissions || [],
      newPasswordForLocal: '',
    })
    setUserTab('info')
    setIsEditing(false)
    setSaveSuccess(false)
  }

  const cancelEdit = () => {
    const auth = selected.authProvider || selected.auth_provider || 'local'
    setIsEditing(false)
    setForm({
      ...selected,
      authProvider: auth,
      orgId: selected.orgId || selected.org_id || '',
      manager_id: selected.manager_id || selected.manager?.id || '',
      org_scope_ids: selected.orgScopeIds || selected.org_scope_ids || [],
      permissions: selected.permissions || [],
      newPasswordForLocal: '',
    })
  }

  const saveUser = async () => {
    if (!selected) return
    if (form.role !== 'admin' && !form.orgId && !form.org_id) {
      setAlertInfo({
        isOpen: true,
        title: 'Campo obrigatório',
        message: 'Empresa é obrigatória para este perfil.',
        variant: 'danger',
      })
      return
    }
    if (!isValidPhoneDigits(String(form.phone ?? ''))) {
      setAlertInfo({
        isOpen: true,
        title: 'Telefone incompleto',
        message:
          'O telefone informado está incompleto. Preencha com DDD + número completo (ex: (11) 91234-5678) ou deixe o campo em branco.',
        variant: 'danger',
      })
      return
    }

    const currentAuth = selected.authProvider || selected.auth_provider || 'local'
    const targetAuth = form.authProvider || currentAuth

    if (targetAuth === 'local' && currentAuth === 'microsoft') {
      const authValidation = validateUpdateUserAuth(
        currentAuth,
        targetAuth,
        form.newPasswordForLocal
      )
      if (!authValidation.ok) {
        setAlertInfo({
          isOpen: true,
          title: authValidation.title,
          message: authValidation.message,
          variant: 'danger',
        })
        return
      }
    }

    setSaving(true)
    try {
      const {
        id: _id,
        created_at: _ca,
        updated_at: _ua,
        org: _org,
        org_id: _oid,
        manager: _mgr,
        subordinates: _sub,
        org_scopes: _osc,
        orgScopeIds: _osi,
        newPasswordForLocal,
        ...cleanData
      } = form

      const payload: any = { ...cleanData, authProvider: targetAuth }
      if (targetAuth === 'local' && currentAuth === 'microsoft' && newPasswordForLocal) {
        payload.password = newPasswordForLocal
      }
      const updated = await adminService.updateUser(selected.id, payload)
      const updatedWithScope = {
        ...updated,
        authProvider: updated.authProvider || updated.auth_provider || targetAuth,
        orgScopeIds: cleanData.org_scope_ids ?? selected.orgScopeIds ?? [],
        permissions: updated.permissions ?? selected.permissions ?? [],
      }

      setUsers((prev) => prev.map((u) => (u.id === selected.id ? updatedWithScope : u)))
      setSelected(updatedWithScope)
      setForm({
        ...updatedWithScope,
        authProvider: updatedWithScope.authProvider,
        orgId: updated.orgId || updated.org_id || '',
        manager_id: updated.manager_id || updated.manager?.id || '',
        org_scope_ids: cleanData.org_scope_ids ?? [],
        permissions: updatedWithScope.permissions,
        newPasswordForLocal: '',
      })

      if (selected.id === currentUserId) {
        const currentUser = useAuthStore.getState().user
        if (currentUser) {
          useAuthStore.getState().setAuth(
            {
              ...currentUser,
              permissions: updatedWithScope.permissions,
              authProvider: updatedWithScope.authProvider,
            },
            useAuthStore.getState().accessToken || ''
          )
        }
      }

      setIsEditing(false)
      setSaveSuccess(true)
      toast.success('Usuário atualizado com sucesso!')
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err: any) {
      toast.error(describeApiError(err, 'Não foi possível salvar as alterações.'))
      setAlertInfo({
        isOpen: true,
        title: 'Erro ao salvar',
        message: describeApiError(err, 'Não foi possível salvar as alterações.'),
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const createUser = async () => {
    if (saving) return
    try {
      const { id: _id, ...cleanData } = newForm
      const check = validateNewUser(cleanData)
      if (!check.ok) {
        toast.warning(check.message)
        setAlertInfo({
          isOpen: true,
          title: check.title,
          message: check.message,
          variant: 'danger',
        })
        return
      }
      setSaving(true)
      const created = await adminService.createUser({
        ...cleanData,
        ...check.values,
        permissions: newForm.permissions || [],
      })
      setUsers((prev) => (prev.some((u) => u.id === created.id) ? prev : [created, ...prev]))
      setShowNewModal(false)
      toast.success('Usuário criado com sucesso!')
    } catch (err: any) {
      toast.error(describeApiError(err, 'Não foi possível criar o usuário.'))
      setAlertInfo({
        isOpen: true,
        title: 'Erro ao criar',
        message: describeApiError(err, 'Não foi possível criar o usuário.'),
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const deleteUser = (id: string) => setConfirmDelete({ isOpen: true, id })

  const performDeleteUser = async (id: string) => {
    const targetUser = users.find((u) => u.id === id)
    try {
      await adminService.deleteUser(id)
      setUsers((prev) => prev.filter((u) => u.id !== id))
      if (selected?.id === id) {
        setSelected(null)
        setIsEditing(false)
      }
      toast.success(
        targetUser?.name
          ? `Usuário "${targetUser.name}" excluído com sucesso!`
          : 'Usuário excluído com sucesso!'
      )
      setAlertInfo({
        isOpen: true,
        title: 'Usuário excluído com sucesso',
        message: targetUser?.name
          ? `O usuário "${targetUser.name}" foi excluído. Suas sessões ativas foram revogadas e o log de auditoria foi registrado.`
          : 'O usuário foi excluído. Suas sessões ativas foram revogadas e o log de auditoria foi registrado.',
        variant: 'primary',
      })
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Erro ao excluir usuário')
      setAlertInfo({ isOpen: true, title: 'Erro ao excluir', message: err.message, variant: 'danger' })
    }
  }

  const savePassword = async () => {
    if (!passwordForm.newPassword) {
      toast.warning('Digite a nova senha.')
      setAlertInfo({
        isOpen: true,
        title: 'Campo obrigatório',
        message: 'Digite a nova senha.',
        variant: 'danger',
      })
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      toast.warning('A confirmação de senha não coincide.')
      setAlertInfo({
        isOpen: true,
        title: 'Senhas diferentes',
        message: 'A confirmação de senha não coincide.',
        variant: 'danger',
      })
      return
    }
    if (passwordForm.newPassword.length < 8) {
      toast.warning('A senha deve ter pelo menos 8 caracteres.')
      setAlertInfo({
        isOpen: true,
        title: 'Senha muito curta',
        message: 'A senha deve ter pelo menos 8 caracteres.',
        variant: 'danger',
      })
      return
    }
    setSaving(true)
    try {
      await adminService.updateUser(selected.id, { password: passwordForm.newPassword })
      setShowPasswordModal(false)
      setSaveSuccess(true)
      toast.success('Senha alterada com sucesso!')
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err: any) {
      toast.error(describeApiError(err, 'Não foi possível alterar a senha.'))
      setAlertInfo({
        isOpen: true,
        title: 'Erro ao alterar senha',
        message: describeApiError(err, 'Não foi possível alterar a senha.'),
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const openNew = () => {
    setNewForm({
      name: '',
      email: '',
      password: '',
      authProvider: 'local',
      role: 'user',
      orgId: '',
      position: '',
      department: '',
      phone: '',
      queues: [],
      org_scope_ids: [],
      permissions: [],
      active: true,
      manager_id: '',
    })
    setShowNewModal(true)
  }

  if (loading) {
    return (
      <Loading label="Carregando usuários…" />
    )
  }

  if (error) {
    return <EmptyState title="Erro ao carregar dados" desc={error} action={<Btn variant="secondary" onClick={() => window.location.reload()}>Tentar novamente</Btn>} />
  }

  const openPasswordModal = () => {
    setPasswordForm({ newPassword: '', confirm: '' })
    setShowPasswordModal(true)
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, width: '100%' }}>
      <UserList
        users={users}
        orgs={orgs}
        selectedUser={selected}
        onSelectUser={handleSelectUser}
        onOpenNew={openNew}
        currentUserRole={currentUserRole || ''}
      />

      {selected && (isEditing ? (
        <div className="cad-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DetailHead back={selected.name} onBack={cancelEdit} title="Editar usuário" meta={[selected.email]} />
          <div style={{ flex: 1, minHeight: 0, padding: '0 var(--page-gutter)' }}>
            <UserForm
              mode="edit"
              currentUserRole={currentUserRole || ''}
              currentUserId={currentUserId}
              users={users}
              orgs={orgs}
              queues={queues}
              formData={form}
              setFormData={setForm}
              onSubmit={saveUser}
              onCancel={cancelEdit}
              saving={saving}
              saveSuccess={saveSuccess}
              selectedUser={selected}
              onOpenPasswordModal={openPasswordModal}
            />
          </div>
        </div>
      ) : (
        <UserDetailView
          user={selected}
          currentUserRole={currentUserRole || ''}
          currentUserId={currentUserId}
          users={users}
          orgs={orgs}
          queues={queues}
          onEdit={() => setIsEditing(true)}
          onDelete={(id) => deleteUser(id)}
          onClose={() => {
            setSelected(null)
            setIsEditing(false)
          }}
          onOpenPasswordModal={openPasswordModal}
          logs={logs}
          logsLoading={logsLoading}
          activeTab={userTab}
          setActiveTab={setUserTab}
          saveSuccess={saveSuccess}
        />
      ))}

      {/* Modal: Novo usuário */}
      {showNewModal && (
        <Modal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          title="Novo usuário"
          width={760}
        >
          <div style={{ height: '100%' }}>
            <UserForm
              mode="create"
              currentUserRole={currentUserRole || ''}
              currentUserId={currentUserId}
              users={users}
              orgs={orgs}
              queues={queues}
              formData={newForm}
              setFormData={setNewForm}
              onSubmit={createUser}
              onCancel={() => setShowNewModal(false)}
              saving={saving}
            />
          </div>
        </Modal>
      )}

      {/* Modal: Alterar Senha local */}
      {showPasswordModal && (
        <Modal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          title={`Alterar senha de ${selected?.name}`}
          width={440}
          footer={<>
            <Btn variant="ghost" onClick={() => setShowPasswordModal(false)}>Cancelar</Btn>
            <Btn onClick={savePassword} disabled={saving}>{saving ? 'Salvando...' : 'Alterar senha'}</Btn>
          </>}
        >
          <Field label="Nova senha" required style={{ marginBottom: 18 }}>
            <PwdInp
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              placeholder="Mínimo 8 caracteres"
              maxLength={100}
            />
          </Field>
          <Field label="Confirmar nova senha" required>
            <PwdInp
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              placeholder="Repita a senha"
              maxLength={100}
            />
          </Field>
        </Modal>
      )}

      {/* Confirmação de Exclusão */}
      {confirmDelete && (
        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => performDeleteUser(confirmDelete.id)}
          title="Excluir usuário"
          message={`Deseja realmente excluir ${
            users.find((u) => u.id === confirmDelete.id)?.name
              ? `o usuário "${users.find((u) => u.id === confirmDelete.id)?.name}"`
              : 'este usuário'
          }? Esta ação não pode ser desfeita, as sessões ativas serão encerradas e um registro de auditoria será gerado.`}
          confirmText="Excluir"
          variant="danger"
        />
      )}

      {/* Alerta Informativo / Erro */}
      {alertInfo && (
        <AlertModal
          isOpen={alertInfo.isOpen}
          onClose={() => setAlertInfo(null)}
          title={alertInfo.title}
          message={alertInfo.message}
          variant={alertInfo.variant}
        />
      )}
    </div>
  )
}
