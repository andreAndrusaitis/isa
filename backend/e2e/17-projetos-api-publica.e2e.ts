// API pública de Projetos (chave isaproj_): a integração externa de ponta a ponta,
// com escopo, alcance, idempotência, revogação e efeito visível no painel.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, uid } from './helpers'
import { ligarProjetos, novaTask, novoProjeto, recusado, type Projeto } from './integration-helpers'

const V1 = '/api/integrations/v1/projects'
const TODOS = ['read_projects', 'read_tasks', 'write_tasks', 'read_comments', 'write_comments']

let desligar: () => Promise<void>
let meu: Projeto
let outro: Projeto
let admin: string

async function chave(body: Record<string, unknown>) {
  const r = await http('POST', '/api/projects/api-keys', { token: admin, body: { name: `Chave ${uid()}`, ...body } })
  if (r.status !== 201) throw new Error(`chave → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.data as { id: string; key: string; serviceUserId: string }
}

const via = (key: string, method: string, path: string, body?: unknown) =>
  http(method, `${V1}${path}`, { body, headers: { authorization: `Bearer ${key}` } })

beforeAll(async () => {
  desligar = await ligarProjetos('gerente')
  admin = await as('admin')
  meu = await novoProjeto('gerente')
  outro = await novoProjeto('gerente', { privacy: 'private' })
})

afterAll(async () => { await desligar() })

describe('autenticação', () => {
  it('sem chave, chave inventada ou JWT da sessão: 401', async () => {
    expect((await http('GET', V1)).status).toBe(401)
    expect((await via('isaproj_inventada', 'GET', '')).status).toBe(401)
    expect((await http('GET', V1, { token: admin })).status).toBe(401)
  })

  it('a chave aparece uma vez só e a listagem não a devolve', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    expect(k.key).toMatch(/^isaproj_/)
    const lista = await http('GET', '/api/projects/api-keys', { token: admin })
    expect(JSON.stringify(lista.body)).not.toContain(k.key)
  })

  it('chave revogada para de funcionar na hora', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    expect((await via(k.key, 'GET', `/${meu.id}`)).status).toBe(200)
    expect((await http('DELETE', `/api/projects/api-keys/${k.id}`, { token: admin })).status).toBeLessThan(300)
    expect((await via(k.key, 'GET', `/${meu.id}`)).status).toBe(401)
  })

  it('regenerar invalida a chave antiga', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const nova = await http('POST', `/api/projects/api-keys/${k.id}/regenerate`, { token: admin, body: {} })
    expect(nova.status).toBeLessThan(300)
    expect((await via(k.key, 'GET', `/${meu.id}`)).status).toBe(401)
    expect((await via(nova.body.data.key, 'GET', `/${meu.id}`)).status).toBe(200)
  })

  it('usuário de serviço da chave não faz login', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const u = await http('GET', `/api/users/${k.serviceUserId}`, { token: admin })
    const r = await http('POST', '/api/auth/login', { body: { email: u.body?.data?.email ?? `${k.serviceUserId}@x.local`, password: 'qualquer' } })
    expect(r.status).toBe(401)
  })
})

describe('escopo e alcance', () => {
  it('chave só de leitura não escreve', async () => {
    const k = await chave({ scopes: ['read_projects', 'read_tasks'], projectIds: [meu.id] })
    expect((await via(k.key, 'GET', `/${meu.id}/tasks`)).status).toBe(200)
    const r = await via(k.key, 'POST', `/${meu.id}/tasks`, { title: 'Sem escopo', status_id: meu.statuses[0].id })
    expect(r.status).toBe(403)
  })

  it('chave sem read_comments não lê comentários', async () => {
    const t = await novaTask(meu, 'gerente')
    const k = await chave({ scopes: ['read_projects', 'read_tasks'], projectIds: [meu.id] })
    expect((await via(k.key, 'GET', `/${meu.id}/tasks/${t.id}/comments`)).status).toBe(403)
  })

  it('chave restrita a um projeto não alcança outro', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const t = await novaTask(outro, 'gerente')
    expect(recusado((await via(k.key, 'GET', `/${outro.id}`)).status)).toBe(true)
    expect(recusado((await via(k.key, 'GET', `/${outro.id}/tasks/${t.id}`)).status)).toBe(true)
    expect(recusado((await via(k.key, 'PATCH', `/${outro.id}/tasks/${t.id}`, { title: 'Invadido' })).status)).toBe(true)

    const lista = await via(k.key, 'GET', '')
    expect(JSON.stringify(lista.body)).not.toContain(outro.id)
  })

  it('task de outro projeto não abre pelo projeto da chave', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const t = await novaTask(outro, 'gerente')
    expect(recusado((await via(k.key, 'GET', `/${meu.id}/tasks/${t.id}`)).status)).toBe(true)
    expect(recusado((await via(k.key, 'PATCH', `/${meu.id}/tasks/${t.id}`, { title: 'Invadido' })).status)).toBe(true)
  })
})

describe('efeito no sistema', () => {
  it('task criada pela API aparece no painel, assinada pelo usuário de serviço', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const titulo = `Via API ${uid()}`
    const r = await via(k.key, 'POST', `/${meu.id}/tasks`, { title: titulo, status_id: meu.statuses[0].id })
    expect(r.status, JSON.stringify(r.body)).toBe(201)

    const lida = await http('GET', `${meu.base}/tasks/${r.body.data.id}`, { token: await as('gerente') })
    expect(lida.status).toBe(200)
    expect(lida.body.data.title).toBe(titulo)
    expect(lida.body.data.creatorId).toBe(k.serviceUserId)
  })

  it('o contrato da API é snake_case', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const r = await via(k.key, 'POST', `/${meu.id}/tasks`, { title: `Contrato ${uid()}`, status_id: meu.statuses[0].id })
    expect(Object.keys(r.body.data).filter(c => /[A-Z]/.test(c))).toEqual([])
    expect(r.body.data).toHaveProperty('status_id')
  })

  it('repetir o external_request_id devolve duplicate e não cria outra task', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const corpo = { title: `Idempotente ${uid()}`, status_id: meu.statuses[0].id, external_request_id: uid() }
    const primeira = await via(k.key, 'POST', `/${meu.id}/tasks`, corpo)
    expect(primeira.status, JSON.stringify(primeira.body)).toBe(201)

    const segunda = await via(k.key, 'POST', `/${meu.id}/tasks`, corpo)
    expect(segunda.status).toBe(200)
    expect(segunda.body.duplicate).toBe(true)
  })

  // A corrida é intermitente: uma rodada só quase sempre passa. A causa tem teste
  // determinístico em src/services/externalApi.idempotency.test.ts.
  it('o mesmo external_request_id em paralelo cria uma task só', async () => {
    const gerente = await as('gerente')
    const duplicados: string[] = []
    for (let i = 0; i < 20; i++) {
      const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
      const titulo = `Paralela ${uid()}`
      const corpo = { title: titulo, status_id: meu.statuses[0].id, external_request_id: uid() }
      const rs = await Promise.all(Array.from({ length: 8 }, () => via(k.key, 'POST', `/${meu.id}/tasks`, corpo)))
      expect(rs.filter(r => r.status >= 500).map(r => JSON.stringify(r.body))).toEqual([])

      const lista = await http('GET', `${meu.base}/tasks`, { token: gerente })
      const iguais = (lista.body.data as any[]).filter(t => t.title === titulo).length
      if (iguais !== 1) duplicados.push(`${titulo}: ${iguais} tasks`)
    }
    expect(duplicados).toEqual([])
  }, 180_000)

  it('payload inválido volta 400, não 500', async () => {
    const k = await chave({ scopes: TODOS, projectIds: [meu.id] })
    const r = await via(k.key, 'POST', `/${meu.id}/tasks`, { title: '' })
    expect(r.status).toBe(400)
  })
})
