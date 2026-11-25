import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, AuthUser } from '@/store/auth'
import { Avatar } from '@/components/ui'
import { ChevronDown } from 'lucide-react'
import api, { AUTH_BASE_URL } from '@/services/api'
import './pops.css'

const ROLE_LABEL: Record<AuthUser['role'], string> = { admin: 'Administrador', manager: 'Gerente', supervisor: 'Ticket Manager', agent: 'Analista', user: 'Usuário' }

export function UserMenu({ user }: { user: AuthUser }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const navigate = useNavigate()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  async function logout() {
    const wasMicrosoft = user.authProvider === 'microsoft'
    const email = user.email

    // Avisa o backend para revogar o refresh token e limpar o cookie httpOnly.
    try {
      await api.post('/auth/logout', {}, { baseURL: AUTH_BASE_URL })
    } catch {
      // Mesmo se a chamada falhar, limpamos a sessão local.
    }
    clearAuth()

    // Single Logout: usuário SSO ainda tem sessão ativa no Azure AD — sem
    // isso, um novo "Entrar com Microsoft" relogaria sem pedir senha.
    if (wasMicrosoft) {
      window.location.href = `/auth/logout?nameId=${encodeURIComponent(email)}`
      return
    }

    navigate('/login')
  }

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button type="button" className="user-menu-btn" onClick={() => setIsOpen(!isOpen)} aria-haspopup="menu" aria-expanded={isOpen} title={user.name}>
        <Avatar
          name={user.name}
          size={28}
          src={user.avatar?.startsWith('http') || user.avatar?.startsWith('data:') ? user.avatar : undefined}
        />
        <span>{user.name.split(' ')[0]}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div role="menu" className="pop user-menu">
          <div>
            {user.name}
            <small>{ROLE_LABEL[user.role]}</small>
          </div>
          <button type="button" onClick={() => { navigate('/perfil'); setIsOpen(false) }}>Meu perfil</button>
          <button type="button" onClick={logout}>Sair</button>
        </div>
      )}
    </div>
  )
}
