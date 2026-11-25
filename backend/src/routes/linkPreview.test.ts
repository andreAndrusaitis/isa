// Prévia de link (/api/link-preview) com prisma mockado: nada toca o banco.
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORTAL_URL: 'https://portal.example.org',
    LINK_PREVIEW_ALLOWED_HOSTS: 'portal.example.org,.example.com',
  },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import linkPreviewRoutes from './linkPreview'
import { allowedHost, parseOriginalUri } from '../services/linkPreview'

const app = express()
app.use('/api/link-preview', linkPreviewRoutes)

const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER = '33333333-3333-4333-8333-333333333333'
const TASK = '22222222-2222-4222-8222-222222222222'
const FRONT = 'portal.example.org'

const task = (over: Record<string, unknown> = {}) => ({
  key: 'BUG-12', seq: 7, title: 'Corrigir login', archived_at: null, project_id: PROJECT,
  description: 'SEGREDO-DA-DESCRICAO',
  project: { name: 'Portal Cliente', archived_at: null },
  status: { name: 'Em andamento' },
  assignee: { name: 'Maria Souza' },
  multi_assignees: [],
  ...over,
})

// host null = sem X-Forwarded-Host.
function preview(uri: string | undefined, host: string | null = 'isa.example.com') {
  const r = request(app).get('/api/link-preview')
  if (uri !== undefined) r.set('X-Original-URI', uri)
  if (host !== null) r.set('X-Forwarded-Host', host)
  return r
}

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1]

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.task.findUnique.mockResolvedValue(null)
  prismaMock.project.findUnique.mockResolvedValue(null)
})

describe('GET /api/link-preview', () => {
  it('task válida: código, título, projeto e status, sem o nome de ninguém', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task())
    const res = await preview(`/projetos/${PROJECT}/tasks?view=list&task=${TASK}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(meta(res.text, 'og:title')).toBe('BUG-12 · Corrigir login')
    expect(meta(res.text, 'og:description')).toBe('Portal Cliente · Em andamento')
    expect(meta(res.text, 'og:site_name')).toBe('ISA')
    expect(meta(res.text, 'og:url')).toBe(`https://isa.example.com/projetos/${PROJECT}/tasks?view=list&amp;task=${TASK}`)
    expect(meta(res.text, 'og:image')).toBe('https://isa.example.com/og-image.png')
    expect(meta(res.text, 'twitter:card')).toBe('summary_large_image')
    expect(res.text).toContain(`<meta http-equiv="refresh" content="0; url=https://isa.example.com/projetos/${PROJECT}/tasks?view=list&amp;task=${TASK}">`)
    // Só busca campos permitidos: a descrição nem é pedida ao banco.
    const select = prismaMock.task.findUnique.mock.calls[0][0].select
    expect(select.description).toBeUndefined()
    expect(select.comments).toBeUndefined()
  })

  it('descrição da task nunca aparece, mesmo se o banco devolver', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task())
    const res = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(res.text).not.toContain('SEGREDO-DA-DESCRICAO')
  })

  it('sem chave por tipo: usa #seq', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce(task({ assignee: null, key: null }))
    let res = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(meta(res.text, 'og:title')).toBe('#7 · Corrigir login')
    expect(meta(res.text, 'og:description')).toBe('Portal Cliente · Em andamento')

    prismaMock.task.findUnique.mockResolvedValueOnce(task({ assignee: null, multi_assignees: [{ user: { name: 'João' } }] }))
    res = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(meta(res.text, 'og:description')).toBe('Portal Cliente · Em andamento')
  })

  it('aceita task + taskProject fora da página do projeto', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task())
    const res = await preview(`/projetos/minhas-tarefas?task=${TASK}&taskProject=${PROJECT}`)
    expect(meta(res.text, 'og:title')).toBe('BUG-12 · Corrigir login')
  })

  it('task de outro projeto (caminho ou taskProject), arquivada ou de projeto arquivado: genérico', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task())
    for (const uri of [`/projetos/${OTHER}/tasks?task=${TASK}`, `/projetos/minhas-tarefas?task=${TASK}&taskProject=${OTHER}`]) {
      expect(meta((await preview(uri)).text, 'og:title')).toBe('ISA')
    }
    prismaMock.task.findUnique.mockResolvedValue(task({ archived_at: new Date() }))
    expect(meta((await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)).text, 'og:title')).toBe('ISA')
    prismaMock.task.findUnique.mockResolvedValue(task({ project: { name: 'X', archived_at: new Date() } }))
    expect(meta((await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)).text, 'og:title')).toBe('ISA')
  })

  it('link só de projeto: nome do projeto', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Portal Cliente', archived_at: null })
    const res = await preview(`/projetos/${PROJECT}/board`)
    expect(meta(res.text, 'og:title')).toBe('Portal Cliente')
    expect(meta(res.text, 'og:description')).toBe('Projeto no ISA')
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('id inválido ou inexistente: genérico, 200, sem consultar com lixo', async () => {
    const generic = async (uri: string | undefined) => {
      const res = await preview(uri)
      expect(res.status).toBe(200)
      expect(meta(res.text, 'og:title')).toBe('ISA')
      expect(meta(res.text, 'og:description')).toMatch(/Service desk/)
      return res
    }
    await generic(`/projetos/abc/tasks?task=not-a-uuid`)
    await generic(`/projetos/${PROJECT}'--/tasks`)
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.project.findUnique).not.toHaveBeenCalled()
    await generic(`/projetos/${PROJECT}/tasks?task=${TASK}`) // inexistente (mock devolve null)
    await generic(undefined)
    const other = await generic('/chamados/123')
    expect(meta(other.text, 'og:url')).toBe('https://isa.example.com/')
  })

  it('erro no banco: genérico, sem detalhe e sem cache', async () => {
    prismaMock.task.findUnique.mockRejectedValue(new Error('connection refused db-host:5432'))
    const res = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(meta(res.text, 'og:title')).toBe('ISA')
    expect(res.text).not.toContain('db-host')
  })

  it('XSS no título e no nome do projeto sai escapado', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task({
      title: '"><script>alert(1)</script>',
      project: { name: "<img src=x onerror='x'>", archived_at: null },
    }))
    const res = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(res.text).not.toContain('<script>')
    expect(res.text).not.toContain('<img')
    expect(meta(res.text, 'og:title')).toBe('BUG-12 · &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('XSS na URI original não quebra os atributos', async () => {
    const res = await preview(`/projetos/${PROJECT}/tasks?x="><script>alert(1)</script>`)
    expect(res.text).not.toContain('<script>')
    expect(res.text).not.toMatch(/content="[^"]*"[^>]*><script/)
  })

  it('host fora da lista (ou ausente) vira o host padrão do front', async () => {
    for (const host of ['evil.com', 'example.com.evil.com', 'evil-example.com', 'x"><y', null]) {
      const res = await preview(`/projetos/${PROJECT}/tasks`, host)
      expect(meta(res.text, 'og:url')).toBe(`https://${FRONT}/projetos/${PROJECT}/tasks`)
      expect(meta(res.text, 'og:image')).toBe(`https://${FRONT}/og-image.png`)
    }
    const ok = await preview(`/projetos/${PROJECT}/tasks`, FRONT.toUpperCase())
    expect(meta(ok.text, 'og:image')).toBe(`https://${FRONT}/og-image.png`)
  })
})

