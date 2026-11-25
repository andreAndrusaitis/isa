/**
 * Hook de Autenticação (Login)
 * 
 * Este hook encapsula toda a lógica necessária para realizar o login,
 * gerenciar estados de carregamento (loading), erros de API e redirecionamento.
 */

import { useState } from 'react'
import api, { AUTH_BASE_URL } from '@/services/api'
import { useAuthStore, AuthUser, REMEMBER_KEY } from '@/store/auth'

/**
 * Hook useLogin
 * 
 * Fornece a função de login e os estados reativos para a UI do formulário.
 */
export function useLogin() {
  const [loading, setLoading] = useState(false) // Estado para desabilitar o botão de enviar
  const [error, setError] = useState<string | null>(null) // Mensagem de erro amigável para o usuário
  const setAuth = useAuthStore((s) => s.setAuth) // Função da store para salvar os dados

  /**
   * Executa a chamada de login para a API.
   * 
   * @param email - E-mail digitado pelo usuário
   * @param password - Senha digitada pelo usuário
   */
  async function login(email: string, password: string, rememberMe = false) {
    setLoading(true)
    setError(null)

    try {
      // 1. Define o flag de "lembrar" ANTES de salvar auth (smartStorage lê na hora).
      if (rememberMe) localStorage.setItem(REMEMBER_KEY, 'true')
      else localStorage.removeItem(REMEMBER_KEY)

      // 2. Faz a chamada POST para o backend.
      const { data } = await api.post('/auth/login', { email, password, rememberMe }, { baseURL: AUTH_BASE_URL })
      
      // 2. Extrai os dados retornados (formato padrão do backend).
      // O refresh token NÃO vem mais no corpo: o backend o entrega num cookie
      // httpOnly (Set-Cookie), salvo automaticamente pelo navegador.
      const { user, accessToken } = data.data as {
        user: AuthUser
        accessToken: string
      }

      // 3. Atualiza o estado global com o usuário e o token de acesso (em memória).
      setAuth(user, accessToken)

      // 5. A tela de login navega (destino guardado antes do login ou tela inicial
      // da sessão): um lugar só, senão uma navegação atropela a outra.

    } catch (err: unknown) {
      // 6. Captura e formata o erro retornado pela API.
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao conectar com o servidor'
      
      setError(msg)
    } finally {
      // Finaliza o estado de carregamento independente de sucesso ou falha.
      setLoading(false)
    }
  }

  return { login, loading, error, clearError: () => setError(null) }
}
