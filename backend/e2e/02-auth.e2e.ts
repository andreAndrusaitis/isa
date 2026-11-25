// Login, refresh com rotação, logout, troca de senha e rate limit — fluxos reais
// de sessão. Cada teste usa um usuário descartável criado pelo admin.
import { beforeAll, describe, expect, it } from 'vitest'
import { PROVISORIA, as, http, trocarProvisoria, orgs, uid, fakeIp } from './helpers'

async function freshUser(role = 'user', extra: Record<string, unknown> = {}) {
  const email = `e2e.auth.${uid()}@isa.local`
  const r = await http('POST', '/api/users', {
    token: await as('admin'),
    body: { name: 'E2E Auth', email, password: PROVISORIA, role, orgId: (await orgs()).acme.id, org_id: (await orgs()).acme.id, ...extra },
  })
  if (r.status !== 201) throw new Error(`criar usuário → ${r.status} ${JSON.stringify(r.body)}`)
  await trocarProvisoria(email, 'Senha@123')
  return { email, id: r.body.data.id, password: 'Senha@123' }
}

async function doLogin(email: string, password: string, ip = fakeIp()) {
  const r = await http('POST', '/api/auth/login', { body: { email, password }, ip })
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  return { ...r, token: r.body?.data?.accessToken as string, cookie }
}

const refresh = (cookie: string) => http('POST', '/api/auth/refresh', { headers: { cookie } })
const me = (token: string) => http('GET', '/api/notifications', { token })

describe('login', () => {
  let u: Awaited<ReturnType<typeof freshUser>>
  beforeAll(async () => { u = await freshUser() })

  it('credenciais certas → 200, cookie httpOnly do refresh e sem refresh no corpo', async () => {
    const r = await doLogin(u.email, u.password)
    expect(r.status).toBe(200)
    expect(r.body.data.refreshToken).toBeUndefined()
    const sc = r.headers.get('set-cookie') ?? ''
    expect(sc).toMatch(/HttpOnly/i)
    expect(sc).toMatch(/Path=\/api\/auth/i)
    expect(r.body.data.user.password).toBeUndefined()
  })

  it('senha errada e e-mail inexistente devolvem a MESMA resposta (sem enumeração)', async () => {
    const a = await doLogin(u.email, 'errada')
    const b = await doLogin(`naoexiste.${uid()}@isa.local`, 'errada')
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.body).toEqual(b.body)
  })

  it('e-mail com maiúsculas/espaços também entra (celular capitaliza a 1ª letra)', async () => {
    const upper = u.email.charAt(0).toUpperCase() + u.email.slice(1)
    expect((await doLogin(upper, u.password)).status).toBe(200)
    expect((await doLogin(`  ${u.email} `, u.password)).status).toBe(200)
  })

  it('usuário desativado: login bloqueado e token já emitido deixa de valer', async () => {
    const v = await freshUser()
    const s = await doLogin(v.email, v.password)
    expect((await me(s.token)).status).toBe(200)
    const off = await http('PATCH', `/api/users/${v.id}`, { token: await as('admin'), body: { active: false } })
    expect(off.status).toBe(200)
    expect((await me(s.token)).status).toBe(401)
    expect((await refresh(s.cookie)).status).toBe(401)
    expect((await doLogin(v.email, v.password)).status).toBe(401)
  })
})

describe('refresh token', () => {
  it('rotaciona: devolve novo access e novo cookie', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    const r = await refresh(s.cookie)
    expect(r.status).toBe(200)
    expect(r.body.data.accessToken).toBeTruthy()
    expect(r.headers.get('set-cookie')).toMatch(/isa_rt=/)
    expect((await me(r.body.data.accessToken)).status).toBe(200)
  })

  it('sem cookie → 401; cookie lixo → 401', async () => {
    expect((await http('POST', '/api/auth/refresh')).status).toBe(401)
    expect((await refresh('isa_rt=lixo')).status).toBe(401)
  })

  it('access token não serve como refresh e refresh não serve como access', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    expect((await refresh(`isa_rt=${s.token}`)).status).toBe(401)
    expect((await me(s.cookie.replace('isa_rt=', ''))).status).toBe(401)
  })

  it('duas abas renovando ao mesmo tempo não derrubam a sessão', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    const [a, b] = await Promise.all([refresh(s.cookie), refresh(s.cookie)])
    expect([a.status, b.status]).toEqual([200, 200])
  })
})

