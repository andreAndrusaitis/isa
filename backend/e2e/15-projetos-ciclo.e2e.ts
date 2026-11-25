// Projetos de ponta a ponta: do projeto novo à task concluída, passando por
// quadro, sprint, dependência, histórico, exportação e numeração sob concorrência.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, login, U, uid } from './helpers'
import { adicionarMembro, ligarProjetos, novaTask, novoProjeto, type Projeto } from './integration-helpers'

let desligar: () => Promise<void>
let p: Projeto
let gerente: string

const dias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

beforeAll(async () => {
  desligar = await ligarProjetos('gerente', 'an1')
  gerente = await as('gerente')
  p = await novoProjeto('gerente')
})

afterAll(async () => { await desligar() })

describe('criação do projeto', () => {
  it('quem cria vira dono e o projeto já nasce com quadro e tipos', async () => {
    const membros = await http('GET', `${p.base}/members`, { token: gerente })
    expect(membros.status).toBe(200)
    const eu = (await login(U.gerente)).user.id
    expect(membros.body.data.find((m: any) => m.userId === eu)?.role).toBe('owner')

    expect(p.statuses.length).toBeGreaterThanOrEqual(3)
    expect(p.statuses.map((s: any) => s.category)).toEqual(expect.arrayContaining(['open', 'in_progress']))

    const tipos = await http('GET', `${p.base}/task-types`, { token: gerente })
    expect(tipos.body.data.length).toBeGreaterThan(0)
  })

  it('nome vazio é recusado e não cria nada', async () => {
    const r = await http('POST', '/api/projects', { token: gerente, body: { name: '' } })
    expect(r.status).toBe(400)
  })

  it('o projeto aparece na lista de quem participa', async () => {
    const r = await http('GET', '/api/projects', { token: gerente })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).toContain(p.id)
  })
})

