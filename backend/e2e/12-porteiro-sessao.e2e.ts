// Sessão com capacidades e tela inicial, GET /api/auth/me
// e o botão de Chamados por pessoa (herança botão a botão a partir do gerente).
// Organograma do seed: gerente → tm → an1, an2 | gerente → tm2 → an3.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PASS, U, as, http, login } from './helpers'

const id: Record<string, string> = {}
// login() do helper guarda a sessão em cache; aqui cada verificação precisa da sessão de agora.
const fresh = async (who: keyof typeof U) => {
  const r = await http('POST', '/api/auth/login', { body: { email: U[who], password: PASS } })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return { token: r.body.data.accessToken as string, user: r.body.data.user }
}
const admin = () => as('admin')
const setModules = async (userId: string, body: Record<string, boolean | null>) =>
  http('PATCH', `/api/users/${userId}`, { token: await admin(), body })

beforeAll(async () => {
  for (const k of ['gerente', 'tm', 'an1'] as const) id[k] = (await login(U[k])).user.id
})

afterAll(async () => {
  for (const k of ['gerente', 'an1']) await setModules(id[k], { module_tickets: null, module_projects: null })
})

describe('sessão', () => {
  it('login devolve capacidades e tela inicial de cada cargo', async () => {
    // Cada cargo abre na sua pergunta: painel, carteira, turno, fila ou solicitações.
    const expected: Record<string, string> = { admin: '/gestao/dashboard', gerente: '/gestao/carteira', tm: '/gestao/turno', an1: '/chamados', acme1: '/solicitacoes' }
    for (const [who, home] of Object.entries(expected)) {
      const s = await fresh(who as keyof typeof U)
      expect(s.user.home, who).toBe(home)
      expect(Array.isArray(s.user.capabilities), who).toBe(true)
    }
    expect((await fresh('admin')).user.capabilities).toContain('system.admin')
    expect((await fresh('an1')).user.capabilities).not.toContain('dashboard.view')
    expect((await fresh('gerente')).user.capabilities).toContain('dashboard.view')
  })

  it('GET /api/auth/me devolve a mesma sessão, lida do banco', async () => {
    const s = await fresh('tm')
    const me = await http('GET', '/api/auth/me', { token: s.token })
    expect(me.status).toBe(200)
    expect(me.body.data).toEqual(expect.objectContaining({ id: s.user.id, role: 'supervisor', home: s.user.home, capabilities: s.user.capabilities }))
  })

  it('sem token, /me recusa', async () => {
    expect((await http('GET', '/api/auth/me')).status).toBe(401)
  })
})

describe('botão de Chamados', () => {
  it('admin deixa o gerente só com Projetos: ele e o time caem em Minha semana', async () => {
    const r = await setModules(id.gerente, { module_tickets: false, module_projects: true })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const g = await fresh('gerente')
    expect(g.user.modules).toEqual({ tickets: false, projects: true, documents: false })
    expect(g.user.home).toBe('/projetos/semana')
    const a = await fresh('an1') // an1 → tm → gerente: herda os dois botões
    expect(a.user.modules).toEqual({ tickets: false, projects: true, documents: false })
    expect(a.user.home).toBe('/projetos/semana')
  })

  it('a troca fica na auditoria', async () => {
    const logs = await http('GET', `/api/audit?action=UPDATE_USER&page=1&limit=50`, { token: await admin() })
    const hit = (logs.body.items ?? []).some((l: any) => l.details?.updatedUserId === id.gerente && l.details?.changes?.module_tickets === false)
    expect(hit).toBe(true)
  })

  it('gerente sem Chamados não liga Chamados para ninguém do time', async () => {
    const r = await http('PATCH', `/api/users/${id.an1}`, { token: await as('gerente'), body: { module_tickets: true } })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('MODULE_NOT_OWNED')
  })

  it('gravar só Projetos não congela Chamados (continua herdando)', async () => {
    await setModules(id.gerente, { module_tickets: false, module_projects: false })
    await setModules(id.an1, { module_projects: true })
    const a = await fresh('an1')
    expect(a.user.modules).toEqual({ tickets: false, projects: true, documents: false })
  })

  it('gerente com Chamados desliga Chamados de alguém do time', async () => {
    await setModules(id.gerente, { module_tickets: null, module_projects: null })
    await setModules(id.an1, { module_tickets: null, module_projects: null })
    const r = await http('PATCH', `/api/users/${id.an1}`, { token: await as('gerente'), body: { module_tickets: false } })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const a = await fresh('an1')
    expect(a.user.modules.tickets).toBe(false)
    expect(a.user.home).toBe('/solicitacoes') // sem Chamados nem Projetos: só as próprias solicitações
  })
})
