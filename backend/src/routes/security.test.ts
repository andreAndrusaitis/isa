/** Regressões de segurança: cada caso aqui já foi uma brecha. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import app from '../app'
import prisma from '../config/prisma'
import { issueTokens } from '../services/auth'
import { checkAvatar, storeAttachment } from '../services/uploads'
import { safeAttachmentUrl } from '../controllers/tickets'
import { senderAuthenticated } from '../services/email/inbound'
import { validateTeamsSsoClaims } from '../services/teamsSso'

const ids: string[] = []
const stamp = Date.now()

async function makeUser(data: object = {}) {
  const u = await prisma.user.create({
    data: { name: 'Teste', email: `sec-${stamp}-${ids.length}@example.com`, role: 'user', password: await bcrypt.hash('senha-antiga', 4), ...data },
  })
  ids.push(u.id)
  return { user: u, token: (await issueTokens(u, false)).accessToken }
}

beforeAll(async () => { await prisma.$queryRaw`SELECT 1` })
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.refreshToken.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('senha provisória', () => {
  it('só deixa ver a sessão e trocar a senha, e a nova precisa ser diferente', async () => {
    const { token } = await makeUser({ must_change_password: true })
    const as = (r: request.Test) => r.set('Authorization', `Bearer ${token}`)
    const blocked = await as(request(app).get('/api/tickets'))
    expect([blocked.status, blocked.body.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED'])
    expect((await as(request(app).get('/api/auth/me'))).status).toBe(200)
    const same = await as(request(app).patch('/api/users/me/password')).send({ currentPassword: 'senha-antiga', newPassword: 'senha-antiga' })
    expect(same.body.code).toBe('SAME_PASSWORD')
    const short = await as(request(app).patch('/api/users/me/password')).send({ currentPassword: 'senha-antiga', newPassword: 'curta' })
    expect(short.status).toBe(400)
    expect((await as(request(app).patch('/api/users/me/password')).send({ currentPassword: 'senha-antiga', newPassword: 'senha-nova-1' })).status).toBe(200)
  })
})

describe('login e logout a partir de outro site', () => {
  it('recusa origem desconhecida, aceita a do portal e quem não manda origem', async () => {
    const body = { email: 'nao-existe@example.com', password: 'x' }
    const evil = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example').send({})
    expect([evil.status, evil.body.code]).toEqual([403, 'ORIGIN_NOT_ALLOWED'])
    expect((await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send(body)).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send(body)).status).toBe(401)
  })

  it('formulário HTML não é aceito como corpo', async () => {
    const { user } = await makeUser()
    const r = await request(app).post('/api/auth/login').type('form').send({ email: user.email, password: 'senha-antiga' })
    expect(r.status).not.toBe(200)
    expect(r.headers['set-cookie']).toBeUndefined()
  })
})

describe('arquivos vindos do cliente', () => {
  it('foto: só imagem em data URI ou iniciais', () => {
    expect(checkAvatar('AB')).toBe('AB')
    expect(() => checkAvatar('https://evil.example/pixel.png')).toThrow()
    expect(() => checkAvatar('//evil.example/pixel.png')).toThrow()
    expect(() => checkAvatar('data:text/html;base64,PHNjcmlwdD4=')).toThrow()
    expect(() => checkAvatar('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
  })

  it('anexo: tipo conferido mesmo sem blob; nada de endereço externo', async () => {
    await expect(storeAttachment('data:text/html;base64,PHNjcmlwdD4=', 'tickets')).rejects.toThrow('Tipo de arquivo')
    for (const url of ['https://evil.example/x', 'http://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) expect(safeAttachmentUrl.safeParse(url).success).toBe(false)
  })
})

describe('identidade Microsoft e e-mail', () => {
  it('token do Teams sem preferred_username não cai no claim email', () => {
    const tid = '33333333-3333-4333-8333-333333333333'
    const claims = { aud: process.env.TEAMS_SSO_CLIENT_ID, iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, scp: 'access_as_user', email: 'admin@vitima.com' }
    expect(() => validateTeamsSsoClaims(claims)).toThrow()
  })

  it('remetente só conta como autenticado com DMARC ou compauth aprovado', () => {
    const msg = (value?: string) => ({ internetMessageHeaders: value ? [{ name: 'Authentication-Results', value }] : [] }) as never
    expect(senderAuthenticated(msg('spf=fail; dkim=none; dmarc=fail action=none'))).toBe(false)
    expect(senderAuthenticated(msg('spf=none; dkim=none; dmarc=none'))).toBe(false)
    expect(senderAuthenticated(msg('spf=pass; dkim=pass; dmarc=pass; compauth=pass reason=100'))).toBe(true)
    expect(senderAuthenticated(msg())).toBe(true)
  })
})
