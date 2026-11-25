// Ponte chamado ↔ task: os dois módulos juntos. O ponto sensível é a carteira:
// Projetos não tem empresa, então a ponte não pode virar atalho para ler ou mexer
// em chamado de outro cliente.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, openTicket } from './helpers'
import { adicionarMembro, ligarProjetos, novaTask, novoProjeto, recusado, type Projeto } from './integration-helpers'

let desligar: () => Promise<void>
let p: Projeto
let an1: string
let admin: string

const numero = (t: any) => t.id as string
const prazo = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
// Chamado vinculado segue o prazo da task: sem prazo o vínculo é recusado.
const taskComPrazo = (titulo?: string) => novaTask(p, 'gerente', { dueDate: prazo(), ...(titulo ? { title: titulo } : {}) })
const tipoDaTask = async () => (await http('GET', `${p.base}/task-types`, { token: an1 })).body.data[0].id as string

beforeAll(async () => {
  desligar = await ligarProjetos('gerente', 'an1')
  admin = await as('admin')
  an1 = await as('an1')
  p = await novoProjeto('gerente')
  await adicionarMembro(p, 'gerente', 'an1')
})

afterAll(async () => { await desligar() })

describe('vínculo', () => {
  it('task sem prazo não aceita chamado', async () => {
    const chamado = await openTicket('acme1')
    const t = await novaTask(p, 'gerente')
    const r = await http('POST', `${p.base}/tasks/${t.id}/tickets`, { token: an1, body: { ticket: numero(chamado) } })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('TASK_NEEDS_DUE_DATE')
  })

  it('analista vincula chamado da carteira e a task lista o chamado', async () => {
    const chamado = await openTicket('acme1')
    const t = await taskComPrazo()
    const r = await http('POST', `${p.base}/tasks/${t.id}/tickets`, { token: an1, body: { ticket: numero(chamado) } })
    expect(r.status, JSON.stringify(r.body)).toBe(201)

    const lista = await http('GET', `${p.base}/tasks/${t.id}/tickets`, { token: an1 })
    expect(JSON.stringify(lista.body)).toContain(chamado.id)
  })

  it('analista não vincula chamado de empresa fora da carteira', async () => {
    const chamado = await openTicket('initech1') // an1 só atende ACME
    const t = await taskComPrazo()
    const r = await http('POST', `${p.base}/tasks/${t.id}/tickets`, { token: an1, body: { ticket: numero(chamado) } })
    expect(recusado(r.status)).toBe(true)
    const lista = await http('GET', `${p.base}/tasks/${t.id}/tickets`, { token: admin })
    expect(JSON.stringify(lista.body)).not.toContain(chamado.id)
  })

  it('vínculo em lote devolve quem falhou sem vazar dados do chamado alheio', async () => {
    const meu = await openTicket('acme1')
    const alheio = await openTicket('initech1')
    const t = await taskComPrazo()
    const r = await http('POST', `${p.base}/tasks/${t.id}/tickets/bulk`, {
      token: an1,
      body: { tickets: [numero(meu), numero(alheio)] },
    })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body.data.tickets)).toContain(meu.id)
    expect(JSON.stringify(r.body.data.tickets)).not.toContain(alheio.id)
    expect(JSON.stringify(r.body)).not.toContain(alheio.title)
  })

  it('desvincular devolve o chamado à vida normal', async () => {
    const chamado = await openTicket('acme1')
    const t = await taskComPrazo()
    await http('POST', `${p.base}/tasks/${t.id}/tickets`, { token: an1, body: { ticket: numero(chamado) } })
    const fora = await http('DELETE', `${p.base}/tasks/${t.id}/tickets/${chamado.id}`, { token: an1 })
    expect(fora.status).toBeLessThan(300)
    const lista = await http('GET', `${p.base}/tasks/${t.id}/tickets`, { token: an1 })
    expect(JSON.stringify(lista.body)).not.toContain(chamado.id)
  })
})

describe('task a partir do chamado', () => {
  it('cria a task já vinculada', async () => {
    const chamado = await openTicket('acme1')
    const r = await http('POST', `${p.base}/tasks/from-ticket`, {
      token: an1,
      body: { ticket: numero(chamado), taskTypeId: await tipoDaTask(), dueDate: prazo() },
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const lista = await http('GET', `${p.base}/tasks/${r.body.data.task.id}/tickets`, { token: an1 })
    expect(JSON.stringify(lista.body)).toContain(chamado.id)
  })

  it('não cria task a partir de chamado fora da carteira', async () => {
    const chamado = await openTicket('initech1')
    const r = await http('POST', `${p.base}/tasks/from-ticket`, {
      token: an1,
      body: { ticket: numero(chamado), taskTypeId: await tipoDaTask(), dueDate: prazo() },
    })
    expect(recusado(r.status)).toBe(true)
    expect(JSON.stringify(r.body)).not.toContain(chamado.title)
  })
})

describe('o outro lado', () => {
  it('cliente que abriu o chamado não enxerga dados internos do projeto', async () => {
    const chamado = await openTicket('acme1')
    const t = await taskComPrazo('Nome interno do projeto')
    await http('POST', `${p.base}/tasks/${t.id}/tickets`, { token: an1, body: { ticket: numero(chamado) } })

    const visto = await http('GET', `/api/tickets/${chamado.id}`, { token: await as('acme1') })
    expect(visto.status).toBe(200)
    expect(JSON.stringify(visto.body)).not.toContain('Nome interno do projeto')
  })
})
