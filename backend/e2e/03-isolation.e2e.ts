// Isolamento multiempresa e por papel, com as contas reais do seed-test-rbac:
// an1 só ACME, an2/tm ACME+Globex, an3/tm2 Initech, gerente tudo.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, http, openTicket, orgs } from './helpers'

let acmeT: any, globexT: any, initechT: any, acme2T: any
let O: Awaited<ReturnType<typeof orgs>>

beforeAll(async () => {
  O = await orgs()
  acmeT = await openTicket('acme1')
  acme2T = await openTicket('acme2' as any)
  globexT = await openTicket('globex1')
  initechT = await openTicket('initech1')
})

const get = async (who: any, id: string) => (await http('GET', `/api/tickets/${id}`, { token: await as(who) })).status

describe('chamados: quem vê o quê', () => {
  it('cliente vê só os próprios chamados (nem o do colega da mesma empresa)', async () => {
    expect(await get('acme1', acmeT.id)).toBe(200)
    expect(await get('acme1', acme2T.id)).toBe(403)
    expect(await get('acme1', globexT.id)).toBe(403)
    const list = await http('GET', '/api/tickets?page=1&pageSize=100', { token: await as('acme1') })
    const ids = list.body.data.map((t: any) => t.id)
    expect(ids).toContain(acmeT.id)
    expect(ids).not.toContain(acme2T.id)
    expect(ids).not.toContain(globexT.id)
  })

  it('analista só-ACME não abre chamado da Globex/Initech (detalhe, mensagens, edição)', async () => {
    expect(await get('an1', acmeT.id)).toBe(200)
    for (const t of [globexT, initechT]) {
      expect(await get('an1', t.id)).toBe(403)
      expect((await http('GET', `/api/tickets/${t.id}/messages`, { token: await as('an1') })).status).toBe(403)
      expect((await http('POST', `/api/tickets/${t.id}/messages`, { token: await as('an1'), body: { text: 'oi', type: 'agent' } })).status).toBe(403)
      expect((await http('PATCH', `/api/tickets/${t.id}`, { token: await as('an1'), body: { assigned_to_id: (await as('an1')) && undefined } })).status).toBe(403)
    }
  })

  for (const [who, sees, hidden] of [
    ['an1', () => [acmeT], () => [globexT, initechT]],
    // an2 atende ACME+Globex mas só a fila geral: o chamado ACME (gold → fila VIP) fica de fora
    ['an2', () => [globexT], () => [acmeT, initechT]],
    ['tm', () => [acmeT, globexT], () => [initechT]],
    ['tm2', () => [initechT], () => [acmeT, globexT]],
    ['an3', () => [initechT], () => [acmeT, globexT]],
    ['gerente', () => [acmeT, globexT, initechT], () => []],
  ] as const) {
    it(`listagens de ${who} respeitam a carteira (paginada, legada, ids=)`, async () => {
      const token = await as(who as any)
      const all = [...sees(), ...hidden()].map(t => t.id)
      const paged = await http('GET', `/api/tickets?page=1&pageSize=100&ids=${all.join(',')}`, { token })
      expect(paged.status).toBe(200)
      const got = paged.body.data.map((t: any) => t.id).sort()
      expect(got).toEqual(sees().map(t => t.id).sort())
      const legacy = await http('GET', '/api/tickets?limit=500', { token })
      const legacyIds = (legacy.body.data ?? legacy.body).map((t: any) => t.id)
      for (const t of hidden()) expect(legacyIds).not.toContain(t.id)
    })
  }

  it('busca textual não vaza chamado de fora da carteira', async () => {
    const r = await http('GET', `/api/tickets?page=1&search=${encodeURIComponent(globexT.title)}`, { token: await as('an1') })
    expect(r.body.data.map((t: any) => t.id)).not.toContain(globexT.id)
  })

  it('contadores/agrupamentos/atividade não contam chamados de fora da carteira', async () => {
    for (const path of ['/api/tickets/counts', `/api/tickets/counts/grouped?by=org`, '/api/tickets/activity']) {
      const r = await http('GET', path, { token: await as('an1') })
      expect(r.status).toBe(200)
      expect(JSON.stringify(r.body)).not.toContain(O.globex.id)
      expect(JSON.stringify(r.body)).not.toContain(globexT.id)
    }
  })
})

describe('notas internas', () => {
  let t: any
  beforeAll(async () => {
    t = await openTicket('acme1')
    const an1 = await as('an1')
    const me = (await http('GET', '/api/users?role=agent', { token: await as('admin') })).body.data.find((u: any) => u.email === 'analista1.teste@isa.local')
    const assign = await http('PATCH', `/api/tickets/${t.id}`, { token: an1, body: { assigned_to_id: me.id } })
    expect(assign.status).toBe(200)
    const note = await http('POST', `/api/tickets/${t.id}/messages`, { token: an1, body: { text: 'SEGREDO-INTERNO cliente difícil', type: 'internal' } })
    expect(note.status).toBe(201)
  })

  it('cliente não recebe nota interna em GET /messages', async () => {
    const r = await http('GET', `/api/tickets/${t.id}/messages`, { token: await as('acme1') })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toContain('SEGREDO-INTERNO')
  })

  it('cliente não recebe nota interna em GET /tickets/:id', async () => {
    const r = await http('GET', `/api/tickets/${t.id}`, { token: await as('acme1') })
    expect(JSON.stringify(r.body)).not.toContain('SEGREDO-INTERNO')
  })

  it('cliente não consegue postar nota interna nem resposta "agent"', async () => {
    for (const type of ['internal', 'agent']) {
      const r = await http('POST', `/api/tickets/${t.id}/messages`, { token: await as('acme1'), body: { text: 'x', type } })
      expect(r.status).toBe(403)
    }
  })
})

