import { describe, it, expect } from 'vitest'
import prisma from '../config/prisma'
import { createUserSchema, createUser } from './users'

describe('createUser — authProvider condicional', () => {
  it('exige password quando authProvider é local (ou omitido)', () => {
    const result = createUserSchema.safeParse({
      name: 'Local User', email: 'local@example.com', role: 'user', orgId: 'x',
    })
    expect(result.success).toBe(false)
  })

  it('não exige password quando authProvider é microsoft', () => {
    const result = createUserSchema.safeParse({
      name: 'SSO User', email: 'sso@example.com', role: 'user', orgId: 'x',
      authProvider: 'microsoft',
    })
    expect(result.success).toBe(true)
  })

  // Regressão: o front sempre inicializa o form com password: '' (nunca
  // undefined) — mesmo quando o campo Senha está escondido por authProvider
  // ser microsoft. z.string().min(6).optional() rejeita '' com a mensagem
  // genérica do Zod ("String must contain at least 6 character(s)") antes
  // do .refine() condicional chegar a rodar. Precisa aceitar '' também.
  it('não exige password quando authProvider é microsoft, mesmo com password vazio explícito', () => {
    const result = createUserSchema.safeParse({
      name: 'SSO User', email: 'sso@example.com', role: 'user', orgId: 'x',
      authProvider: 'microsoft', password: '',
    })
    expect(result.success).toBe(true)
  })

  it('createUser cria usuário microsoft sem hash de senha e sem enviar e-mail de boas-vindas', async () => {
    const org = await prisma.organization.create({
      data: { name: `Test Org authProvider ${Date.now()}`, domains: [] },
    })
    let userId: string | undefined
    try {
      const user = await createUser({
        name: 'SSO User 2', email: `sso2-${Date.now()}@example.com`, role: 'user',
        orgId: org.id, authProvider: 'microsoft',
      } as any)
      userId = user.id

      expect(user.password).toBeNull()
      expect(user.auth_provider).toBe('microsoft')
      expect(user.welcome_email_status).toBeNull()
      expect(user.must_change_password).toBe(false)
    } finally {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.organization.delete({ where: { id: org.id } })
    }
  })

  it('createUser marca must_change_password=true para conta local recém-criada', async () => {
    const org = await prisma.organization.create({
      data: { name: `Test Org mustChange ${Date.now()}`, domains: [] },
    })
    let userId: string | undefined
    try {
      const user = await createUser({
        name: 'Local User 2', email: `local2-${Date.now()}@example.com`, role: 'user',
        orgId: org.id, authProvider: 'local', password: 'senha123',
      } as any)
      userId = user.id

      expect(user.must_change_password).toBe(true)
    } finally {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.organization.delete({ where: { id: org.id } })
    }
  })
})
