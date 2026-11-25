// Quem entra em quê no módulo de Projetos: módulo desligado, privacidade, papéis
// do projeto e IDOR entre projetos (id válido de um projeto usado em outro).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, login, U, uid } from './helpers'
import { adicionarMembro, ligarProjetos, novaTask, novoProjeto, recusado, type Projeto } from './integration-helpers'

let desligar: () => Promise<void>
let privado: Projeto
let alheio: Projeto
let gerente: string
let tm: string

beforeAll(async () => {
  desligar = await ligarProjetos('gerente', 'tm', 'an1', 'an2')
  gerente = await as('gerente')
  tm = await as('tm')
  privado = await novoProjeto('gerente', { privacy: 'private' })
  alheio = await novoProjeto('tm', { privacy: 'private' })
})

afterAll(async () => { await desligar() })

describe('módulo', () => {
  it('cliente nunca usa Projetos, mesmo sendo convidado', async () => {
    const cliente = await as('acme1')
    expect((await http('GET', '/api/projects', { token: cliente })).status).toBe(403)
    expect((await http('GET', `${privado.base}/tasks`, { token: cliente })).status).toBe(403)

    const userId = (await login(U.acme1)).user.id
    const convite = await http('POST', `${privado.base}/members`, { token: gerente, body: { userId, role: 'member' } })
    expect(convite.status).toBeGreaterThanOrEqual(400)
    expect(convite.status).toBeLessThan(500)
  })

  it('equipe sem o módulo ligado não entra', async () => {
    // Sem valor próprio o analista herda do gerente, que aqui está ligado.
    const admin = await as('admin')
    const id = (await login(U.an3)).user.id
    expect((await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_projects: false } })).status).toBe(200)
    const r = await http('GET', '/api/projects', { token: await as('an3') })
    await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_projects: null } })
    expect(r.status).toBe(403)
  })
})

describe('projeto privado', () => {
  it('quem não participa não vê na lista nem pelo id', async () => {
    const an1 = await as('an1')
    const lista = await http('GET', '/api/projects', { token: an1 })
    expect(JSON.stringify(lista.body)).not.toContain(privado.id)
    expect(recusado((await http('GET', privado.base, { token: an1 })).status)).toBe(true)
  })

  it('quem não participa não lê nem escreve em nenhuma rota de dentro', async () => {
    const t = await novaTask(privado, 'gerente')
    const an1 = await as('an1')
    const tentativas: [string, string, unknown?][] = [
      ['GET', `${privado.base}/tasks`],
      ['GET', `${privado.base}/tasks/${t.id}`],
      ['GET', `${privado.base}/tasks/${t.id}/comments`],
      ['GET', `${privado.base}/tasks/${t.id}/activity`],
      ['GET', `${privado.base}/members`],
      ['GET', `${privado.base}/export`],
      ['GET', `${privado.base}/dashboard`],
      ['POST', `${privado.base}/tasks`, { title: 'Invasão', statusId: privado.statuses[0].id }],
      ['PATCH', `${privado.base}/tasks/${t.id}`, { title: 'Invadido' }],
      ['POST', `${privado.base}/tasks/${t.id}/comments`, { body: 'Invasão' }],
      ['DELETE', `${privado.base}/tasks/${t.id}`],
      ['DELETE', privado.base],
    ]
    const vazou: string[] = []
    for (const [metodo, rota, body] of tentativas) {
      const r = await http(metodo, rota, { token: an1, body })
      if (!recusado(r.status)) vazou.push(`${metodo} ${rota} → ${r.status}`)
    }
    expect(vazou).toEqual([])
    expect((await http('GET', `${privado.base}/tasks/${t.id}`, { token: gerente })).body.data.title).toBe(t.title)
  })

  it('anexos e documentos do projeto também ficam fechados', async () => {
    const an1 = await as('an1')
    expect(recusado((await http('GET', `${privado.base}/docs`, { token: an1 })).status)).toBe(true)
    expect(recusado((await http('GET', `${privado.base}/files`, { token: an1 })).status)).toBe(true)
  })
})