describe('allowedHost / parseOriginalUri', () => {
  it('sufixo .example.com e host exato da lista', () => {
    expect(allowedHost('isa.example.com')).toBe('isa.example.com')
    expect(allowedHost('example.com')).toBe('example.com')
    expect(allowedHost(FRONT)).toBe(FRONT)
    expect(allowedHost('isa.example.com, evil.com')).toBe('isa.example.com')
    expect(allowedHost('isa.example.com:8443')).toBe(FRONT)
  })

  it('caminho fora de /projetos ou com // e ..: raiz, sem ids', () => {
    for (const raw of ['//evil.com/projetos/x', '/projetos/../chamados', 'https://evil.com/projetos/a', '/api/x']) {
      expect(parseOriginalUri(raw)).toEqual({ path: '/', pathProjectId: null, taskId: null, taskProjectId: null })
    }
    expect(parseOriginalUri(`/projetos/${PROJECT.toUpperCase()}/tasks?task=${TASK}`)).toMatchObject({ pathProjectId: PROJECT, taskId: TASK })
  })
})

// Por último: o contador do limite é do módulo e afetaria os testes acima.
describe('limite de requisições', () => {
  it('ao estourar devolve a prévia genérica (200, sem cache), sem consultar o banco', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task())
    let last = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    for (let i = 0; i < 130 && last.headers['cache-control'] !== 'no-store'; i++) {
      last = await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    }
    expect(last.status).toBe(200)
    expect(last.headers['cache-control']).toBe('no-store')
    expect(meta(last.text, 'og:title')).toBe('ISA')
    const calls = prismaMock.task.findUnique.mock.calls.length
    await preview(`/projetos/${PROJECT}/tasks?task=${TASK}`)
    expect(prismaMock.task.findUnique.mock.calls.length).toBe(calls)
  })
})
