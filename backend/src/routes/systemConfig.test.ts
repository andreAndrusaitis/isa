import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { forgetSettingsCache } from '../services/systemSettings'
import { refreshAiProvider } from '../ai/core/provider'

const token = (sub: string, role: string) => jwt.sign({ sub, role, email: `${role}@teste.com` }, env.JWT_SECRET, { expiresIn: '10m' })
let admin = ''
let agent = ''
const ids: string[] = []
const CLIENT = '11111111-1111-4111-8111-111111111111'
const sso = { enabled: true, clientId: CLIENT, tenants: [], authMethod: 'secret' }
const ai = {
  enabled: true, kind: 'azure', endpoint: 'https://um.openai.azure.com', chatModel: 'gpt', embeddingModel: 'emb', apiVersion: '2024-10-21',
  timeoutMs: 15000, maxConcurrency: 6, assistantRateLimit: 20, assistantRateWindowMin: 5, assistantMaxConversationTokens: 50000, assistantDailyTokenAlert: 0,
}
const as = (t: string, method: 'get' | 'put' | 'delete' | 'post', path: string, body?: object) =>
  request(app)[method](`/api/system-config${path}`).set('Authorization', `Bearer ${t}`).send(body)

beforeAll(async () => {
  for (const role of ['admin', 'agent'] as const) {
    const u = await prisma.user.create({ data: { name: role, email: `${role}-${Date.now()}@cfg.test`, role } })
    ids.push(u.id)
    if (role === 'admin') admin = token(u.id, role)
    else agent = token(u.id, role)
  }
})
beforeEach(async () => { await prisma.systemSetting.deleteMany(); forgetSettingsCache(); await refreshAiProvider({ fresh: true }) })
afterAll(async () => {
  await prisma.systemSetting.deleteMany()
  forgetSettingsCache()
  await refreshAiProvider({ fresh: true })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('acesso', () => {
  it('a parte pública não traz nada além de cores e logins', async () => {
    const r = await request(app).get('/api/system-config/public')
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.data).sort()).toEqual(['appearance', 'login'])
    expect(r.body.data.login).toEqual({ microsoft: false })
  })

  it.each(['/sso', '/ai'])('%s: anônimo 401, analista 403', async path => {
    expect((await request(app).get(`/api/system-config${path}`)).status).toBe(401)
    expect((await as(agent, 'get', path)).status).toBe(403)
    expect((await as(agent, 'put', path, {})).status).toBe(403)
  })
})

describe('aparência', () => {
  it('salva, aparece na parte pública e volta ao padrão', async () => {
    const seeds = { primary: '#8B1538', accent: '#f2a3b5', sidebar: '#230a13' }
    expect((await as(admin, 'put', '/appearance', seeds)).body.data.primary).toBe('#8b1538')
    expect((await request(app).get('/api/system-config/public')).body.data.appearance.sidebar).toBe('#230a13')
    expect((await as(admin, 'delete', '/appearance')).body.data.primary).toBe('#0f73ac')
  })

  it('recusa o que não é cor', async () => {
    const r = await as(admin, 'put', '/appearance', { primary: 'red;}body{}', accent: '#ffffff', sidebar: '#000000' })
    expect(r.status).toBe(400)
  })
})

describe('login Microsoft', () => {
  it('não liga sem segredo', async () => {
    expect((await as(admin, 'put', '/sso', sso)).body.code).toBe('SSO_SECRET_REQUIRED')
  })

  it('guarda o segredo cifrado, nunca o devolve nem o põe na auditoria', async () => {
    const r = await as(admin, 'put', '/sso', { ...sso, clientSecret: 'super-segredo-123' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ active: true, hasClientSecret: true, source: 'admin' })
    expect(JSON.stringify(r.body)).not.toContain('super-segredo')
    const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'sso_microsoft' } })
    expect(JSON.stringify(row)).not.toContain('super-segredo')
    const audit = await prisma.auditLog.findFirst({ where: { action: 'UPDATE_SYSTEM_SETTING', user_id: ids[0] }, orderBy: { created_at: 'desc' } })
    expect(JSON.stringify(audit)).toContain('clientSecret')
    expect(JSON.stringify(audit)).not.toContain('super-segredo')
    expect((await request(app).get('/api/system-config/public')).body.data.login.microsoft).toBe(true)
  })

  it('salvar sem redigitar mantém o segredo; desligar esconde o botão', async () => {
    await as(admin, 'put', '/sso', { ...sso, clientSecret: 'abc' })
    expect((await as(admin, 'put', '/sso', { ...sso, tenants: [CLIENT] })).body.data).toMatchObject({ active: true, tenants: [CLIENT] })
    expect((await as(admin, 'put', '/sso', { ...sso, enabled: false })).body.data.active).toBe(false)
    expect((await request(app).get('/api/system-config/public')).body.data.login.microsoft).toBe(false)
  })

  it('sem configuração, /auth/login volta à tela de login com aviso', async () => {
    const r = await request(app).get('/auth/login')
    expect(r.status).toBe(302)
    expect(r.headers.location).toContain('/login?ssoError=not_configured')
  })
})

describe('provedor de IA', () => {
  it('guarda a chave cifrada e não a devolve', async () => {
    const r = await as(admin, 'put', '/ai', { ...ai, apiKey: 'chave-secreta-9' })
    expect(r.body.data).toMatchObject({ active: true, hasApiKey: true, chatModel: 'gpt' })
    expect(JSON.stringify(r.body)).not.toContain('chave-secreta')
    expect(JSON.stringify(await prisma.systemSetting.findUnique({ where: { key: 'ai_provider' } }))).not.toContain('chave-secreta')
  })

  it('a chave guardada não vai para outro servidor, nem no teste', async () => {
    await as(admin, 'put', '/ai', { ...ai, apiKey: 'chave-secreta-9' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const r of [await as(admin, 'put', '/ai', { ...ai, endpoint: 'https://outro.example.com' }), await as(admin, 'post', '/ai/test', { ...ai, endpoint: 'https://outro.example.com' })]) {
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('AI_KEY_REQUIRED')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exige https fora de localhost', async () => {
    expect((await as(admin, 'put', '/ai', { ...ai, endpoint: 'http://ia.example.com', apiKey: 'x' })).body.code).toBe('AI_ENDPOINT_INSECURE')
    expect((await as(admin, 'put', '/ai', { ...ai, kind: 'openai', endpoint: 'http://localhost:11434/v1', apiKey: 'x' })).status).toBe(200)
  })

  it('testa sem gravar e usa o formato do provedor', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }))
    const r = await as(admin, 'post', '/ai/test', { ...ai, kind: 'openai', endpoint: 'https://api.example.com/v1', apiKey: 'k' })
    expect(r.body.data.ok).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k')
    expect(JSON.parse(String(init.body)).model).toBe('gpt')
    fetchSpy.mockRestore()
    expect(await prisma.systemSetting.count()).toBe(0)
  })
})
