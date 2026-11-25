// Cliente HTTP da suíte E2E: fala com um backend REAL rodando (E2E_BASE_URL),
// nunca importa o app. Ver e2e/README.md para subir o ambiente isolado.
import { randomUUID } from 'node:crypto'

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3002'
export const PASS = 'Teste@123'

// Backend em NODE_ENV=production confia em 1 proxy: um X-Forwarded-For aleatório
// por requisição tira a suíte do rate limit geral (500 req/15min por IP). Os
// testes do próprio rate limit passam `ip` fixo.
const rnd = () => Math.floor(Math.random() * 250) + 1
export const fakeIp = () => `10.${rnd()}.${rnd()}.${rnd()}`

export interface Res<T = any> { status: number; body: T; headers: Headers; ms: number }

export async function http<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; ip?: string; raw?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? fakeIp(), ...opts.headers }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let payload: string | undefined
  if (opts.raw !== undefined) { payload = opts.raw; headers['content-type'] ??= 'application/json' }
  else if (opts.body !== undefined) { payload = JSON.stringify(opts.body); headers['content-type'] = 'application/json' }
  const t0 = Date.now()
  const r = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' })
  const text = await r.text()
  let body: any = text
  try { body = text ? JSON.parse(text) : null } catch { /* não-JSON */ }
  return { status: r.status, body, headers: r.headers, ms: Date.now() - t0 }
}

export interface Session { token: string; cookie: string; user: any; email: string }
const sessions = new Map<string, Session>()

export async function login(email: string, password = PASS): Promise<Session> {
  const cached = sessions.get(email)
  if (cached) return cached
  const r = await http('POST', '/api/auth/login', { body: { email, password } })
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.body)}`)
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  const s = { token: r.body.data.accessToken, cookie, user: r.body.data.user, email }
  sessions.set(email, s)
  return s
}

export const PROVISORIA = 'Provisoria@123'

/** Conta criada ou redefinida pela equipe só entra de verdade depois de trocar a senha provisória. */
export async function trocarProvisoria(email: string, nova = PASS, provisoria = PROVISORIA) {
  const s = await http('POST', '/api/auth/login', { body: { email, password: provisoria } })
  const r = await http('PATCH', '/api/users/me/password', { token: s.body?.data?.accessToken, body: { currentPassword: provisoria, newPassword: nova } })
  if (r.status !== 200) throw new Error(`trocar senha de ${email} → ${r.status} ${JSON.stringify(r.body)}`)
}

// Contas do seed (prisma/seed.ts + prisma/seed-test-rbac.mjs)
export const U = {
  admin: 'admin.teste@isa.local',
  gerente: 'gerente.teste@isa.local',
  tm: 'tm.teste@isa.local',        // ACME + Globex
  tm2: 'tm2.teste@isa.local',      // Initech
  an1: 'analista1.teste@isa.local', // só ACME
  an2: 'analista2.teste@isa.local', // ACME + Globex
  an3: 'analista3.teste@isa.local', // Initech
  acme1: 'usuario1.acme@isa.local',
  acme2: 'usuario2.acme@isa.local',
  globex1: 'usuario1.globex@isa.local',
  initech1: 'usuario1.initech@isa.local',
} as const

export const as = async (who: keyof typeof U) => (await login(U[who])).token

export const uid = () => randomUUID().slice(0, 8)

let orgCache: Record<string, any> | null = null
export async function orgs(): Promise<Record<'acme' | 'globex' | 'initech', any>> {
  if (orgCache) return orgCache as any
  const r = await http('GET', '/api/organizations', { token: await as('admin') })
  const by = (n: string) => r.body.data.find((o: any) => o.name.startsWith(n))
  orgCache = { acme: by('ACME'), globex: by('Globex'), initech: by('Initech') }
  return orgCache as any
}

/** Abre um chamado como usuário final e devolve o ticket. */
export async function openTicket(who: keyof typeof U = 'acme1', extra: Record<string, unknown> = {}) {
  const r = await http('POST', '/api/tickets', {
    token: await as(who),
    body: { title: `E2E ${uid()}`, description: 'Chamado criado pela suíte E2E', ...extra },
  })
  if (r.status !== 201) throw new Error(`openTicket → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.data
}

// 1x1 PNG — evidência exigida para pôr o chamado em pendente
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