describe('papéis do projeto', () => {
  let p: Projeto
  let viewerId: string

  beforeAll(async () => {
    p = await novoProjeto('gerente', { privacy: 'private' })
    viewerId = await adicionarMembro(p, 'gerente', 'an1', 'viewer')
    await adicionarMembro(p, 'gerente', 'an2', 'member')
  })

  it('leitor lê e não escreve', async () => {
    const t = await novaTask(p, 'gerente')
    const an1 = await as('an1')
    expect((await http('GET', `${p.base}/tasks/${t.id}`, { token: an1 })).status).toBe(200)

    const escritas: [string, string, unknown?][] = [
      ['POST', `${p.base}/tasks`, { title: 'Leitor', statusId: p.statuses[0].id }],
      ['PATCH', `${p.base}/tasks/${t.id}`, { title: 'Leitor mudou' }],
      ['DELETE', `${p.base}/tasks/${t.id}`],
      ['POST', `${p.base}/statuses`, { name: 'Leitor', color: '#000000', category: 'open' }],
    ]
    for (const [metodo, rota, body] of escritas) {
      const r = await http(metodo, rota, { token: an1, body })
      expect(r.status, `${metodo} ${rota}`).toBe(403)
    }
  })

  it('membro escreve task mas não muda a estrutura do projeto', async () => {
    const an2 = await as('an2')
    const criada = await http('POST', `${p.base}/tasks`, { token: an2, body: { title: 'Do membro', statusId: p.statuses[0].id } })
    expect(criada.status).toBe(201)

    expect((await http('PATCH', p.base, { token: an2, body: { name: 'Renomeado' } })).status).toBe(403)
    expect((await http('DELETE', p.base, { token: an2 })).status).toBe(403)
    expect((await http('POST', `${p.base}/members`, { token: an2, body: { userId: viewerId, role: 'manager' } })).status).toBe(403)
  })

  it('leitor não se promove nem tira o dono', async () => {
    const an1 = await as('an1')
    expect((await http('PATCH', `${p.base}/members/${viewerId}`, { token: an1, body: { role: 'owner' } })).status).toBe(403)
    const dono = (await login(U.gerente)).user.id
    expect((await http('DELETE', `${p.base}/members/${dono}`, { token: an1 })).status).toBe(403)
  })

  it('quem sai do projeto perde o acesso na hora', async () => {
    const q = await novoProjeto('gerente', { privacy: 'private' })
    const id = await adicionarMembro(q, 'gerente', 'an2')
    const an2 = await as('an2')
    expect((await http('GET', `${q.base}/tasks`, { token: an2 })).status).toBe(200)

    const saiu = await http('DELETE', `${q.base}/members/${id}`, { token: gerente })
    expect(saiu.status).toBeLessThan(300)
    expect(recusado((await http('GET', `${q.base}/tasks`, { token: an2 })).status)).toBe(true)
  })
})

describe('IDOR entre projetos', () => {
  it('task de outro projeto não abre pelo projeto em que eu participo', async () => {
    const dele = await novaTask(alheio, 'tm')
    const meu = await novoProjeto('gerente')
    const rotas = ['', '/comments', '/activity', '/checklist', '/assignees', '/watchers', '/tickets', '/relations']
    const vazou: string[] = []
    for (const r of rotas) {
      const res = await http('GET', `${meu.base}/tasks/${dele.id}${r}`, { token: gerente })
      if (res.status === 200) vazou.push(`GET tasks/:id${r}`)
    }
    expect(vazou).toEqual([])
  })

  it('não altera nem apaga task alheia pelo próprio projeto', async () => {
    const dele = await novaTask(alheio, 'tm')
    const meu = await novoProjeto('gerente')
    expect((await http('PATCH', `${meu.base}/tasks/${dele.id}`, { token: gerente, body: { title: 'Sequestrada' } })).status).toBe(404)
    expect((await http('DELETE', `${meu.base}/tasks/${dele.id}`, { token: gerente })).status).toBe(404)
    expect((await http('GET', `${alheio.base}/tasks/${dele.id}`, { token: tm })).body.data.title).toBe(dele.title)
  })

  it('não usa status, sprint ou task de outro projeto como referência', async () => {
    const meu = await novoProjeto('gerente')
    const statusAlheio = await http('POST', `${meu.base}/tasks`, {
      token: gerente,
      body: { title: `Ref ${uid()}`, statusId: alheio.statuses[0].id },
    })
    expect(statusAlheio.status).toBeGreaterThanOrEqual(400)
    expect(statusAlheio.status).toBeLessThan(500)

    const dele = await novaTask(alheio, 'tm')
    const minha = await novaTask(meu, 'gerente')
    const dep = await http('POST', `${meu.base}/tasks/${minha.id}/dependencies`, {
      token: gerente,
      body: { dependsOnId: dele.id },
    })
    expect(dep.status).toBeGreaterThanOrEqual(400)
    expect(dep.status).toBeLessThan(500)

    const filha = await http('POST', `${meu.base}/tasks`, {
      token: gerente,
      body: { title: `Filha ${uid()}`, statusId: meu.statuses[0].id, parentId: dele.id },
    })
    expect(filha.status).toBe(400)
  })

  it('busca global não devolve task de projeto privado alheio', async () => {
    const titulo = `Segredo ${uid()}`
    await novaTask(privado, 'gerente', { title: titulo })
    const r = await http('GET', `/api/projects/search?q=${encodeURIComponent(titulo)}`, { token: await as('an1') })
    expect(r.status).toBeLessThan(500)
    expect(JSON.stringify(r.body)).not.toContain(titulo)
  })

  it('gerente enxerga o projeto da equipe, mas só como leitor', async () => {
    const t = await novaTask(alheio, 'tm') // tm responde ao gerente
    expect((await http('GET', `${alheio.base}/tasks/${t.id}`, { token: gerente })).status).toBe(200)
    expect((await http('PATCH', `${alheio.base}/tasks/${t.id}`, { token: gerente, body: { title: 'Gerente mudou' } })).status).toBe(403)
  })
})