describe('empresas (carteira)', () => {
  it('analista só-ACME lista só as empresas da carteira', async () => {
    const r = await http('GET', '/api/organizations', { token: await as('an1') })
    const ids = r.body.data.map((o: any) => o.id)
    expect(ids).toContain(O.acme.id)
    expect(ids).not.toContain(O.globex.id)
    expect(ids).not.toContain(O.initech.id)
  })

  for (const who of ['an1', 'tm'] as const) {
    it(`${who} não lê nem edita empresa fora da carteira`, async () => {
      const token = await as(who)
      expect((await http('GET', `/api/organizations/${O.initech.id}`, { token })).status).toBe(403)
      expect((await http('GET', `/api/organizations/${O.initech.id}/queue-access`, { token })).status).toBe(403)
      expect((await http('PATCH', `/api/organizations/${O.initech.id}`, { token, body: { name: O.initech.name } })).status).toBe(403)
      expect((await http('GET', `/api/organizations/${O.initech.id}/authorized-domains`, { token })).status).toBe(403)
    })
  }

  it('cliente só lê a própria empresa', async () => {
    expect((await http('GET', `/api/organizations/${O.acme.id}`, { token: await as('acme1') })).status).toBe(200)
    expect((await http('GET', `/api/organizations/${O.globex.id}`, { token: await as('acme1') })).status).toBe(403)
  })
})

describe('usuários', () => {
  it('analista não lista clientes de empresa fora da carteira', async () => {
    const r = await http('GET', '/api/users?role=user', { token: await as('an1') })
    expect(r.status).toBe(200)
    const emails = r.body.data.map((u: any) => u.email)
    expect(emails).not.toContain('usuario1.initech@isa.local')
    expect(emails).not.toContain('usuario1.globex@isa.local')
  })

  it('ninguém além do admin enxerga hash de senha', async () => {
    for (const who of ['admin', 'gerente', 'tm', 'an1'] as const) {
      const r = await http('GET', '/api/users', { token: await as(who) })
      expect(JSON.stringify(r.body)).not.toMatch(/"password"|\$2[aby]\$/)
    }
  })
})

describe('dashboards', () => {
  for (const path of ['overview', 'productivity', 'management', 'corporations', 'inactivity', 'sla-expiring']) {
    it(`/dashboard/${path}: TM de ACME+Globex não vê Initech`, async () => {
      const r = await http('GET', `/api/dashboard/${path}`, { token: await as('tm') })
      expect(r.status).toBeLessThan(500)
      if (r.status === 200) {
        const s = JSON.stringify(r.body)
        expect(s).not.toContain(O.initech.id)
        expect(s).not.toContain(initechT.id)
      }
    })
  }

  it('cliente não acessa dashboards de gestão', async () => {
    for (const path of ['overview', 'productivity', 'management', 'corporations']) {
      expect((await http('GET', `/api/dashboard/${path}`, { token: await as('acme1') })).status).toBe(403)
    }
  })
})

describe('ações de área exigem concessão explícita (padrão do perfil só libera menu)', () => {
  it('analista não cria nem exclui empresa e não mexe em carteira (served-by); domínios SSO da carteira sim', async () => {
    const t = await as('an1')
    expect((await http('POST', '/api/organizations', { token: t, body: { name: 'Criada por analista', tier: 'bronze', domains: [] } })).status).toBe(403)
    expect((await http('DELETE', `/api/organizations/${O.initech.id}`, { token: t })).status).toBe(403)
    expect((await http('POST', `/api/organizations/${O.initech.id}/served-by`, { token: t, body: { userId: 'x' } })).status).toBe(403)
    expect((await http('POST', `/api/organizations/${O.initech.id}/authorized-domains`, { token: t, body: { domain: 'x.com' } })).status).toBe(403)
    expect((await http('GET', `/api/organizations/${O.acme.id}/authorized-domains`, { token: t })).status).toBe(200)
  })

  it('analista não exclui usuário', async () => {
    const users = (await http('GET', '/api/users?role=user', { token: await as('admin') })).body.data
    const victim = users.find((u: any) => u.email === 'usuario2.globex@isa.local')
    expect((await http('DELETE', `/api/users/${victim.id}`, { token: await as('an1') })).status).toBe(403)
  })

  it('gerente continua criando analista na própria equipe', async () => {
    const r = await http('POST', '/api/users', { token: await as('gerente'), body: { name: 'Analista do gerente', email: `an.ger.${Date.now()}@isa.local`, password: 'Senha@123', role: 'agent', org_id: O.acme.id } })
    expect(r.status).toBe(201)
  })
})
