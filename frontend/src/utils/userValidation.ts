/**
 * Regras de criação de usuário espelhadas do `createUserSchema`
 * (backend/src/services/users.ts). Cada tela que cria usuário mantinha sua
 * própria cópia dessas checagens, e as cópias divergiram do backend — era o que
 * deixava passar nome em branco e senha curta até o 400 "Dados inválidos" em
 * POST /users. Ponto único para as duas telas (UsersPanel e OrgsPanel).
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PASSWORD_MIN_LENGTH = 8

// Telefone é opcional, mas se preenchido tem que ter DDD + número completo:
// fixo (10 dígitos) ou celular (11 dígitos). Pega o caso "digitei só um pedaço
// e esqueci" antes de ir pro backend, que aceita qualquer string em `phone`.
export function isValidPhoneDigits(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 0 || digits.length === 10 || digits.length === 11
}

export type NewUserInput = {
  name?: unknown
  email?: unknown
  password?: unknown
  authProvider?: unknown
  role?: unknown
  orgId?: unknown
  phone?: unknown
}

// Rótulos em pt-BR para os campos do createUserSchema (backend/src/services/users.ts),
// usados para traduzir `details.fieldErrors` de um 400 de validação do Zod em uma
// mensagem que aponta o campo exato, em vez do "Dados inválidos" genérico.
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  password: 'Senha',
  role: 'Perfil',
  orgId: 'Empresa',
  org_id: 'Empresa',
  phone: 'Telefone',
  position: 'Cargo',
  department: 'Departamento',
  location: 'Localização',
  manager_id: 'Gestor',
  org_scope_ids: 'Empresas atendidas',
  queues: 'Filas',
}

const RAW_MESSAGE_TRANSLATIONS: Record<string, string> = {
  'Required': 'é obrigatório',
  'Invalid email': 'formato de e-mail inválido',
}

/**
 * Extrai uma mensagem de erro amigável de uma resposta de API, apontando o(s)
 * campo(s) específico(s) quando o backend devolve `details.fieldErrors` (erro
 * de validação Zod) em vez de só o texto genérico `error`.
 */
export function describeApiError(err: any, fallback = 'Não foi possível concluir a operação.'): string {
  const data = err?.response?.data
  const details = data?.details as Record<string, string[]> | undefined

  if (details && typeof details === 'object') {
    const parts = Object.entries(details)
      .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
      .map(([field, msgs]) => {
        const label = FIELD_LABELS[field] || field
        const raw = msgs[0]
        return `${label}: ${RAW_MESSAGE_TRANSLATIONS[raw] || raw}`
      })
    if (parts.length > 0) return parts.join(' • ')
  }

  return data?.error || err?.message || fallback
}

export type NewUserValidation =
  | { ok: false; title: string; message: string }
  /** `values` traz nome e e-mail já normalizados para irem no payload. */
  | { ok: true; values: { name: string; email: string } }

export function validateNewUser(input: NewUserInput): NewUserValidation {
  const name = String(input.name ?? '').trim()
  const email = String(input.email ?? '').trim()
  const password = String(input.password ?? '')

  if (!name) {
    return { ok: false, title: 'Campo obrigatório', message: 'Nome completo é obrigatório.' }
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, title: 'E-mail inválido', message: 'Informe um e-mail válido para o usuário.' }
  }
  // Usuário SSO (Microsoft) não define senha local — espelha o .refine() do createUserSchema.
  const isSso = input.authProvider === 'microsoft'
  if (!isSso && !password) {
    return { ok: false, title: 'Campo obrigatório', message: 'Senha é obrigatória para novo usuário.' }
  }
  if (password && password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      title: 'Senha muito curta',
      message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    }
  }
  // O backend recusa qualquer perfil sem empresa, exceto admin.
  if (input.role !== 'admin' && !input.orgId) {
    return { ok: false, title: 'Campo obrigatório', message: 'Empresa é obrigatória para este perfil.' }
  }
  const phone = input.phone != null ? String(input.phone) : ''
  if (!isValidPhoneDigits(phone)) {
    return {
      ok: false,
      title: 'Telefone incompleto',
      message: 'O telefone informado está incompleto. Preencha com DDD + número completo (ex: (11) 91234-5678) ou deixe o campo em branco.',
    }
  }

  return { ok: true, values: { name, email } }
}

export function validateUpdateUserAuth(
  currentProvider: string | undefined,
  targetProvider: string | undefined,
  newPassword?: string
): { ok: true } | { ok: false; title: string; message: string } {
  const current = currentProvider || 'local'
  const target = targetProvider || current

  if (target === 'local' && current === 'microsoft') {
    const pwd = String(newPassword ?? '').trim()
    if (!pwd) {
      return {
        ok: false,
        title: 'Senha obrigatória',
        message: 'Para alterar a autenticação para Senha local, defina uma nova senha inicial para o usuário.',
      }
    }
    if (pwd.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        title: 'Senha muito curta',
        message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      }
    }
  }

  return { ok: true }
}
