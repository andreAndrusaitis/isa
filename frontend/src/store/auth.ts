/**
 * Store de Autenticação (Zustand)
 * 
 * Este módulo gerencia o estado global de autenticação da aplicação,
 * incluindo os dados do usuário logado e o token de acesso.
 * Utiliza o middleware 'persist' para manter os dados após o refresh da página.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

/**
 * Interface que define os dados públicos do usuário.
 */
export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'user' | 'agent' | 'supervisor' | 'manager' | 'admin'
  orgId: string | null
  queues: string[]
  permissions?: string[]
  modules?: { tickets: boolean; projects: boolean; documents?: boolean }
  /** Capacidades do catálogo do servidor (backend/src/access/capabilities.ts). */
  capabilities?: string[]
  /** Tela inicial calculada pelo servidor. */
  home?: string
  avatar: string // Iniciais ou URL da imagem
  authProvider?: 'local' | 'microsoft'
  mustChangePassword?: boolean
  expiredQueues?: {
    queueName: string
    expiresAt: string
    message: string | null
  }[]
  queueAccessWarnings?: {
    orgId: string
    orgName: string
    queueId: string
    queueName: string
    expiresAt: string
    daysRemaining: number
    message: string | null
  }[]
}

/**
 * Interface que define o estado e as ações da store.
 */
interface AuthState {
  user: AuthUser | null      // Dados do usuário ou null se deslogado
  accessToken: string | null // Token JWT de acesso
  setAuth: (user: AuthUser, accessToken: string) => void // Realiza o login no estado
  clearAuth: () => void      // Realiza o logout no estado
}

const REMEMBER_KEY = 'isa-remember'
const AUTH_KEY = 'isa-auth'

// Usa localStorage quando "Lembrar de mim" está ativo, sessionStorage caso contrário.
// sessionStorage é limpo automaticamente ao fechar o navegador.
const smartRaw: StateStorage = {
  getItem: (name) => {
    const remembered = localStorage.getItem(REMEMBER_KEY) === 'true'
    return remembered ? localStorage.getItem(name) : sessionStorage.getItem(name)
  },
  setItem: (name, value) => {
    const remembered = localStorage.getItem(REMEMBER_KEY) === 'true'
    if (remembered) localStorage.setItem(name, value)
    else sessionStorage.setItem(name, value)
  },
  removeItem: (name) => {
    localStorage.removeItem(name)
    sessionStorage.removeItem(name)
  },
}
const smartStorage = createJSONStorage(() => smartRaw)

/**
 * Hook customizado useAuthStore.
 * Com "Lembrar de mim": persiste no localStorage por 30 dias.
 * Sem "Lembrar de mim": persiste apenas na sessionStorage (limpa ao fechar o browser).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken) => set({ user, accessToken }),
      clearAuth: () => {
        localStorage.removeItem(REMEMBER_KEY)
        localStorage.removeItem(AUTH_KEY)
        sessionStorage.removeItem(AUTH_KEY)
        set({ user: null, accessToken: null })
      },
    }),
    {
      name: AUTH_KEY,
      storage: smartStorage,
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
    },
  ),
)

export { REMEMBER_KEY }

export const POST_LOGIN_REDIRECT_KEY = 'postLoginRedirect'

// Lê e consome o destino guardado pelo RequireAuth antes de mandar para o login.
export function takePostLoginRedirect(): string | null {
  try {
    const target = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY)
    return target?.startsWith('/') && !target.startsWith('//') ? target : null
  } catch {
    return null
  }
}
