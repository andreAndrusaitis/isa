/**
 * Cliente API (Axios)
 * 
 * Este módulo configura a instância global do Axios para realizar chamadas ao backend.
 * Inclui interceptores para gerenciar autenticação, erros e logs detalhados.
 */

import axios from 'axios'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toastStore'
import { isInTeams, renewTeamsSession } from '@/services/teamsSso'

// Cria a instância com configurações base.
// withCredentials: true permite que o cookie httpOnly do refresh token seja
// enviado e recebido nas chamadas de autenticação (cross-site em produção).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // URL do backend definida no .env.local
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Login, refresh e logout passam pelo PRÓPRIO domínio do frontend (proxy /api do
// nginx em prod, do vite em dev). Assim o cookie de refresh é first-party — o SSO
// já o grava aqui (/auth/acs via proxy) e navegadores que bloqueiam cookies de
// terceiros não derrubam a sessão. O resto da API segue direto em VITE_API_URL.
export const AUTH_BASE_URL = '/api'

// Controla o estado do refresh para evitar múltiplas chamadas simultâneas.
let isRefreshing = false
let lastRateLimitToast = 0
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

function processRefreshQueue(newToken: string | null, err?: unknown) {
  refreshQueue.forEach(p => (newToken ? p.resolve(newToken) : p.reject(err)))
  refreshQueue = []
}

async function renewAccessToken(): Promise<string> {
  try {
    // O refresh token segue no cookie httpOnly: enviamos via withCredentials,
    // sem corpo. O backend rotaciona o cookie automaticamente na resposta.
    const { data } = await axios.post(
      `${AUTH_BASE_URL}/auth/refresh`,
      {},
      { headers: { 'Content-Type': 'application/json' }, withCredentials: true }
    )
    const newToken: string = data.data.accessToken
    const updatedUser = data.data.user ?? useAuthStore.getState().user!
    useAuthStore.getState().setAuth(updatedUser, newToken)
    return newToken
  } catch (refreshErr) {
    // No Teams o cookie de refresh é de terceiros e pode não chegar (Safari, Mac,
    // mobile): se o backend recusou a sessão, tenta uma nova troca do token do Teams.
    if ((refreshErr as any)?.response?.status === 401 && isInTeams()) {
      const teamsToken = await renewTeamsSession()
      if (teamsToken) return teamsToken
    }
    throw refreshErr
  }
}

function logoutLocally() {
  useAuthStore.getState().clearAuth()
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

/**
 * Interceptor de Requisição
 * 
 * Executado antes de cada chamada à API.
 * Busca o Access Token atual no estado global (Zustand) e injeta no header 'Authorization'.
 * Também registra a saída da chamada no console em modo desenvolvimento.
 */
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  
  // Se houver um token, adiciona o prefixo Bearer exigido pelo padrão JWT.
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // Logs de Depuração (Apenas em Dev)
  if (import.meta.env.DEV) {
    console.log(`%c→ API REQ [${config.method?.toUpperCase()}] ${config.url}`, 'color: #00bcd4; font-weight: bold;', {
      data: config.data,
      params: config.params,
      headers: config.headers
    })
  }
  
  return config
})

/**
 * Interceptor de Resposta
 * 
 * Executado após receber uma resposta da API.
 * Gerencia erros globais, como a expiração de sessão (HTTP 401), e loga o resultado.
 */
api.interceptors.response.use(
  (response) => {
    // Logs de Depuração (Apenas em Dev)
    if (import.meta.env.DEV) {
      console.log(`%c← API RES [${response.status}] ${response.config.url}`, 'color: #4caf50; font-weight: bold;', response.data)
    }
    return response
  },
  async (error) => {
    // Logs de Erro (Apenas em Dev)
    if (import.meta.env.DEV) {
      const status = error.response?.status || 'NETWORK_ERROR'
      const url = error.config?.url || 'unknown'
      console.error(`%c✖ API ERR [${status}] ${url}`, 'color: #f44336; font-weight: bold;', {
        message: error.message,
        data: error.response?.data
      })
    }

    // 429: avisa o motivo real (uma vez a cada 30s) em vez das telas mostrarem "Erro de conexão".
    if (error.response?.status === 429 && Date.now() - lastRateLimitToast > 30_000) {
      lastRateLimitToast = Date.now()
      toast.error(error.response.data?.error ?? 'Muitas requisições. Aguarde alguns minutos e tente de novo.')
    }

    // Se recebermos um 401, tenta renovar o access token via refresh token.
    if (error.response?.status === 401) {
      const originalRequest = error.config

      // Se for a própria rota de login, não intercepta (deixa o erro ir para a UI)
      if (originalRequest?.url?.includes('/auth/login')) {
        return Promise.reject(error)
      }

      // Evita loop infinito se a própria requisição de refresh falhar.
      if (originalRequest?._retry) {
        logoutLocally()
        return Promise.reject(error)
      }

      // O refresh token vive em um cookie httpOnly — o JS não o enxerga.
      // Usamos a presença do usuário logado como sinal para tentar renovar.
      const isLoggedIn = !!useAuthStore.getState().user
      if (!isLoggedIn) {
        logoutLocally()
        return Promise.reject(error)
      }

      // Se já existe um refresh em andamento, enfileira a requisição original.
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          refreshQueue.push({ resolve, reject })
        }).then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const newToken = await renewAccessToken()
        processRefreshQueue(newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshErr) {
        processRefreshQueue(null, refreshErr)
        // Só desloga se o backend RECUSOU a sessão (401). Queda de rede, timeout ou
        // 5xx não encerram a sessão: a próxima chamada tenta renovar de novo.
        if ((refreshErr as any)?.response?.status === 401) logoutLocally()
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    // Repassa o erro para que o componente que fez a chamada possa tratá-lo se quiser.
    return Promise.reject(error)
  },
)

/** Mensagem explicativa do backend ({ error }) ou o fallback. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as any)?.response?.data?.error
  return typeof msg === 'string' && msg.trim() ? msg : fallback
}

export default api
