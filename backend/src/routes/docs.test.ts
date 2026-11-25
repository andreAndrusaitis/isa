// Documentos pela API, no banco de teste: quem vê o quê, árvore, lixeira, versões, busca e anexos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import * as Y from 'yjs'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { buildDocState, docFromState, encodeDoc, extractText, replaceContent } from '../services/docContent'
import { mutateDoc } from '../realtime/docs'
import { purgeExpiredDocPages } from '../services/docTrash'

const S = Date.now()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const NOPE = '00000000-0000-4000-8000-00000000ffff'

type Who = 'admin' | 'dona' | 'editora' | 'leitor' | 'fora' | 'semModulo' | 'cliente' | 'herda' | 'gerente'
const u = {} as Record<Who, string>
const tokens = {} as Record<Who, string>

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
const api = (who: Who, method: Method, path: string, body?: object) =>
  request(app)[method](`/api/docs${path}`).set('Authorization', `Bearer ${tokens[who]}`).send(body)

async function newSpace(who: Who, extra: object = {}): Promise<string> {
  const r = await api(who, 'post', '/spaces', { name: `Espaço ${S} ${Math.random()}`, ...extra })
  expect(r.status).toBe(201)
  return r.body.data.id
}
async function newPage(who: Who, spaceId: string, extra: object = {}): Promise<string> {
  const r = await api(who, 'post', `/spaces/${spaceId}/pages`, extra)
  expect(r.status).toBe(201)
  return r.body.data.id
}
const write = (pageId: string, text: string, userId = u.dona) => {
  const src = docFromState(buildDocState([{ type: 'paragraph', content: [{ type: 'text', text }] }]))
  return mutateDoc(pageId, userId, 1000, doc => replaceContent(doc, src))
}

let space = ''
let page = ''
let otherSpace = ''
let otherPage = ''

beforeAll(async () => {
  const mk = async (who: Who, data: object = {}) => {
    const row = await prisma.user.create({ data: { name: `${who} ${S}`, email: `${who}-${S}@docs.test`, role: 'agent', module_documents: true, ...data } })
    u[who] = row.id
    tokens[who] = jwt.sign({ sub: row.id, role: row.role, email: row.email }, env.JWT_SECRET, { expiresIn: '30m' })
  }
  await mk('admin', { role: 'admin', module_documents: null })
  await mk('gerente', { role: 'manager' })
  for (const w of ['dona', 'editora', 'leitor', 'fora'] as const) await mk(w)
  await mk('semModulo', { module_documents: false })
  await mk('herda', { name: `her_da ${S}`, module_documents: null, manager_id: u.gerente })
  await mk('cliente', { role: 'user' })

  space = await newSpace('dona')
  expect((await api('dona', 'put', `/spaces/${space}/members/${u.editora}`, { role: 'editor' })).status).toBe(200)
  expect((await api('dona', 'put', `/spaces/${space}/members/${u.leitor}`, { role: 'viewer' })).status).toBe(200)
  page = await newPage('dona', space, { title: 'Página principal' })
  otherSpace = await newSpace('fora')
  otherPage = await newPage('fora', otherSpace, { title: 'De outro espaço' })
})

