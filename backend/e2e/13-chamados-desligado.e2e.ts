// Chamados desligado bloqueia de verdade.
// O gerente fica só com Projetos; o time dele (tm → an1) herda. Quem está com
// Chamados desligado só usa chamados como solicitante (Minhas solicitações).
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, PASS, U, as, http, login, openTicket, uid } from './helpers'

const req = createRequire(join(__dirname, '..', '..', 'frontend', 'package.json'))
const { io } = req('socket.io-client') as typeof import('socket.io-client')

const id: Record<string, string> = {}
let acmeTicket: any
// login() do helper guarda a sessão; aqui cada passo precisa de um token novo (a sessão muda).
const token = async (who: keyof typeof U) =>
  (await http('POST', '/api/auth/login', { body: { email: U[who], password: PASS } })).body.data.accessToken as string
const setModules = async (userId: string, body: Record<string, boolean | null>) =>
  http('PATCH', `/api/users/${userId}`, { token: await as('admin'), body })

beforeAll(async () => {
  for (const k of ['gerente', 'an1'] as const) id[k] = (await login(U[k])).user.id
  acmeTicket = await openTicket('acme1')
  const r = await setModules(id.gerente, { module_tickets: false, module_projects: true })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
})

afterAll(async () => {
  await setModules(id.gerente, { module_tickets: null, module_projects: null })
})

describe('analista com Chamados desligado (herdado do gerente)', () => {
  let own: any

  it('abre um chamado para si (Minhas solicitações continua)', async () => {
    const r = await http('POST', '/api/tickets', { token: await token('an1'), body: { title: 'Preciso de ajuda', description: 'Pedido do analista como solicitante' } })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    own = r.body.data
  })

  it('a lista traz só os chamados que ele abriu', async () => {
    const r = await http('GET', '/api/tickets?page=1&pageSize=100', { token: await token('an1') })
    expect(r.status).toBe(200)
    const ids = r.body.data.map((t: any) => t.id)
    expect(ids).toContain(own.id)
    expect(ids).not.toContain(acmeTicket.id)
    expect(r.body.data.every((t: any) => (t.userId ?? t.user_id) === id.an1)).toBe(true)
  })

  it('não abre chamado de cliente da carteira', async () => {
    expect((await http('GET', `/api/tickets/${acmeTicket.id}`, { token: await token('an1') })).status).toBe(403)
  })

  it('não atende: alterar, escalonar, respostas prontas → sem acesso ao módulo', async () => {
    const t = await token('an1')
    const patch = await http('PATCH', `/api/tickets/${acmeTicket.id}`, { token: t, body: { priority: 'high' } })
    expect(patch.status).toBe(403)
    expect(patch.body.code).toBe('FORBIDDEN')
    expect((await http('GET', '/api/macros', { token: t })).status).toBe(403)
  })

  it('responde no próprio chamado como solicitante, sem nota interna', async () => {
    const t = await token('an1')
    const internal = await http('POST', `/api/tickets/${own.id}/messages`, { token: t, body: { text: 'Nota', type: 'internal' } })
    expect(internal.status).toBe(403)
    expect(internal.body.code).toBe('MESSAGE_TYPE_NOT_ALLOWED')
    const pub = await http('POST', `/api/tickets/${own.id}/messages`, { token: t, body: { text: 'Mais detalhes' } })
    expect(pub.status, JSON.stringify(pub.body)).toBe(201)
  })
})

describe('gerente só de projetos', () => {
  it('não vê os painéis de chamados', async () => {
    expect((await http('GET', '/api/dashboard/overview', { token: await token('gerente') })).status).toBe(403)
  })

  it('continua com Projetos', async () => {
    expect((await http('GET', '/api/projects', { token: await token('gerente') })).status).toBe(200)
  })
})

describe('religando Chamados', () => {
  it('o time volta a atender', async () => {
    await setModules(id.gerente, { module_tickets: null, module_projects: null })
    const t = await token('an1')
    expect((await http('GET', `/api/tickets/${acmeTicket.id}`, { token: t })).status).toBe(200)
    expect((await http('GET', '/api/macros', { token: t })).status).toBe(200)
  })
})

describe('tempo real', () => {
  // Conecta, cria um chamado da ACME na fila geral (do an1) e diz se ele recebeu.
  async function an1Receives(): Promise<boolean> {
    const sock = io(BASE, { transports: ['websocket'], auth: { token: await token('an1') }, forceNew: true, reconnection: false })
    const seen: string[] = []
    sock.onAny((_ev: string, data: any) => seen.push(JSON.stringify(data ?? '')))
    await new Promise<void>((res, rej) => { sock.on('connect', () => res()); sock.on('connect_error', rej) })
    await new Promise(r => setTimeout(r, 400))
    const marker = `RT-${uid()}`
    await openTicket('acme1', { title: marker })
    await new Promise(r => setTimeout(r, 1500))
    sock.close()
    return seen.some(e => e.includes(marker))
  }

  it('com Chamados ligado o analista recebe o chamado novo da fila', async () => {
    expect(await an1Receives()).toBe(true)
  })

  it('conexão já aberta para de receber quando Chamados é desligado (sem reconectar)', async () => {
    const sock = io(BASE, { transports: ['websocket'], auth: { token: await token('an1') }, forceNew: true, reconnection: false })
    const seen: string[] = []
    sock.onAny((_ev: string, data: any) => seen.push(JSON.stringify(data ?? '')))
    await new Promise<void>((res, rej) => { sock.on('connect', () => res()); sock.on('connect_error', rej) })
    await new Promise(r => setTimeout(r, 400))
    await setModules(id.gerente, { module_tickets: false, module_projects: true })
    try {
      const marker = `RT-ABERTA-${uid()}`
      await openTicket('acme1', { title: marker })
      await new Promise(r => setTimeout(r, 1500))
      expect(seen.some(e => e.includes(marker))).toBe(false)
    } finally {
      sock.close()
      await setModules(id.gerente, { module_tickets: null, module_projects: null })
    }
  })

  it('com Chamados desligado não recebe chamado de cliente', async () => {
    await setModules(id.gerente, { module_tickets: false, module_projects: true })
    try {
      expect(await an1Receives()).toBe(false)
    } finally {
      await setModules(id.gerente, { module_tickets: null, module_projects: null })
    }
  })
})

describe('revisão de segurança', () => {
  it('chamado não pode ser atribuído a quem está com Chamados desligado', async () => {
    const t = await openTicket('acme1')
    await setModules(id.an1, { module_tickets: false }) // só o an1; o TM dele segue atendendo
    try {
      const r = await http('PATCH', `/api/tickets/${t.id}`, { token: await token('tm'), body: { assigned_to_id: id.an1 } })
      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect(r.body.code).toBe('ASSIGNEE_TICKETS_OFF')
    } finally {
      await setModules(id.an1, { module_tickets: null })
    }
  })

  it('link da pesquisa de satisfação só para quem vê o chamado (antes: qualquer logado)', async () => {
    const t = await openTicket('acme1')
    expect((await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await token('acme2') })).status).toBe(403)
    expect((await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await token('initech1') })).status).toBe(403)
    expect((await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await token('acme1') })).status).toBe(200)
  })
})