describe('logout', () => {
  it('invalida access e refresh do dispositivo', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    const out = await http('POST', '/api/auth/logout', { headers: { cookie: s.cookie } })
    expect(out.status).toBe(200)
    expect((await me(s.token)).status).toBe(401)
    expect((await refresh(s.cookie)).status).toBe(401)
  })

  it('login logo após logout (mesmo segundo) gera token VÁLIDO', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    await http('POST', '/api/auth/logout', { headers: { cookie: s.cookie } })
    const again = await doLogin(u.email, u.password)
    expect(again.status).toBe(200)
    expect((await me(again.token)).status).toBe(200)
  })

  it('logout num dispositivo: o outro perde o access token mas se recupera pelo refresh', async () => {
    const u = await freshUser()
    const pc = await doLogin(u.email, u.password)
    await new Promise(r => setTimeout(r, 1100))
    const phone = await doLogin(u.email, u.password)
    await http('POST', '/api/auth/logout', { headers: { cookie: pc.cookie } })
    // session_invalidated_at é por usuário, não por sessão — derruba todos os access tokens
    if ((await me(phone.token)).status === 401) {
      // token emitido no MESMO segundo do logout também é rejeitado (iat em segundos) — espera 1s
      await new Promise(r => setTimeout(r, 1100))
      const r = await refresh(phone.cookie)
      expect(r.status).toBe(200)
      expect((await me(r.body.data.accessToken)).status).toBe(200)
    }
  })
})

describe('troca de senha', () => {
  it('senha atual errada → 401; nova senha curta → 400', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    expect((await http('PATCH', '/api/users/me/password', { token: s.token, body: { currentPassword: 'x', newPassword: 'Nova@12345' } })).status).toBe(401)
    expect((await http('PATCH', '/api/users/me/password', { token: s.token, body: { currentPassword: u.password, newPassword: '123' } })).status).toBe(400)
  })

  it('após trocar a senha, a senha antiga não entra e sessões antigas (refresh roubado) morrem', async () => {
    const u = await freshUser()
    const stolen = await doLogin(u.email, u.password)
    await new Promise(r => setTimeout(r, 1100))
    const s = await doLogin(u.email, u.password)
    const ch = await http('PATCH', '/api/users/me/password', { token: s.token, body: { currentPassword: u.password, newPassword: 'Nova@12345' } })
    expect(ch.status).toBe(200)
    expect((await doLogin(u.email, u.password)).status).toBe(401)
    expect((await doLogin(u.email, 'Nova@12345')).status).toBe(200)
    expect((await refresh(stolen.cookie)).status).toBe(401)
  })
})

describe('cadastro de e-mail', () => {
  it('não permite duas contas com o mesmo e-mail variando maiúsculas', async () => {
    const u = await freshUser()
    const dup = await http('POST', '/api/users', {
      token: await as('admin'),
      body: { name: 'Dup', email: u.email.toUpperCase(), password: 'Senha@123', role: 'user', org_id: (await orgs()).acme.id },
    })
    expect(dup.status).toBeGreaterThanOrEqual(400)
    expect(dup.status).toBeLessThan(500)
  })
})

describe('/users/me', () => {
  it('usuário final não muda o próprio papel, empresa, e-mail nem permissões', async () => {
    const u = await freshUser()
    const s = await doLogin(u.email, u.password)
    const r = await http('PATCH', '/api/users/me', {
      token: s.token,
      body: { name: 'Novo Nome', role: 'admin', org_id: (await orgs()).globex.id, email: `x${uid()}@isa.local`, permissions: ['users'] },
    })
    expect(r.status).toBe(200)
    const after = await http('GET', `/api/users/${u.id}`, { token: await as('admin') })
    expect(after.body.data.role).toBe('user')
    expect(after.body.data.email).toBe(u.email)
    expect(after.body.data.name).toBe('Novo Nome')
  })
})

describe('rate limit de login', () => {
  it('10 falhas do mesmo IP bloqueiam (429) e login correto de OUTRO IP segue funcionando', async () => {
    const u = await freshUser()
    const ip = fakeIp()
    let last = 0
    for (let i = 0; i < 11; i++) last = (await doLogin(u.email, 'errada', ip)).status
    expect(last).toBe(429)
    expect((await doLogin(u.email, u.password, fakeIp())).status).toBe(200)
  })
})

describe('rate limit geral', () => {
  it('é por usuário: dois usuários atrás do MESMO IP (NAT da empresa) não dividem a cota', async () => {
    const ip = fakeIp()
    const [a, b] = await Promise.all([freshUser(), freshUser()])
    const ta = (await doLogin(a.email, a.password)).token
    const tb = (await doLogin(b.email, b.password)).token
    const burst = async (token: string, n: number) => {
      const st: number[] = []
      for (let i = 0; i < n; i += 25) st.push(...(await Promise.all(Array.from({ length: Math.min(25, n - i) }, () => http('GET', '/api/queues', { token, ip })))).map(r => r.status))
      return st
    }
    expect((await burst(ta, 300)).filter(s => s === 429)).toEqual([])
    expect((await burst(tb, 300)).filter(s => s === 429)).toEqual([])
    // o próprio usuário continua limitado
    expect((await burst(ta, 250)).filter(s => s === 429).length).toBeGreaterThan(0)
  })
})

describe('staff sem empresa (legado)', () => {
  it('pode ser desativado e editado sem informar empresa', async () => {
    const admin = await as('admin')
    const tm2 = (await http('GET', '/api/users?role=supervisor', { token: admin })).body.data.find((u: any) => u.email === 'tm2.teste@isa.local')
    const r = await http('PATCH', `/api/users/${tm2.id}`, { token: admin, body: { phone: '11999990000' } })
    expect(r.status).toBe(200)
  })
})
