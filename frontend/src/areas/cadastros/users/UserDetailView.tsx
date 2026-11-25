import { useState, useMemo } from 'react'
import { Btn, Loading } from '@/components/ui'
import { UserAccessSummary } from './UserAccessSummary'
import { useUserScope } from '@/hooks/useUserScope'
import {
  SYSTEM_AREAS,
  getEffectivePermissions,
  DELETE_TICKETS_PERMISSION,
} from '@/utils/permissions'
import { DetailHead, Row, Section } from '../Blocks'

interface UserDetailViewProps {
  user: any
  currentUserRole: string
  currentUserId: string
  users: any[]
  orgs: any[]
  queues: any[]
  onEdit: () => void
  onDelete: (id: string) => void
  onClose: () => void
  onOpenPasswordModal?: () => void
  logs: any[]
  logsLoading: boolean
  activeTab: string
  setActiveTab: (tab: string) => void
  saveSuccess?: boolean
}

export function UserDetailView({
  user,
  currentUserRole,
  currentUserId,
  users,
  orgs,
  queues,
  onEdit,
  onDelete,
  onClose,
  onOpenPasswordModal,
  logs,
  logsLoading,
  activeTab,
  setActiveTab,
  saveSuccess = false,
}: UserDetailViewProps) {
  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    manager: 'Gerente',
    supervisor: 'Ticket Manager',
    agent: 'Analista',
    user: 'Usuário final',
  }

  const deletableByRole: Record<string, string[]> = {
    admin: ['admin', 'manager', 'supervisor', 'agent', 'user'],
    manager: ['supervisor', 'agent', 'user'],
    supervisor: ['agent', 'user'],
    agent: [],
  }

  const canEditThisUser = currentUserRole === 'admin' || user.role !== 'admin'

  const canDeleteThisUser =
    (currentUserRole === 'admin' || user.role !== 'admin') &&
    (deletableByRole[currentUserRole || ''] ?? []).includes(user.role) &&
    user.id !== currentUserId

  // Carrega a carteira de escopo efetiva do usuário via hook existente
  const userScope = useUserScope(user.id)

  // Gestor direto
  const chief = useMemo(() => {
    const mgrId = user.manager_id || user.managerId || user.manager?.id
    if (!mgrId) return null
    return users.find((u) => u.id === mgrId) || null
  }, [user, users])

  // Equipe subordinada (liderados diretos)
  const team = useMemo(() => {
    return users.filter(
      (u) => (u.manager_id === user.id || u.managerId === user.id) && u.id !== user.id
    )
  }, [user.id, users])

  // Filas do usuário
  const userQueues = useMemo(() => {
    const qIds: string[] = user.queues || []
    return queues.filter((q) => qIds.includes(q.id))
  }, [user.queues, queues])

  // Empresas atendidas (carteira efetiva)
  const effectiveScope = userScope?.effective
  const scopeAll = user.role === 'admin' || !!user.manager_global || !!effectiveScope?.scopeAll
  const scopeOrgIds = effectiveScope?.orgIds || []

  // Lista de empresas com busca interna
  const [scopeSearch, setScopeSearch] = useState('')
  const displayedScopeOrgs = useMemo(() => {
    if (scopeAll) {
      if (!scopeSearch.trim()) return orgs
      const q = scopeSearch.toLowerCase()
      return orgs.filter((o) => o.name.toLowerCase().includes(q))
    }
    const matched = orgs.filter((o) => scopeOrgIds.includes(o.id))
    if (!scopeSearch.trim()) return matched
    const q = scopeSearch.toLowerCase()
    return matched.filter((o) => o.name.toLowerCase().includes(q))
  }, [scopeAll, orgs, scopeOrgIds, scopeSearch])

  // Empresa cadastral vinculada
  const assignedOrg = orgs.find((o) => o.id === (user.orgId || user.org_id))

  // Permissões
  const effectivePerms = getEffectivePermissions(user)
  const isSso = (user.authProvider || user.auth_provider) === 'microsoft'

  const staff = user.role === 'agent' || user.role === 'supervisor' || user.role === 'manager'
  const permName = (id: string) =>
    SYSTEM_AREAS.find((a) => a.id === id)?.name || (id === DELETE_TICKETS_PERMISSION ? 'Excluir chamados' : id)

  return (
    <div className="cad-page">
      <DetailHead
        back="Usuários"
        onBack={onClose}
        title={user.name}
        meta={[user.email, roleLabel[user.role] || user.role, isSso ? 'Entra com Microsoft' : 'Entra com senha']}
      >
        {canEditThisUser && <Btn onClick={onEdit}>Editar</Btn>}
        {canEditThisUser && !isSso && onOpenPasswordModal && (
          <Btn variant="secondary" onClick={onOpenPasswordModal} title="Redefinir senha local">Redefinir senha</Btn>
        )}
        {canDeleteThisUser && <Btn variant="danger" onClick={() => onDelete(user.id)}>Excluir</Btn>}
      </DetailHead>

      <div className="cad-body">
        {saveSuccess && <p className="notice" role="status" style={{ marginBottom: 18 }}>Alterações salvas com sucesso!</p>}

        <div className="subtabs" style={{ marginBottom: 28 }}>
          {[
            ['info', 'Visão geral'],
            ['activity', 'Histórico'],
          ].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => setActiveTab(id)}>{label}</button>
          ))}
        </div>

        {activeTab === 'info' && (
          <>
            <UserAccessSummary user={user} userScope={userScope} chief={chief} team={team} queues={queues} orgs={orgs} />

            <Section title="Cadastro">
              <Row label="Empresa">{assignedOrg?.name || (user.role === 'admin' ? 'Administração global' : '—')}</Row>
              <Row label="Cargo">{user.position || '—'}</Row>
              <Row label="Departamento">{user.department || '—'}</Row>
              <Row label="Telefone">{user.phone || '—'}</Row>
            </Section>

            {staff && (
              <Section title="Organograma">
                <Row label="Reporta a">
                  {chief ? <>{chief.name}<span className="cad-sub">{roleLabel[chief.role] || chief.role} · {chief.email}</span></> : 'Sem gestor direto vinculado no organograma.'}
                </Row>
                {(user.role === 'supervisor' || user.role === 'manager') && (
                  <Row label={`Equipe liderada (${team.length})`}>
                    {team.length === 0 ? 'Nenhum colaborador subordinado diretamente a este usuário.' : (
                      <table className="table">
                        <tbody>
                          {team.map((sub) => (
                            <tr key={sub.id}>
                              <td><span className="cad-main">{sub.name}</span><span className="cad-sub">{sub.email}</span></td>
                              <td style={{ color: 'var(--text-2)' }}>{roleLabel[sub.role]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Row>
                )}
              </Section>
            )}

            {user.role === 'agent' && (
              <Section title="Filas de atendimento">
                {userQueues.length === 0 ? (
                  <span style={{ color: 'var(--danger)' }}>Nenhuma fila vinculada. Este analista não receberá nem visualizará chamados no sistema.</span>
                ) : (
                  <ul className="cad-names">{userQueues.map((q) => <li key={q.id}>{q.name}</li>)}</ul>
                )}
              </Section>
            )}

            {staff && (
              <Section
                title={`Empresas atendidas (${scopeAll ? 'todas' : scopeOrgIds.length})`}
                hint={scopeAll ? undefined
                  : userScope?.mode === 'inherit' && chief ? `Herdadas da carteira de ${chief.name}.` : 'Selecionadas para este usuário.'}
              >
                {scopeAll ? 'Todas as empresas clientes, inclusive as cadastradas no futuro.' : (
                  <>
                    {scopeOrgIds.length > 5 && (
                      <input
                        type="search"
                        placeholder="Filtrar empresa..."
                        aria-label="Filtrar empresa"
                        value={scopeSearch}
                        onChange={(e) => setScopeSearch(e.target.value)}
                        style={{ width: '100%', maxWidth: 320, marginBottom: 12, padding: '8px 10px', border: '1px solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', fontSize: 14 }}
                      />
                    )}
                    {displayedScopeOrgs.length === 0 ? (
                      <span style={{ color: 'var(--text-3)' }}>
                        {scopeOrgIds.length === 0
                          ? 'Nenhuma empresa na carteira. O usuário não verá chamados.'
                          : `Nenhuma empresa coincide com "${scopeSearch}".`}
                      </span>
                    ) : (
                      <ul className="cad-names">{displayedScopeOrgs.map((org) => <li key={org.id}>{org.name}</li>)}</ul>
                    )}
                  </>
                )}
              </Section>
            )}

            {user.role !== 'user' && (
              <Section title={`Permissões (${effectivePerms.length})`} hint="Telas e ações liberadas no sistema.">
                <ul className="cad-names">{effectivePerms.map((id) => <li key={id}>{permName(id)}</li>)}</ul>
              </Section>
            )}
          </>
        )}

        {activeTab === 'activity' && (
          logsLoading ? (
            <Loading size="compact" label="Carregando histórico de auditoria…" />
          ) : logs.length === 0 ? (
            <p className="notice">Nenhum log de auditoria encontrado para este usuário.</p>
          ) : (
            <div className="cad-scroll">
              <table className="table">
                <thead><tr><th>Quando</th><th>Ação</th><th className="cad-wide">Origem</th></tr></thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-2)', verticalAlign: 'top' }}>{new Date(log.created_at).toLocaleString('pt-BR')}</td>
                      <td style={{ verticalAlign: 'top' }}>
                        {log.action} <span style={{ color: 'var(--text-3)' }}>{log.resource}</span>
                        {log.details && Object.keys(log.details).length > 0 && (
                          <span className="cad-sub" style={{ fontFamily: 'monospace', fontSize: 12 }}>{JSON.stringify(log.details)}</span>
                        )}
                      </td>
                      <td className="cad-wide" style={{ verticalAlign: 'top', maxWidth: 320, color: 'var(--text-2)' }}>
                        {log.ip || '—'}
                        <span className="cad-sub">{log.user_agent || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