describe('vida da task', () => {
  it('mudança de status fica no histórico com autor e valores', async () => {
    const t = await novaTask(p, 'gerente')
    const novo = p.statuses[1]
    const r = await http('PATCH', `${p.base}/tasks/${t.id}`, { token: gerente, body: { statusId: novo.id } })
    expect(r.status).toBe(200)
    expect(r.body.data.statusId).toBe(novo.id)

    const hist = await http('GET', `${p.base}/tasks/${t.id}/activity`, { token: gerente })
    const tipos = hist.body.data.map((a: any) => a.type)
    expect(tipos).toEqual(expect.arrayContaining(['created', 'status_changed']))
    const mudanca = hist.body.data.find((a: any) => a.type === 'status_changed')
    expect(mudanca.actor.id).toBe((await login(U.gerente)).user.id)
  })

  it('checklist e comentário gravam e voltam na leitura', async () => {
    const t = await novaTask(p, 'gerente')
    const item = await http('POST', `${p.base}/tasks/${t.id}/checklist`, { token: gerente, body: { text: 'Validar em QA' } })
    expect(item.status).toBe(201)
    const marcar = await http('PATCH', `${p.base}/tasks/${t.id}/checklist/${item.body.data.id}`, { token: gerente, body: { done: true } })
    expect(marcar.status).toBe(200)

    const c = await http('POST', `${p.base}/tasks/${t.id}/comments`, { token: gerente, body: { body: 'Primeiro comentário' } })
    expect(c.status).toBe(201)
    const lista = await http('GET', `${p.base}/tasks/${t.id}/comments`, { token: gerente })
    expect(JSON.stringify(lista.body)).toContain('Primeiro comentário')
  })

  it('só membro do projeto pode ser responsável pela task', async () => {
    const t = await novaTask(p, 'gerente')
    const fora = (await login(U.an3)).user.id
    const r = await http('PUT', `${p.base}/tasks/${t.id}/assignees`, { token: gerente, body: { userIds: [fora] } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })

  it('membro recebe a task e o painel "minhas tarefas" mostra para ele', async () => {
    const userId = await adicionarMembro(p, 'gerente', 'an1')
    const t = await novaTask(p, 'gerente', { assigneeId: userId })
    const minhas = await http('GET', '/api/my-tasks', { token: await as('an1') })
    expect(minhas.status).toBe(200)
    expect(JSON.stringify(minhas.body)).toContain(t.id)
  })

  it('task com dependência aberta avisa o bloqueio antes de concluir', async () => {
    const antes = await novaTask(p, 'gerente')
    const depois = await novaTask(p, 'gerente')
    const dep = await http('POST', `${p.base}/tasks/${depois.id}/dependencies`, {
      token: gerente,
      body: { dependsOnId: antes.id },
    })
    expect(dep.status, JSON.stringify(dep.body)).toBe(201)

    const check = await http('GET', `${p.base}/tasks/${depois.id}/completion-check`, { token: gerente })
    expect(check.status).toBe(200)
    expect(check.body.data.canComplete).toBe(false)
    expect(check.body.data.blockers.length).toBeGreaterThan(0)
  })

  it('dependência circular é recusada', async () => {
    const a = await novaTask(p, 'gerente')
    const b = await novaTask(p, 'gerente')
    const ida = await http('POST', `${p.base}/tasks/${a.id}/dependencies`, { token: gerente, body: { dependsOnId: b.id } })
    expect(ida.status).toBe(201)
    const volta = await http('POST', `${p.base}/tasks/${b.id}/dependencies`, { token: gerente, body: { dependsOnId: a.id } })
    expect(volta.status).toBeGreaterThanOrEqual(400)
    expect(volta.status).toBeLessThan(500)
  })

  it('concluir leva a task para um status de conclusão', async () => {
    const t = await novaTask(p, 'gerente')
    const r = await http('POST', `${p.base}/tasks/${t.id}/complete`, { token: gerente, body: {} })
    expect(r.status).toBe(200)
    expect(r.body.data.outcome).toBe('completed')

    const lida = await http('GET', `${p.base}/tasks/${t.id}`, { token: gerente })
    const status = p.statuses.find((s: any) => s.id === lida.body.data.statusId)
    expect(status.category).not.toBe('open')
    expect(status.category).not.toBe('in_progress')
  })

  it('task apagada é arquivada: sai da lista e mantém o histórico', async () => {
    const t = await novaTask(p, 'gerente')
    expect((await http('DELETE', `${p.base}/tasks/${t.id}`, { token: gerente })).status).toBeLessThan(300)

    const lista = await http('GET', `${p.base}/tasks`, { token: gerente })
    expect(JSON.stringify(lista.body)).not.toContain(t.id)

    const lida = await http('GET', `${p.base}/tasks/${t.id}`, { token: gerente })
    expect(lida.body.data.archivedAt).toBeTruthy()
    const hist = await http('GET', `${p.base}/tasks/${t.id}/activity`, { token: gerente })
    expect(hist.body.data.map((a: any) => a.type)).toContain('archived')
  })
})

describe('tags', () => {
  it('excluir a tag tira ela das tasks, fica no histórico e some da lista', async () => {
    const tag = await http('POST', `${p.base}/tags`, { token: gerente, body: { name: `Tag ${uid()}`, color: '#2563eb' } })
    expect(tag.status, JSON.stringify(tag.body)).toBe(201)
    const id = tag.body.data.id
    const t = await novaTask(p, 'gerente')
    expect((await http('POST', `${p.base}/tasks/${t.id}/tags/${id}`, { token: gerente })).status).toBe(201)

    const antes = await http('GET', `${p.base}/tags`, { token: gerente })
    expect(antes.body.data.find((x: any) => x.id === id)?.taskCount).toBe(1)

    const r = await http('DELETE', `${p.base}/tags/${id}`, { token: gerente })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.removedFrom).toBe(1)

    const depois = await http('GET', `${p.base}/tags`, { token: gerente })
    expect(depois.body.data.some((x: any) => x.id === id)).toBe(false)
    const task = await http('GET', `${p.base}/tasks/${t.id}`, { token: gerente })
    expect(task.body.data.tags ?? []).toEqual([])
    const hist = await http('GET', `${p.base}/tasks/${t.id}/activity`, { token: gerente })
    expect(JSON.stringify(hist.body.data)).toContain(tag.body.data.name)
  })

  it('tag de outro projeto não é encontrada', async () => {
    const outro = await novoProjeto('gerente')
    const tag = await http('POST', `${outro.base}/tags`, { token: gerente, body: { name: `Tag ${uid()}`, color: '#2563eb' } })
    const r = await http('DELETE', `${p.base}/tags/${tag.body.data.id}`, { token: gerente })
    expect(r.status).toBe(404)
    const lista = await http('GET', `${outro.base}/tags`, { token: gerente })
    expect(lista.body.data.some((x: any) => x.id === tag.body.data.id)).toBe(true)
  })
})

describe('sprint', () => {
  it('nasce, inicia, conclui e só um sprint fica ativo por vez', async () => {
    const s = await http('POST', `${p.base}/sprints`, {
      token: gerente,
      body: { name: `Sprint ${uid()}`, startDate: dias(0), endDate: dias(14) },
    })
    expect(s.status, JSON.stringify(s.body)).toBe(201)
    const id = s.body.data.id

    const t = await novaTask(p, 'gerente', { sprintId: id })
    expect(t.sprintId).toBe(id)

    expect((await http('POST', `${p.base}/sprints/${id}/start`, { token: gerente, body: {} })).status).toBe(200)
    const segundo = await http('POST', `${p.base}/sprints`, { token: gerente, body: { name: `Sprint ${uid()}` } })
    const conflito = await http('POST', `${p.base}/sprints/${segundo.body.data.id}/start`, { token: gerente, body: {} })
    expect(conflito.status).toBe(409)

    expect((await http('POST', `${p.base}/sprints/${id}/complete`, { token: gerente, body: {} })).status).toBe(200)
  })

  it('fim antes do início é recusado', async () => {
    const r = await http('POST', `${p.base}/sprints`, {
      token: gerente,
      body: { name: 'Invertida', startDate: dias(10), endDate: dias(1) },
    })
    expect(r.status).toBe(400)
  })
})

describe('numeração', () => {
  it('20 tasks criadas ao mesmo tempo ganham chaves únicas e sem buraco', async () => {
    const novo = await novoProjeto('gerente')
    const criadas = await Promise.all(Array.from({ length: 20 }, () => http('POST', `${novo.base}/tasks`, {
      token: gerente,
      body: { title: `Corrida ${uid()}`, statusId: novo.statuses[0].id },
    })))
    expect(criadas.map(r => r.status).filter(s => s !== 201)).toEqual([])

    const chaves = criadas.map(r => r.body.data.key as string)
    expect(new Set(chaves).size).toBe(20)
    const numeros = chaves.map(k => Number(k.split('-')[1])).sort((a, b) => a - b)
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })
})

describe('leituras do projeto', () => {
  it('painel, carga, linha do tempo e insights respondem com o projeto cheio', async () => {
    await novaTask(p, 'gerente', { dueDate: dias(3), storyPoints: 5 })
    for (const rota of ['dashboard', 'workload', 'timeline', 'insights']) {
      const r = await http('GET', `${p.base}/${rota}`, { token: gerente })
      expect(r.status, `${rota}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200)
    }
  })

  it('exportação devolve as tasks do projeto', async () => {
    const t = await novaTask(p, 'gerente', { title: `Exportável ${uid()}` })
    const r = await http('GET', `${p.base}/export`, { token: gerente })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).toContain(t.title)
  })
})
