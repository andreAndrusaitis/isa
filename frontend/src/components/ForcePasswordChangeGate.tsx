/**
 * Bloqueio de primeiro acesso — força a troca da senha provisória antes de
 * liberar qualquer rota. Renderizado por RequireAuth quando
 * user.mustChangePassword é true; some assim que a troca é bem-sucedida
 * (o backend zera must_change_password e o novo user é salvo no store).
 */
import { FormEvent, useState } from 'react'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'
import { describeApiError } from '@/utils/userValidation'
import { Btn, Logo } from '@/components/ui'

export function ForcePasswordChangeGate() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('A confirmação de senha não confere.')
      return
    }
    try {
      setSaving(true)
      // Já reentra com a senha nova e grava o usuário atualizado (mustChangePassword=false).
      await adminService.changeMyPassword({ currentPassword, newPassword })
      toast.success('Senha alterada com sucesso!')
    } catch (err) {
      toast.error(describeApiError(err, 'Erro ao alterar senha.'))
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { label: 'Senha provisória (recebida por e-mail)', value: currentPassword, set: setCurrentPassword },
    { label: 'Nova senha', value: newPassword, set: setNewPassword, minLength: 8, placeholder: 'Mínimo 8 caracteres' },
    { label: 'Confirmar nova senha', value: confirmPassword, set: setConfirmPassword, minLength: 8 },
  ]

  return (
    <div className="login-side" style={{ background: 'var(--bg-app)' }}>
      <Logo size={36} />
      <div className="login-form">
        <h1>Defina sua nova senha</h1>
        <p>Por segurança, troque a senha provisória antes de continuar.</p>
        <form onSubmit={handleSubmit}>
          {fields.map(({ label, set, ...f }, i) => (
            <label key={label} className="login-field">
              <span>{label}</span>
              <input type="password" {...f} onChange={(e) => set(e.target.value)} required autoFocus={i === 0} maxLength={100} />
            </label>
          ))}
          <Btn type="submit" disabled={saving} variant="primary" size="lg">
            {saving ? 'Salvando...' : 'Trocar senha e continuar'}
          </Btn>
        </form>
      </div>
    </div>
  )
}