afterAll(async () => {
  const ids = Object.values(u)
  await prisma.docSpace.deleteMany({ where: { created_by_id: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('módulo', () => {
  it('anônimo 401; sem módulo e cliente final 403; herdado e admin entram', async () => {
    expect((await request(app).get('/api/docs/access')).status).toBe(401)
    expect((await api('semModulo', 'get', '/access')).status).toBe(403)
    expect((await api('cliente', 'get', '/access')).status).toBe(403)
    expect((await api('herda', 'get', '/access')).body).toEqual({ data: { ok: true } })
    expect((await api('admin', 'get', '/access')).status).toBe(200)
  })

  it('a sessão traz o módulo, a capacidade e a tela inicial', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens.dona}`)
    expect(r.status).toBe(200)
    const user = r.body.data?.user ?? r.body.data
    expect(user.modules.documents).toBe(true)
    expect(user.capabilities).toContain('documents.use')
  })

  it('pessoas: só quem tem o módulo; busca literal', async () => {
    const r = await api('dona', 'get', `/people?q=${S}`)
    const ids = r.body.data.map((p: any) => p.id)
    expect(ids).toEqual(expect.arrayContaining([u.editora, u.herda, u.admin]))
    expect(ids).not.toContain(u.semModulo)
    expect(ids).not.toContain(u.cliente)
    expect(Object.keys(r.body.data[0]).sort()).toEqual(['avatar', 'email', 'id', 'name'])
    expect((await api('dona', 'get', '/people?q=%25%25%25')).body.data).toEqual([])
    expect((await api('dona', 'get', '/people?q=her_da')).body.data.map((p: any) => p.id)).toContain(u.herda)
    expect((await api('dona', 'get', '/people?q=h_r_da')).body.data).toEqual([])
  })
})

describe('espaços e membros', () => {
  it('cada papel enxerga o seu; quem está fora não vê que existe', async () => {
    for (const [who, role] of [['dona', 'owner'], ['editora', 'editor'], ['leitor', 'viewer'], ['admin', 'owner']] as const) {
      expect((await api(who, 'get', `/spaces/${space}`)).body.data.role).toBe(role)
    }
    expect((await api('fora', 'get', `/spaces/${space}`)).status).toBe(404)
    expect((await api('fora', 'get', '/spaces')).body.data.map((s: any) => s.id)).not.toContain(space)
    expect((await api('leitor', 'get', '/spaces')).body.data.map((s: any) => s.id)).toContain(space)
  })

  it('valida nome, cor e visibilidade', async () => {
    for (const body of [{}, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 'a', color: 'red' }, { name: 'a', visibility: 'public' }, { name: 'a', icon: 'x'.repeat(17) }]) {
      expect((await api('dona', 'post', '/spaces', body)).status).toBe(400)
    }
  })

  it('interno: todos com o módulo leem, só membro edita', async () => {
    const id = await newSpace('dona', { visibility: 'internal' })
    const p = await newPage('dona', id)
    expect((await api('fora', 'get', `/spaces/${id}`)).body.data.role).toBe('viewer')
    expect((await api('fora', 'get', `/pages/${p}`)).body.data.role).toBe('viewer')
    expect((await api('fora', 'post', `/spaces/${id}/pages`, {})).status).toBe(403)
    expect((await api('fora', 'patch', `/pages/${p}`, { title: 'x' })).status).toBe(403)
    await api('dona', 'patch', `/spaces/${id}`, { visibility: 'private' })
    expect((await api('fora', 'get', `/pages/${p}`)).status).toBe(404)
  })

  it('só o dono gere espaço e membros', async () => {
    for (const who of ['editora', 'leitor'] as const) {
      expect((await api(who, 'patch', `/spaces/${space}`, { name: 'Invadido' })).status).toBe(403)
      expect((await api(who, 'delete', `/spaces/${space}`)).status).toBe(403)
      expect((await api(who, 'put', `/spaces/${space}/members/${u[who]}`, { role: 'owner' })).status).toBe(403)
      expect((await api(who, 'delete', `/spaces/${space}/members/${u.dona}`)).status).toBe(403)
    }
    expect((await api('fora', 'put', `/spaces/${space}/members/${u.fora}`, { role: 'owner' })).status).toBe(404)
    expect((await api('fora', 'get', `/spaces/${space}/members`)).status).toBe(404)
  })

  it('só entra quem tem o módulo', async () => {
    for (const who of ['semModulo', 'cliente'] as const) {
      const r = await api('dona', 'put', `/spaces/${space}/members/${u[who]}`, { role: 'viewer' })
      expect([r.status, r.body.code]).toEqual([400, 'USER_WITHOUT_MODULE'])
    }
    expect((await api('dona', 'put', `/spaces/${space}/members/${NOPE}`, { role: 'viewer' })).status).toBe(404)
  })

  it('o último dono não sai nem é rebaixado; com outro dono, pode', async () => {
    const id = await newSpace('dona')
    expect((await api('dona', 'delete', `/spaces/${id}/members/${u.dona}`)).body.code).toBe('LAST_OWNER')
    const r = await api('dona', 'put', `/spaces/${id}/members/${u.dona}`, { role: 'viewer' })
    expect([r.status, r.body.code]).toEqual([409, 'LAST_OWNER'])
    await api('dona', 'put', `/spaces/${id}/members/${u.editora}`, { role: 'owner' })
    expect((await api('dona', 'delete', `/spaces/${id}/members/${u.dona}`)).status).toBe(204)
    expect((await api('dona', 'get', `/spaces/${id}`)).status).toBe(404)
  })

  it('dois donos saindo ao mesmo tempo: sobra um', async () => {
    const id = await newSpace('dona')
    await api('dona', 'put', `/spaces/${id}/members/${u.editora}`, { role: 'owner' })
    const rs = await Promise.all([api('dona', 'delete', `/spaces/${id}/members/${u.dona}`), api('editora', 'delete', `/spaces/${id}/members/${u.editora}`)])
    expect(rs.map(r => r.status).sort()).toEqual([204, 409])
  })

  it('arquivado fecha para todos, e o dono desarquiva', async () => {
    const id = await newSpace('dona')
    const p = await newPage('dona', id)
    await api('dona', 'put', `/spaces/${id}/members/${u.leitor}`, { role: 'viewer' })
    expect((await api('dona', 'delete', `/spaces/${id}`)).status).toBe(204)
    expect((await api('dona', 'get', `/pages/${p}`)).status).toBe(404)
    expect((await api('dona', 'get', `/spaces/${id}/pages`)).status).toBe(404)
    expect((await api('leitor', 'get', `/spaces/${id}`)).status).toBe(404)
    expect((await api('dona', 'get', '/spaces')).body.data.map((s: any) => s.id)).not.toContain(id)
    expect((await api('dona', 'get', '/spaces?archived=true')).body.data.map((s: any) => s.id)).toContain(id)
    expect((await api('leitor', 'get', '/spaces?archived=true')).body.data.map((s: any) => s.id)).not.toContain(id)
    expect((await api('dona', 'patch', `/spaces/${id}`, { archived: false })).body.data.archivedAt).toBeNull()
    expect((await api('leitor', 'get', `/pages/${p}`)).status).toBe(200)
  })
})

describe('IDOR: nenhuma rota de página abre por quem está fora', () => {
  it('lê, escreve e apaga: tudo 404', async () => {
    const v = (await api('dona', 'post', `/pages/${page}/versions`, { label: 'v' })).body.data.id
    const a = (await api('dona', 'post', `/pages/${page}/attachments`, { filename: 'a.png', dataUri: PNG })).body.data.id
    const tries: [Method, string, object?][] = [
      ['get', `/pages/${page}`], ['patch', `/pages/${page}`, { title: 'x' }], ['delete', `/pages/${page}`],
      ['post', `/pages/${page}/move`, { parentId: null }], ['post', `/pages/${page}/duplicate`], ['post', `/pages/${page}/restore`],
      ['delete', `/pages/${page}/permanent`], ['put', `/pages/${page}/favorite`], ['delete', `/pages/${page}/favorite`],
      ['get', `/pages/${page}/versions`], ['post', `/pages/${page}/versions`, {}], ['get', `/versions/${v}/ydoc`],
      ['post', `/pages/${page}/versions/${v}/restore`], ['post', `/pages/${page}/attachments`, { filename: 'a.png', dataUri: PNG }],
      ['get', `/attachments/${a}`], ['get', `/spaces/${space}/pages`], ['post', `/spaces/${space}/pages`, {}],
    ]
    const leaks: string[] = []
    for (const [m, path, body] of tries) {
      const r = await api('fora', m, path, body)
      if (r.status !== 404) leaks.push(`${m} ${path} → ${r.status}`)
    }
    expect(leaks).toEqual([])
  })

  it('leitor lê e não escreve nada', async () => {
    const v = (await api('dona', 'get', `/pages/${page}/versions`)).body.data[0].id
    for (const path of [`/pages/${page}`, `/pages/${page}/versions`, `/spaces/${space}/pages`, `/spaces/${space}/members`]) {
      expect((await api('leitor', 'get', path)).status).toBe(200)
    }
    const writes: [Method, string, object?][] = [
      ['patch', `/pages/${page}`, { title: 'x' }], ['delete', `/pages/${page}`], ['post', `/pages/${page}/move`, {}], ['post', `/pages/${page}/duplicate`],
      ['post', `/pages/${page}/versions`, {}], ['post', `/pages/${page}/versions/${v}/restore`],
      ['post', `/pages/${page}/attachments`, { filename: 'a.png', dataUri: PNG }], ['post', `/spaces/${space}/pages`, {}],
    ]
    for (const [m, path, body] of writes) expect([path, (await api('leitor', m, path, body)).status]).toEqual([path, 403])
  })

  it('id de versão de outra página não restaura por aqui', async () => {
    const v = (await api('fora', 'post', `/pages/${otherPage}/versions`, {})).body.data.id
    expect((await api('dona', 'post', `/pages/${page}/versions/${v}/restore`)).status).toBe(404)
  })

  it('id malformado é 404, nunca 500', async () => {
    for (const path of ['/pages/x', '/spaces/..%00', '/versions/1/ydoc', "/attachments/'%20or%201=1"]) {
      expect((await api('admin', 'get', path)).status).toBe(404)
    }
  })
})

describe('árvore', () => {
  it('cria, aninha, ordena e monta o caminho', async () => {
    const s = await newSpace('dona')
    const a = await newPage('dona', s, { title: 'A', icon: '📄' })
    const b = await newPage('dona', s, { title: 'B', parentId: a })
    const c = await newPage('dona', s, { parentId: b })
    const tree = (await api('dona', 'get', `/spaces/${s}/pages`)).body.data
    expect(tree.map((p: any) => [p.id, p.parentId])).toEqual(expect.arrayContaining([[a, null], [b, a], [c, b]]))
    expect(Object.keys(tree[0]).sort()).toEqual(['favorite', 'icon', 'id', 'parentId', 'position', 'title', 'updatedAt'])
    const one = (await api('dona', 'get', `/pages/${c}`)).body.data
    expect(one.title).toBe('Sem título')
    expect(one.breadcrumb).toEqual([{ id: a, title: 'A', icon: '📄' }, { id: b, title: 'B', icon: null }])
    expect(one.space.id).toBe(s)
  })

  it('pai de outro espaço ou da lixeira é recusado', async () => {
    expect((await api('dona', 'post', `/spaces/${space}/pages`, { parentId: otherPage })).body.code).toBe('INVALID_PARENT')
    const dead = await newPage('dona', space)
    await api('dona', 'delete', `/pages/${dead}`)
    expect((await api('dona', 'post', `/spaces/${space}/pages`, { parentId: dead })).body.code).toBe('INVALID_PARENT')
  })

  it('não cria ciclo, nem com duas mudanças simultâneas', async () => {
    const s = await newSpace('dona')
    const a = await newPage('dona', s)
    const b = await newPage('dona', s, { parentId: a })
    const c = await newPage('dona', s, { parentId: b })
    for (const target of [a, b, c]) expect((await api('dona', 'post', `/pages/${a}/move`, { parentId: target })).body.code).toBe('PAGE_CYCLE')
    const x = await newPage('dona', s)
    const y = await newPage('dona', s)
    const rs = await Promise.all([api('dona', 'post', `/pages/${x}/move`, { parentId: y }), api('dona', 'post', `/pages/${y}/move`, { parentId: x })])
    expect(rs.map(r => r.status).sort()).toEqual([200, 400])
  })

  it('posição entre irmãs, e renumera quando o intervalo acaba', async () => {
    const s = await newSpace('dona')
    const ids = [await newPage('dona', s, { position: 1 }), await newPage('dona', s, { position: 1.0000001 }), await newPage('dona', s, { position: 5 })]
    await api('dona', 'post', `/pages/${ids[2]}/move`, { parentId: null, position: 1.00000005 })
    const tree = (await api('dona', 'get', `/spaces/${s}/pages`)).body.data
    expect(tree.map((p: any) => p.id)).toEqual([ids[0], ids[2], ids[1]])
    expect(tree.map((p: any) => p.position)).toEqual([1, 2, 3])
  })

  it('mudar de espaço exige edição nos dois e leva filhas e anexos', async () => {
    const to = await newSpace('dona')
    const a = await newPage('dona', space, { title: 'Muda' })
    const b = await newPage('dona', space, { parentId: a })
    const att = (await api('dona', 'post', `/pages/${b}/attachments`, { filename: 'f.png', dataUri: PNG })).body.data.id

    expect((await api('dona', 'post', `/pages/${a}/move`, { spaceId: otherSpace })).status).toBe(404) // destino alheio
    expect((await api('editora', 'post', `/pages/${a}/move`, { spaceId: to })).status).toBe(404)
    expect((await api('dona', 'post', `/pages/${a}/move`, { spaceId: to, parentId: page })).body.code).toBe('INVALID_PARENT')
    await api('dona', 'put', `/spaces/${to}/members/${u.editora}`, { role: 'viewer' })
    expect((await api('editora', 'post', `/pages/${a}/move`, { spaceId: to })).status).toBe(403)

    expect((await api('leitor', 'get', `/attachments/${att}`)).status).toBe(200)
    const r = await api('dona', 'post', `/pages/${a}/move`, { spaceId: to })
    expect(r.body.data).toMatchObject({ spaceId: to, parentId: null })
    expect((await api('dona', 'get', `/pages/${b}`)).body.data).toMatchObject({ spaceId: to, parentId: a })
    for (const path of [`/pages/${a}`, `/pages/${b}`, `/attachments/${att}`]) expect((await api('leitor', 'get', path)).status).toBe(404)
    expect((await prisma.docAttachment.findUniqueOrThrow({ where: { id: att } })).space_id).toBe(to)
  })

  it('duplica a página com o conteúdo e anexos próprios, sem as filhas', async () => {
    const a = await newPage('dona', space, { title: 'Original' })
    await newPage('dona', space, { parentId: a })
    const att = (await api('dona', 'post', `/pages/${a}/attachments`, { filename: 'f.png', dataUri: PNG })).body.data.id
    const src = buildDocState([{ type: 'paragraph', content: [{ type: 'text', text: 'conteúdo copiado' }] }, { type: 'image', attrs: { attachmentId: att, alt: 'foto' } }])
    await mutateDoc(a, u.dona, 1000, (doc) => { Y.applyUpdate(doc, src); return src })
    const copy = (await api('editora', 'post', `/pages/${a}/duplicate`)).body.data
    expect(copy.title).toBe('Original (cópia)')
    const row = await prisma.docPage.findUniqueOrThrow({ where: { id: copy.id }, include: { attachments: true, children: true } })
    expect(row.content_text).toContain('conteúdo copiado')
    expect(row.children).toEqual([])
    expect(row.attachments).toHaveLength(1)
    const state = Buffer.from(row.ydoc!).toString('latin1')
    expect(state).toContain(row.attachments[0].id)
    const image = docFromState(row.ydoc).getXmlFragment('default').toArray().find(n => (n as Y.XmlElement).nodeName === 'image') as Y.XmlElement
    expect(image.getAttribute('attachmentId')).toBe(row.attachments[0].id)
  })

  it('título vazio volta ao padrão; controles e tamanho são tratados', async () => {
    const p = await newPage('dona', space, { title: 'A\u0000B' })
    expect((await api('dona', 'get', `/pages/${p}`)).body.data.title).toBe('AB')
    expect((await api('dona', 'patch', `/pages/${p}`, { title: '  ' })).body.data.title).toBe('Sem título')
    expect((await api('dona', 'patch', `/pages/${p}`, { title: 'x'.repeat(201) })).status).toBe(400)
  })
})

describe('lixeira', () => {
  it('leva a subárvore, some da árvore e volta inteira', async () => {
    const a = await newPage('dona', space, { title: 'Raiz' })
    const b = await newPage('dona', space, { parentId: a })
    const before = await newPage('dona', space, { parentId: a })
    await api('dona', 'delete', `/pages/${before}`) // excluída antes: não volta junto
    expect((await api('editora', 'delete', `/pages/${a}`)).status).toBe(204)
    for (const id of [a, b]) expect((await api('dona', 'get', `/pages/${id}`)).status).toBe(404)
    expect((await api('dona', 'patch', `/pages/${a}`, { title: 'x' })).status).toBe(404)

    const trash = (await api('editora', 'get', '/trash')).body.data
    expect(trash.find((t: any) => t.id === a)).toMatchObject({ childCount: 1, deletedBy: { id: u.editora } })
    expect(Math.abs(Date.now() - new Date(trash.find((t: any) => t.id === a).deletedAt).getTime())).toBeLessThan(60_000)
    expect(trash.map((t: any) => t.id)).not.toContain(b)
    expect((await api('leitor', 'get', '/trash')).body.data.map((t: any) => t.id)).not.toContain(a)
    expect((await api('leitor', 'post', `/pages/${a}/restore`)).status).toBe(403)

    expect((await api('editora', 'post', `/pages/${a}/restore`)).status).toBe(200)
    expect((await api('dona', 'get', `/pages/${b}`)).body.data.parentId).toBe(a)
    expect((await api('dona', 'get', `/pages/${before}`)).status).toBe(404)
  })

  it('volta para a raiz quando a página de cima se foi', async () => {
    const a = await newPage('dona', space)
    const b = await newPage('dona', space, { parentId: a })
    await api('dona', 'delete', `/pages/${b}`)
    await api('dona', 'delete', `/pages/${a}`)
    expect((await api('dona', 'post', `/pages/${b}/restore`)).body.data.parentId).toBeNull()
  })

  it('apagar de vez é só do dono, só da lixeira, e leva as filhas', async () => {
    const a = await newPage('dona', space)
    const b = await newPage('dona', space, { parentId: a })
    expect((await api('dona', 'delete', `/pages/${a}/permanent`)).status).toBe(404)
    await api('dona', 'delete', `/pages/${a}`)
    expect((await api('editora', 'delete', `/pages/${a}/permanent`)).status).toBe(403)
    expect((await api('dona', 'delete', `/pages/${a}/permanent`)).status).toBe(204)
    expect(await prisma.docPage.count({ where: { id: { in: [a, b] } } })).toBe(0)
  })

  it('a limpeza diária respeita a retenção', async () => {
    const old = await newPage('dona', space)
    const recent = await newPage('dona', space)
    for (const p of [old, recent]) await api('dona', 'delete', `/pages/${p}`)
    await prisma.docPage.update({ where: { id: old }, data: { deleted_at: new Date(Date.now() - 400 * 86_400_000) } })
    await purgeExpiredDocPages()
    expect(await prisma.docPage.count({ where: { id: old } })).toBe(0)
    expect(await prisma.docPage.count({ where: { id: recent } })).toBe(1)
  })
})

describe('versões', () => {
  it('salva com nome, devolve o binário e restaura (com cópia de segurança)', async () => {
    const p = await newPage('dona', space, { title: 'Versionada' })
    await write(p, 'primeira versão')
    const v = (await api('editora', 'post', `/pages/${p}/versions`, { label: 'Fechada' })).body.data
    expect(v).toMatchObject({ label: 'Fechada', title: 'Versionada', createdBy: { id: u.editora } })
    await write(p, 'segunda versão')

    const bin = await api('leitor', 'get', `/versions/${v.id}/ydoc`).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = []
      res.on('data', (d: Buffer) => parts.push(d))
      res.on('end', () => cb(null, Buffer.concat(parts)))
    })
    expect(bin.headers['content-type']).toBe('application/octet-stream')
    expect(extractText(docFromState(bin.body))).toBe('primeira versão')

    const r = await api('editora', 'post', `/pages/${p}/versions/${v.id}/restore`)
    expect(r.status).toBe(200)
    expect((await prisma.docPage.findUniqueOrThrow({ where: { id: p } })).content_text).toBe('primeira versão')
    const list = (await api('leitor', 'get', `/pages/${p}/versions`)).body.data
    expect(list[0]).toMatchObject({ id: r.body.data.backupVersionId, label: 'Antes de restaurar' })
    const backup = await prisma.docPageVersion.findUniqueOrThrow({ where: { id: list[0].id } })
    expect(extractText(docFromState(backup.ydoc))).toBe('segunda versão')
  })

  it('guarda só as 100 últimas', async () => {
    const p = await newPage('dona', space)
    const ydoc = encodeDoc(new Y.Doc())
    await prisma.docPageVersion.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ page_id: p, title: `v${i}`, ydoc, created_at: new Date(Date.now() - (200 - i) * 1000) })) })
    await api('dona', 'post', `/pages/${p}/versions`, { label: 'nova' })
    expect(await prisma.docPageVersion.count({ where: { page_id: p } })).toBe(100)
    expect((await api('dona', 'get', `/pages/${p}/versions`)).body.data[0].label).toBe('nova')
  })
})

describe('busca, recentes e favoritos', () => {
  it('acha no título e no texto, só onde a pessoa entra, sem curinga', async () => {
    const word = `Zebrinha${S}`
    const mine = await newPage('dona', space, { title: `${word} no título` })
    const text = await newPage('dona', space, { title: 'Pelo texto' })
    await write(text, `bla bla 100% ${word} e mais`)
    const hidden = await newPage('fora', otherSpace, { title: `${word} secreto` })
    const r = (await api('leitor', 'get', `/search?q=${word.toLowerCase()}`)).body.data
    expect(r.map((p: any) => p.id)).toEqual([mine, text])
    expect(r[1].snippet).toContain(word)
    expect(r[1].space.id).toBe(space)
    expect((await api('fora', 'get', `/search?q=${word}`)).body.data.map((p: any) => p.id)).toEqual([hidden])
    expect((await api('herda', 'get', `/search?q=${word}`)).body.data).toEqual([])
    expect((await api('leitor', 'get', `/search?q=${encodeURIComponent(`%${word}`)}`)).body.data).toEqual([])
    expect((await api('leitor', 'get', `/search?q=${encodeURIComponent(`100% ${word}`)}`)).body.data.map((p: any) => p.id)).toEqual([text])
    for (const q of ['', 'a', '\\', "'; drop table x"]) expect((await api('leitor', 'get', `/search?q=${encodeURIComponent(q)}`)).status).toBe(200)
    await api('dona', 'delete', `/pages/${mine}`)
    expect((await api('leitor', 'get', `/search?q=${word}`)).body.data.map((p: any) => p.id)).toEqual([text])
  })

  it('recentes e favoritos somem quando o acesso acaba', async () => {
    const s = await newSpace('dona')
    const p = await newPage('dona', s, { title: 'Favorita' })
    await api('dona', 'put', `/spaces/${s}/members/${u.leitor}`, { role: 'viewer' })
    expect((await api('leitor', 'put', `/pages/${p}/favorite`)).body.data).toEqual({ favorite: true })
    await api('leitor', 'put', `/pages/${p}/favorite`)
    expect((await api('leitor', 'get', '/favorites')).body.data.map((x: any) => x.id)).toContain(p)
    expect((await api('leitor', 'get', '/recent')).body.data.map((x: any) => x.id)).toContain(p)
    expect((await api('leitor', 'get', `/spaces/${s}/pages`)).body.data[0].favorite).toBe(true)
    expect((await api('dona', 'get', `/spaces/${s}/pages`)).body.data[0].favorite).toBe(false)
    await api('dona', 'delete', `/spaces/${s}/members/${u.leitor}`)
    for (const path of ['/favorites', '/recent']) expect((await api('leitor', 'get', path)).body.data.map((x: any) => x.id)).not.toContain(p)
  })
})

describe('anexos', () => {
  it('aceita a lista permitida e devolve um endereço que a tela abre', async () => {
    const r = await api('editora', 'post', `/pages/${page}/attachments`, { filename: '..\\a/b.png', dataUri: PNG })
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ mime: 'image/png', filename: '.._a_b.png', pageId: page })
    const got = (await api('leitor', 'get', `/attachments/${r.body.data.id}`)).body.data
    expect(got.url).toBe(PNG)
    expect(got).not.toHaveProperty('storageKey')
  })

  it('deduz o tipo pela extensão quando o navegador não informa', async () => {
    const r = await api('dona', 'post', `/pages/${page}/attachments`, { filename: 'dados.csv', dataUri: 'data:application/octet-stream;base64,YSxi' })
    expect(r.body.data.mime).toBe('text/csv')
  })

  it.each([
    ['a.svg', 'data:image/svg+xml;base64,PHN2Zy8+'], ['a.html', 'data:text/html;base64,PGI+'], ['a.svg', 'data:application/octet-stream;base64,PHN2Zy8+'],
    ['a.exe', 'data:application/x-msdownload;base64,TVo='], ['a.json', 'data:application/json;base64,e30='], ['a.png', 'https://fora.example/x.png'],
    ['a.png', 'docs/outro/2026/01/x.png'], ['a.png', 'data:image/png;base64,'], ['a.png', 'data:image/png;base64,<script>'], ['', PNG],
  ])('recusa %s %s', async (filename, dataUri) => {
    expect((await api('dona', 'post', `/pages/${page}/attachments`, { filename, dataUri })).status).toBe(400)
  })

  it('acima de 10 MB responde 413', async () => {
    const dataUri = `data:application/pdf;base64,${Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64')}`
    expect((await api('dona', 'post', `/pages/${page}/attachments`, { filename: 'a.pdf', dataUri })).status).toBe(413)
  })
})

describe('nada de binário em JSON', () => {
  it('nenhuma resposta traz ydoc nem content_text', async () => {
    await write(page, 'texto só do editor')
    await api('dona', 'post', `/pages/${page}/versions`, {})
    const paths = ['/spaces', `/spaces/${space}`, `/spaces/${space}/pages`, `/pages/${page}`, `/pages/${page}/versions`, '/recent', '/favorites', '/trash', '/search?q=texto']
    for (const path of paths) {
      const body = JSON.stringify((await api('dona', 'get', path)).body)
      expect(body, path).not.toMatch(/"ydoc"|contentText|content_text|"Buffer"|_/)
    }
    const writes = [await api('dona', 'post', `/pages/${page}/duplicate`), await api('dona', 'patch', `/pages/${page}`, { title: 'T' }), await api('dona', 'post', `/pages/${page}/move`, {})]
    for (const r of writes) expect(JSON.stringify(r.body)).not.toMatch(/"ydoc"|contentText|"Buffer"/)
  })
})
