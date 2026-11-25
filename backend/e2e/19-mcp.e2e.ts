// Servidor MCP (/mcp) com token pessoal: o agente de IA de quem usa o sistema não
// pode enxergar mais do que a própria pessoa.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PASS, PROVISORIA, trocarProvisoria, as, http, orgs, uid } from './helpers'
import { ligarProjetos, novaTask, novoProjeto, type Projeto } from './integration-helpers'

let desligar: () => Promise<void>
let privado: Projeto
let gerente: string
let an1: string

const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
  const r = await http('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 1, method, params },
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
  })
  // Streamable HTTP responde em SSE: o JSON-RPC vem na linha "data: ...".
  const texto = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
  const linha = texto.split('\n').find(l => l.startsWith('data: '))
  return { status: r.status, rpc: linha ? JSON.parse(linha.slice(6)) : r.body }
}

const criarToken = async (sessao: string) => {
  const r = await http('POST', '/api/mcp-tokens', { token: sessao, body: { name: `Cliente ${uid()}` } })
  if (r.status !== 201) throw new Error(`token MCP → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.data as { id: string; token: string }
}

beforeAll(async () => {
  desligar = await ligarProjetos('gerente', 'an1')
  gerente = await as('gerente')
  an1 = await as('an1')
  privado = await novoProjeto('gerente', { privacy: 'private' })
})

afterAll(async () => { await desligar() })

describe('token', () => {
  it('sem token ou com token inventado: 401', async () => {
    expect((await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status).toBe(401)
    expect((await rpc('isamcp_inventado', 'tools/list')).status).toBe(401)
  })

  it('JWT da sessão não serve como token MCP', async () => {
    expect((await rpc(gerente, 'tools/list')).status).toBe(401)
  })

  it('o token aparece só na criação', async () => {
    const t = await criarToken(gerente)
    expect(t.token).toMatch(/^isamcp_/)
    const lista = await http('GET', '/api/mcp-tokens', { token: gerente })
    expect(JSON.stringify(lista.body)).not.toContain(t.token)
  })

  it('revogado para de funcionar', async () => {
    const t = await criarToken(gerente)
    expect((await rpc(t.token, 'tools/list')).status).toBe(200)
    expect((await http('DELETE', `/api/mcp-tokens/${t.id}`, { token: gerente })).status).toBeLessThan(300)
    expect((await rpc(t.token, 'tools/list')).status).toBe(401)
  })

  it('ninguém revoga nem lista o token de outra pessoa', async () => {
    const t = await criarToken(gerente)
    const lista = await http('GET', '/api/mcp-tokens', { token: an1 })
    expect(JSON.stringify(lista.body)).not.toContain(t.id)

    await http('DELETE', `/api/mcp-tokens/${t.id}`, { token: an1 })
    expect((await rpc(t.token, 'tools/list')).status).toBe(200)
  })

  it('token para de valer quando o usuário é desativado', async () => {
    const admin = await as('admin')
    const email = `mcp-${uid()}@isa.local`
    const criado = await http('POST', '/api/users', {
      token: admin,
      body: { name: 'MCP Temporário', email, role: 'agent', password: PROVISORIA, org_id: (await orgs()).acme.id },
    })
    expect(criado.status, JSON.stringify(criado.body)).toBe(201)
    const id = criado.body.data.id
    await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_projects: true } })
    await trocarProvisoria(email)
    const login = await http('POST', '/api/auth/login', { body: { email, password: PASS } })
    const t = await criarToken(login.body.data.accessToken)
    expect((await rpc(t.token, 'tools/list')).status).toBe(200)

    const off = await http('PATCH', `/api/users/${id}`, { token: admin, body: { active: false } })
    expect(off.status).toBe(200)
    expect((await rpc(t.token, 'tools/list')).status).toBe(401)
  })
})

describe('ferramentas', () => {
  it('lista as ferramentas e cada uma tem descrição', async () => {
    const t = await criarToken(gerente)
    const r = await rpc(t.token, 'tools/list')
    expect(r.rpc.result.tools.length).toBeGreaterThan(0)
    expect(r.rpc.result.tools.filter((f: any) => !f.description)).toEqual([])
  })

  it('o agente de quem não participa não lê task de projeto privado', async () => {
    const tarefa = await novaTask(privado, 'gerente', { title: `Confidencial ${uid()}` })
    const t = await criarToken(an1)
    const ferramentas = (await rpc(t.token, 'tools/list')).rpc.result.tools as any[]

    const vazou: string[] = []
    for (const f of ferramentas) {
      const props = Object.keys(f.inputSchema?.properties ?? {})
      if (!props.some(p => /project|task/i.test(p))) continue
      const args: Record<string, string> = {}
      for (const p of props) {
        if (/project/i.test(p)) args[p] = privado.id
        else if (/task/i.test(p)) args[p] = tarefa.id
        else args[p] = 'x'
      }
      const r = await rpc(t.token, 'tools/call', { name: f.name, arguments: args })
      if (JSON.stringify(r.rpc).includes(tarefa.title)) vazou.push(f.name)
    }
    expect(vazou).toEqual([])
  })
})
