import { useState, useMemo } from 'react'
import { Btn, Inp, PwdInp, Sel, Toggle, SearchableSelect } from '@/components/ui'
import { CarteiraField } from '@/components/CarteiraField'
import { useUserScope } from '@/hooks/useUserScope'
import {
  SYSTEM_AREAS,
  DEFAULT_ROLE_PERMISSIONS,
  DELETE_TICKETS_PERMISSION,
  hasAreaPermission,
} from '@/utils/permissions'
import { useAuthStore } from '@/store/auth'
import { Row } from '../Blocks'

interface UserFormProps {
  mode: 'create' | 'edit'
  currentUserRole: string
  currentUserId: string
  users: any[]
  orgs: any[]
  queues: any[]
  formData: Record<string, any>
  setFormData: (data: any | ((prev: any) => any)) => void
  onSubmit: () => void | Promise<void>
  onCancel: () => void
  saving: boolean
  saveSuccess?: boolean
  selectedUser?: any
  onOpenPasswordModal?: () => void
}

export function UserForm({
  mode,
  currentUserRole,
  currentUserId,
  users,
  orgs,
  queues,
  formData,
  setFormData,
  onSubmit,
  onCancel,
  saving,
  saveSuccess = false,
  selectedUser,
  onOpenPasswordModal,
}: UserFormProps) {
  const isCreate = mode === 'create'
  const isEdit = mode === 'edit'
  const currentUser = useAuthStore((s) => s.user)
  // Módulos herdados: sobe manager_id até o primeiro gerente (mesma regra de
  // backend/src/services/moduleAccess.ts), botão a botão. Gerente fora da lista
  // (ex.: o próprio gerente editando a equipe) usa o módulo efetivo dele, do login.
  const inheritedModules = useMemo(() => {
    const fallback = { tickets: { on: true, from: '' }, projects: { on: false, from: '' }, documents: { on: false, from: '' } }
    let id: string | null = formData.manager_id || null
    for (let depth = 0; id && depth < 5; depth++) {
      if (id === currentUserId && currentUserRole === 'manager') {
        const from = currentUser?.name ?? ''
        return { tickets: { on: currentUser?.modules?.tickets !== false, from }, projects: { on: !!currentUser?.modules?.projects, from }, documents: { on: !!currentUser?.modules?.documents, from } }
      }
      const boss = users.find((u: any) => u.id === id)
      if (!boss) break
      if (boss.role === 'manager') {
        return { tickets: { on: boss.module_tickets !== false, from: boss.name as string }, projects: { on: boss.module_projects === true, from: boss.name as string }, documents: { on: boss.module_documents === true, from: boss.name as string } }
      }
      id = boss.manager_id || boss.managerId || null
    }
    return fallback
  }, [formData.manager_id, users, currentUserId, currentUserRole, currentUser])
  const MODULES = [
    { key: 'tickets', field: 'module_tickets', label: 'Chamados', standard: true },
    { key: 'projects', field: 'module_projects', label: 'Projetos', standard: false },
    { key: 'documents', field: 'module_documents', label: 'Documentos', standard: false },
  ] as const
  // Valor efetivo de cada botão na ficha: o gravado, senão o herdado (gerente: o padrão).
  const moduleOn = (m: (typeof MODULES)[number]) => {
    const own = formData[m.field] as boolean | null | undefined
    if (formData.role === 'manager') return own ?? m.standard
    return own ?? inheritedModules[m.key].on
  }
  // Autoedição: o servidor só aceita dados pessoais (senha pela tela de perfil;
  // cargo, filas, carteira e permissões só quem está acima define).
  const isSelfEdit = isEdit && formData.id === currentUserId && currentUserRole !== 'admin'
  // Quem edita o usuário escolhe local ou Microsoft (SSO); conta de admin só o admin mexe.
  const canEditAuthMethod = currentUserRole === 'admin' || isCreate || formData.role !== 'admin'

  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    manager: 'Gerente',
    supervisor: 'Ticket Manager',
    agent: 'Analista',
    user: 'Usuário final',
  }

  const creatableByRole: Record<string, string[]> = {
    admin: ['admin', 'manager', 'supervisor', 'agent', 'user'],
    manager: ['supervisor', 'agent', 'user'],
    supervisor: ['agent', 'user'],
    agent: ['user'],
  }

  const allRoleOptions = [
    { value: 'admin', label: 'Administrador' },
    { value: 'manager', label: 'Gerente' },
    { value: 'supervisor', label: 'Ticket Manager' },
    { value: 'agent', label: 'Analista' },
    { value: 'user', label: 'Usuário final' },
  ]

  // A permissão "Usuários" abre a tela; os perfis possíveis seguem o cargo de quem edita.
  // O perfil atual do alvo continua na lista para o seletor não ficar vazio.
  const availableRoleOptions = allRoleOptions.filter((option) => {
    if (currentUserRole === 'admin') return true
    if (option.value === 'admin') return false
    return (creatableByRole[currentUserRole || ''] ?? []).includes(option.value) || (isEdit && option.value === formData.role)
  })

  // Abas de seções no formulário
  const targetRole = formData.role || 'user'
  const showHierarchy = !isSelfEdit && ['admin', 'manager', 'supervisor'].includes(currentUserRole) && (targetRole === 'agent' || targetRole === 'supervisor')
  const showQueuesAndScope = !isSelfEdit && (targetRole === 'agent' || targetRole === 'supervisor' || targetRole === 'manager')
  const showPermissions = !isSelfEdit && targetRole !== 'user'
  // Quem não é admin só libera ou retira acessos que ele mesmo tem.
  const canGrantArea = (areaId: string) => currentUserRole === 'admin' || hasAreaPermission(currentUser, areaId)

  const availableSections = useMemo(() => {
    const list = [
      { id: 'personal', label: 'Dados pessoais' },
    ]
    if (!isSelfEdit) {
      list.push({ id: 'access', label: 'Acesso e login' })
    }
    if (showHierarchy) {
      list.push({ id: 'hierarchy', label: 'Organograma' })
    }
    if (showQueuesAndScope) {
      list.push({ id: 'scope', label: 'Filas e carteira' })
    }
    if (showPermissions) {
      list.push({ id: 'permissions', label: 'Permissões' })
    }
    return list
  }, [isSelfEdit, showHierarchy, showQueuesAndScope, showPermissions])

  const [activeTab, setActiveTab] = useState<string>('personal')
  // Aviso de campo obrigatório só depois de tentar salvar (formulário novo não abre "com erro").
  const [triedSubmit, setTriedSubmit] = useState(false)

  // Se a aba atual não estiver disponível para o perfil alterado, volta para a primeira
  if (!availableSections.some((s) => s.id === activeTab)) {
    setActiveTab('personal')
  }

  // Escopo do gestor para o CarteiraField
  const chiefId = formData.manager_id || (isCreate && (currentUserRole === 'manager' || currentUserRole === 'supervisor') ? currentUserId : null)
  const chiefScope = useUserScope(chiefId)

  const chiefName = useMemo(() => {
    if (!chiefId) return undefined
    if (chiefId === currentUserId) return 'você'
    const found = users.find((u) => u.id === chiefId)
    return found?.name
  }, [chiefId, currentUserId, users])

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

  const toggleQueue = (qId: string) => {
    const qs: string[] = formData.queues || []
    setFormData({
      ...formData,
      queues: qs.includes(qId) ? qs.filter((x: string) => x !== qId) : [...qs, qId],
    })
  }

  const togglePermission = (areaId: string) => {
    let currentPerms: string[]
    if (Array.isArray(formData.permissions) && formData.permissions.length > 0) {
      currentPerms = [...formData.permissions]
    } else {
      currentPerms = [...(DEFAULT_ROLE_PERMISSIONS[formData.role] || [])]
    }

    if (currentPerms.includes(areaId)) {
      currentPerms = currentPerms.filter((p) => p !== areaId)
    } else {
      currentPerms.push(areaId)
    }

    setFormData({ ...formData, permissions: currentPerms })
  }

  const isAreaActive = (areaId: string) => {
    if (Array.isArray(formData.permissions) && formData.permissions.length > 0) {
      return formData.permissions.includes(areaId)
    }
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[formData.role] || []
    return defaultPerms.includes(areaId)
  }

  const areaRows = (areas: typeof SYSTEM_AREAS) => areas.map((area) => (
    <Row key={area.id} flat label={area.name} hint={area.description}>
      <Toggle
        value={isAreaActive(area.id)}
        onChange={() => togglePermission(area.id)}
        disabled={!canGrantArea(area.id)}
        label={canGrantArea(area.id) ? area.name : `${area.name}: só quem tem este acesso pode liberar`}
      />
    </Row>
  ))

  return (
    <div className="cad-form">
      {/* Quebram linha quando não cabem (antes a última aba ficava cortada, com a rolagem horizontal escondida). */}
      <div role="tablist" aria-label="Seções do cadastro" className="subtabs" style={{ flexWrap: 'wrap', flexShrink: 0 }}>
        {availableSections.map((sec) => (
          <button key={sec.id} type="button" role="tab" aria-selected={activeTab === sec.id} onClick={() => setActiveTab(sec.id)}>
            {sec.label}
          </button>
        ))}
      </div>

      <div className="cad-form-body">
        {activeTab === 'personal' && (
          <>
            {isSelfEdit && (
              <p className="notice" style={{ marginBottom: 14 }}>
                Este é o seu cadastro: aqui você altera só os dados pessoais. A senha muda em <strong>Meu perfil</strong>.
                Perfil, empresa, filas, carteira e permissões são definidos por quem está acima de você.
              </p>
            )}

            <Row label="Nome completo" required>
              <Inp
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                maxLength={50}
                showCount
                placeholder="Nome e sobrenome"
              />
            </Row>
            <Row label="E-mail" required={isCreate} hint={isEdit ? 'Identificador único (imutável)' : undefined}>
              <Inp
                value={formData.email || ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isEdit}
                style={isEdit ? { opacity: 0.65, cursor: 'not-allowed' } : undefined}
                maxLength={100}
                showCount={isCreate}
                placeholder="usuario@empresa.com.br"
              />
            </Row>
            <Row label="Perfil de acesso" required hint="Papel funcional e permissões base no sistema">
              <Sel
                value={formData.role || 'user'}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                disabled={isSelfEdit}
              >
                {availableRoleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {roleLabel[opt.value] || opt.label}
                  </option>
                ))}
              </Sel>
            </Row>
            {formData.role !== 'admin' && (
              <Row label="Empresa" required hint={formData.role === 'user' ? 'Empresa cliente que abre os chamados' : 'Vínculo cadastral da equipe técnica'}>
                <SearchableSelect
                  value={formData.orgId || formData.org_id || ''}
                  onChange={(v) => setFormData({ ...formData, orgId: v || null, org_id: v || null })}
                  disabled={isSelfEdit}
                  placeholder="Selecione a empresa..."
                  searchPlaceholder="Buscar empresa..."
                  options={[
                    { value: '', label: 'Selecione a empresa...' },
                    ...orgs.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />
                {triedSubmit && !formData.orgId && !formData.org_id && (
                  <span className="cad-err">Empresa é obrigatória para este perfil.</span>
                )}
              </Row>
            )}
            <Row label="Cargo" hint="Função profissional do usuário">
              <Inp
                value={formData.position || ''}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                maxLength={80}
                showCount
                placeholder="Ex: Analista de Suporte Jr."
              />
            </Row>
            <Row label="Departamento" hint="Setor ou área interna">
              <Inp
                value={formData.department || ''}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                maxLength={80}
                showCount
                placeholder="Ex: TI / Infraestrutura"
              />
            </Row>
            <Row label="Telefone" hint="Com DDD">
              <Inp
                value={formData.phone || ''}
                onChange={(e) => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                maxLength={20}
                placeholder="(00) 00000-0000"
              />
            </Row>
          </>
        )}

        {activeTab === 'access' && (
          <>
            <Row label="Método de autenticação" hint="Microsoft Entra ID ou e-mail e senha" flat={!canEditAuthMethod}>
              {canEditAuthMethod ? (
                <Sel
                  value={formData.authProvider || 'local'}
                  onChange={(e) => {
                    const val = e.target.value
                    setFormData({ ...formData, authProvider: val, newPasswordForLocal: '' })
                  }}
                >
                  <option value="local">Senha local (e-mail e senha)</option>
                  <option value="microsoft">Microsoft (SSO Corporativo)</option>
                </Sel>
              ) : (
                <>
                  {(formData.authProvider || 'local') === 'microsoft' ? 'Microsoft SSO' : 'Senha local'}
                  <span className="cad-sub">Apenas administradores podem alterar o método.</span>
                </>
              )}
              {/* Pré-cadastro SSO: sem senha, vincula no 1º login Microsoft */}
              {isCreate && (formData.authProvider || 'local') === 'microsoft' && (
                <span className="cad-sub" style={{ marginTop: 8 }}>
                  Sem senha: a pessoa entra com a conta Microsoft usando este mesmo e-mail e o acesso é vinculado no primeiro login.
                </span>
              )}
              {isEdit &&
                formData.authProvider === 'microsoft' &&
                (selectedUser?.authProvider || selectedUser?.auth_provider) === 'local' && (
                  <span className="cad-sub" style={{ marginTop: 8 }}>
                    Ao mudar para <strong>Microsoft SSO</strong>, a validação de acesso passa a ser realizada diretamente pelo Single Sign-On corporativo Microsoft 365.
                  </span>
                )}
            </Row>

            {isCreate && (formData.authProvider || 'local') === 'local' && (
              <Row label="Senha inicial" required hint="Mínimo 8 caracteres (o usuário poderá alterar no primeiro acesso)">
                <PwdInp
                  value={formData.password || ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Digite ao menos 8 caracteres"
                  maxLength={100}
                />
              </Row>
            )}

            {isEdit &&
              formData.authProvider === 'local' &&
              (selectedUser?.authProvider || selectedUser?.auth_provider) === 'microsoft' && (
                <Row
                  label="Senha inicial"
                  required
                  hint="Como esta conta utilizava Microsoft SSO, é obrigatório definir uma senha local inicial com no mínimo 8 caracteres para permitir o acesso."
                >
                  <PwdInp
                    value={formData.newPasswordForLocal || ''}
                    onChange={(e) => setFormData({ ...formData, newPasswordForLocal: e.target.value })}
                    placeholder="Nova senha inicial (mínimo 8 caracteres)"
                    maxLength={100}
                  />
                </Row>
              )}

            {isEdit &&
              (currentUserRole === 'admin' || formData.role !== 'admin') &&
              (formData.authProvider || 'local') === 'local' &&
              (selectedUser?.authProvider || selectedUser?.auth_provider) === 'local' &&
              onOpenPasswordModal && (
                <Row label="Senha">
                  <Btn type="button" variant="secondary" size="sm" onClick={onOpenPasswordModal}>Redefinir senha do usuário</Btn>
                </Row>
              )}

            <Row flat label="Conta ativa" hint="Desativar impede que o usuário faça login ou realize qualquer ação no sistema.">
              <Toggle
                value={formData.active !== false}
                onChange={(v) => setFormData({ ...formData, active: v })}
              />
            </Row>
          </>
        )}

        {activeTab === 'hierarchy' && showHierarchy && (
          <Row label="Responsável no organograma" hint="Gerente ou Ticket Manager a quem este profissional se reporta e de quem herda a carteira de empresas clientes.">
            <SearchableSelect
              value={formData.manager_id || ''}
              onChange={(v) => setFormData({ ...formData, manager_id: v || null })}
              placeholder="Sem responsável definido"
              searchPlaceholder="Buscar gestor ou supervisor..."
              options={[
                { value: '', label: 'Sem responsável (direto)' },
                ...users
                  .filter((u) =>
                    targetRole === 'supervisor'
                      ? u.role === 'manager'
                      : u.role === 'supervisor' || u.role === 'manager'
                  )
                  .map((s) => ({
                    value: s.id,
                    label: `${s.name} (${roleLabel[s.role] || s.role})`,
                  })),
              ]}
            />
            {chiefScope && (
              <span className="cad-sub" style={{ marginTop: 8 }}>
                Escopo de {chiefName || 'quem foi selecionado'}:{' '}
                {chiefScope.effective.scopeAll
                  ? 'Possui acesso a todas as empresas cadastradas no sistema.'
                  : `Possui carteira restrita a ${chiefScope.effective.orgIds.length} empresa(s).`}
              </span>
            )}
          </Row>
        )}

        {activeTab === 'scope' && showQueuesAndScope && (
          <>
            {targetRole === 'agent' && (
              <Row flat label="Filas de atendimento" hint="O analista só visualiza chamados alocados nas filas marcadas.">
                {queues.length === 0 ? (
                  <span style={{ color: 'var(--text-3)' }}>Nenhuma fila cadastrada.</span>
                ) : (
                  <div className="cad-checks">
                    {queues.map((q) => (
                      <label key={q.id}>
                        <input type="checkbox" checked={(formData.queues || []).includes(q.id)} onChange={() => toggleQueue(q.id)} />
                        <span>{q.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                {(!formData.queues || formData.queues.length === 0) && (
                  <span className="cad-err">Sem filas marcadas: este analista não verá nenhum chamado.</span>
                )}
              </Row>
            )}

            <Row flat label="Carteira de empresas" hint="Determina de quais empresas este usuário vê os chamados.">
              <CarteiraField
                key={`carteira-${formData.role}-${formData.manager_id || 'none'}`}
                role={formData.role}
                allOrgs={orgs}
                chiefScope={chiefScope}
                chiefName={chiefName}
                orgIds={formData.org_scope_ids || []}
                all={!!formData.manager_global}
                canSetAll={currentUserRole === 'admin'}
                hasQueues={(formData.queues || []).length > 0}
                onChange={({ orgIds, all }) =>
                  setFormData({ ...formData, org_scope_ids: orgIds, manager_global: all })
                }
              />
            </Row>
          </>
        )}

        {activeTab === 'permissions' && showPermissions && (
          <>
            {currentUserRole !== 'admin' && (
              <p className="notice" style={{ marginBottom: 20 }}>Você só libera ou retira acessos que você mesmo tem; os travados ficam como estão.</p>
            )}

            <h3>Configurações</h3>
            {areaRows(SYSTEM_AREAS.filter((a) => a.category === 'config'))}

            <h3>Operação e gestão</h3>
            {areaRows(SYSTEM_AREAS.filter((a) => a.category === 'management' || a.category === 'operations'))}

            {/* Módulos Chamados e Projetos: ligam por carteira do gerente (users.module_* + herança).
                Admin define para qualquer um; gerente ajusta exceções da equipe, nunca o próprio.
                Não deixa desligar os dois: a pessoa ficaria sem nenhuma área. */}
            {!isCreate && (currentUserRole === 'admin' || (currentUserRole === 'manager' && formData.id !== currentUserId)) && (
              <>
                <h3>Módulos</h3>
                {MODULES.map((m) => {
                  const on = moduleOn(m)
                  const others = MODULES.filter((o) => o.key !== m.key)
                  const lastOn = on && !others.some(moduleOn)
                  const inherited = inheritedModules[m.key]
                  const own = formData[m.field] as boolean | null | undefined
                  return (
                    <Row
                      key={m.key}
                      flat
                      label={m.label}
                      hint={lastOn
                        ? `Única área ligada: para desligar, ligue ${others.map((o) => o.label).join(' ou ')} antes.`
                        : formData.role === 'manager'
                          ? 'Vale para toda a carteira deste gerente (quem está abaixo herda).'
                          : own == null
                            ? `Segue o gerente da carteira${inherited.from ? ` (${inherited.from})` : ''}: ${inherited.on ? 'ligado' : 'desligado'}.`
                            : `Exceção deste usuário: o gerente da carteira está com ${m.label} ${inherited.on ? 'ligado' : 'desligado'}.`}
                    >
                      <Toggle
                        label={`Acesso ao módulo ${m.label}`}
                        value={on}
                        disabled={lastOn}
                        onChange={() => {
                          const next = !on
                          // Gerente: o padrão volta a ser "sem valor gravado"; equipe: igual ao herdado volta a seguir o gerente.
                          const base = formData.role === 'manager' ? m.standard : inherited.on
                          setFormData({ ...formData, [m.field]: next === base ? null : next })
                        }}
                      />
                    </Row>
                  )
                })}
              </>
            )}

            {/* Projetos: liberações próprias do módulo (relatórios, integrações, sprints e pastas).
                Só aparecem com o módulo Projetos ligado para a pessoa (sem ele nada disso vale). */}
            {moduleOn(MODULES[1]) && (
              <>
                <h3>Projetos</h3>
                {areaRows(SYSTEM_AREAS.filter((a) => a.category === 'projects'))}
              </>
            )}

            {currentUserRole === 'admin' && formData.role !== 'admin' && (
              <>
                <h3>Ações especiais de chamados</h3>
                <Row flat label="Excluir chamados do sistema" hint="Permite excluir qualquer chamado pelo menu Ações (gera log de auditoria permanente).">
                  <Toggle
                    value={isAreaActive(DELETE_TICKETS_PERMISSION)}
                    onChange={() => togglePermission(DELETE_TICKETS_PERMISSION)}
                  />
                </Row>
              </>
            )}
          </>
        )}
      </div>

      <div className="cad-save">
        <Btn type="button" onClick={() => { setTriedSubmit(true); return onSubmit() }} disabled={saving}>
          {saving ? 'Salvando...' : isCreate ? 'Criar usuário' : 'Salvar alterações'}
        </Btn>
        <Btn type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Btn>
        {saveSuccess && <span role="status" style={{ fontSize: 14, color: 'var(--text-2)' }}>Alterações salvas com sucesso!</span>}
      </div>
    </div>
  )
}
