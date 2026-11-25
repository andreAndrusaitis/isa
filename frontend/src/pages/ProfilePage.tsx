import { useState } from 'react'
import { AppHeader } from '@/components/AppHeader'
import { useAuthStore } from '@/store/auth'
import { Avatar, PageHeader, Inp, PwdInp, Btn, Toggle, useTheme } from '@/components/ui'
import { Row } from '@/areas/cadastros/Blocks'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'
import { describeApiError } from '@/utils/userValidation'
import { AvatarUploadModal } from '@/components/AvatarUploadModal'
import { useInTeams } from '@/teams/teamsContext'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  supervisor: 'Ticket Manager',
  agent: 'Analista',
  user: 'Usuário',
}

function maskPhone(value: string) {
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

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)!
  const accessToken = useAuthStore(s => s.accessToken)
  const setAuth = useAuthStore(s => s.setAuth)
  const { theme, toggle } = useTheme()
  const inTeams = useInTeams()

  const [form, setForm] = useState<any>({ ...user })
  const [saving, setSaving] = useState(false)
  const [showAvatarModal, setShowAvatarModal] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const isEndUser = user.role === 'user'
  const hasStats = user.role === 'agent' || user.role === 'supervisor'
  const isSsoUser = user.authProvider === 'microsoft' || (user as any).auth_provider === 'microsoft'

  async function handleSaveProfile() {
    const trimmedName = (form.name || '').trim()
    if (!trimmedName) {
      toast.error('O nome é obrigatório.')
      return
    }
    if (trimmedName.length > 50) {
      toast.error('O nome deve ter no máximo 50 caracteres.')
      return
    }

    try {
      setSaving(true)
      const updated = await adminService.updateProfile({ ...form, name: trimmedName })
      if (accessToken) setAuth(updated, accessToken)
      toast.success('Perfil atualizado com sucesso!')
    } catch (err) {
      toast.error(describeApiError(err, 'Erro ao atualizar perfil.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarSave(dataUrl: string) {
    const updated = await adminService.updateProfile({ avatar: dataUrl })
    if (accessToken) setAuth(updated, accessToken)
    setForm((f: any) => ({ ...f, avatar: updated.avatar }))
    toast.success('Foto de perfil atualizada!')
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      toast.error('A confirmação de senha não confere.')
      return
    }
    try {
      setChangingPassword(true)
      await adminService.changeMyPassword({ currentPassword, newPassword })
      toast.success('Senha alterada com sucesso!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(describeApiError(err, 'Erro ao alterar senha.'))
    } finally {
      setChangingPassword(false)
    }
  }

  const avatarSrc = user.avatar?.startsWith('http') || user.avatar?.startsWith('data:') ? user.avatar : undefined
  const sections = [['dados', 'Dados'], ['preferencias', 'Preferências'], ['seguranca', 'Segurança'], ...(hasStats ? [['desempenho', 'Desempenho']] : [])]

  return (
    <div className="app-shell">
      <AppHeader responsive />
      <div className="app-body">
        <div className="app-main">
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <PageHeader title={user.name} subtitle={`${ROLE_LABELS[user.role] || user.role} · ${isSsoUser ? 'entra com a conta Microsoft' : 'conta local'}`} />
            <div className="profile">
              <nav aria-label="Seções do perfil">
                {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
              </nav>
              <div>
                <section>
                  <h2 id="dados">Dados</h2>
                  <Row flat label="Foto">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <Avatar name={user.name} size={44} src={avatarSrc} rounded />
                      <Btn variant="secondary" size="sm" onClick={() => setShowAvatarModal(true)} aria-label="Alterar foto de perfil">Alterar foto</Btn>
                    </div>
                  </Row>
                  <Row label="Nome completo" required>
                    <Inp value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={50} showCount />
                  </Row>
                  <Row flat label="E-mail" hint="Não pode ser alterado por aqui.">{form.email}</Row>
                  {!isEndUser && (
                    <>
                      <Row label="Cargo"><Inp value={form.position || ''} onChange={e => setForm({ ...form, position: e.target.value })} /></Row>
                      <Row label="Departamento"><Inp value={form.department || ''} onChange={e => setForm({ ...form, department: e.target.value })} /></Row>
                      <Row label="Telefone"><Inp value={form.phone || ''} onChange={e => setForm({ ...form, phone: maskPhone(e.target.value) })} placeholder="(00) 00000-0000" /></Row>
                      <Row label="Localização"><Inp value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Ex: São Paulo, SP" /></Row>
                    </>
                  )}
                  <div className="cad-save">
                    <Btn onClick={handleSaveProfile} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</Btn>
                  </div>
                </section>

                <section>
                  <h2 id="preferencias">Preferências</h2>
                  <Row flat label="Tema escuro" hint={inTeams ? 'Segue o tema do Microsoft Teams' : 'Alterna entre visual claro e escuro'}>
                    {inTeams ? (theme === 'dark' ? 'Ligado' : 'Desligado') : <Toggle value={theme === 'dark'} onChange={toggle} label="Tema escuro" />}
                  </Row>
                  <Row flat label="Idioma">Português (Brasil)</Row>
                </section>

                <section>
                  <h2 id="seguranca">Segurança</h2>
                  {isSsoUser ? (
                    <Row flat label="Entrada" hint="Senha, políticas de segurança e autenticação multifator (MFA) são administradas pelo diretório corporativo da sua organização.">
                      Conta Microsoft (Microsoft Entra ID)
                    </Row>
                  ) : (
                    <>
                      <Row label="Senha atual" required><PwdInp value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></Row>
                      <Row label="Nova senha" required hint="Mínimo de 8 caracteres"><PwdInp value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Row>
                      <Row label="Confirmar nova senha" required><PwdInp value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Row>
                      <div className="cad-save">
                        <Btn
                          variant="secondary"
                          onClick={handleChangePassword}
                          disabled={changingPassword || !currentPassword || newPassword.length < 8 || !confirmPassword}
                        >
                          {changingPassword ? 'Alterando...' : 'Alterar senha'}
                        </Btn>
                      </div>
                    </>
                  )}
                </section>

                {hasStats && (
                  <section>
                    <h2 id="desempenho">Desempenho</h2>
                    <Row flat label="Seus números">Resolvidos hoje, SLA em dia, tempo médio e carga atual ficam no painel principal.</Row>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AvatarUploadModal
        isOpen={showAvatarModal}
        onClose={() => setShowAvatarModal(false)}
        onSave={handleAvatarSave}
      />
    </div>
  )
}
