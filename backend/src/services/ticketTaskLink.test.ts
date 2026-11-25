// Ponte chamado ↔ task. Prisma real:
// rodar contra banco de teste (DATABASE_URL + DIRECT_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { linkTicketToTask, unlinkTicketFromTask, listTaskTickets } from './ticketTaskLink'
import { updateTask, archiveTask } from './tasks'
import { loadFullTask } from './taskFull'
import { TicketService, redactForRequester } from './tickets'

const S = `ttl-${Date.now()}`
const created = { users: [] as string[], tickets: [] as string[], orgId: '', projectId: '' }
let agent = { sub: '', role: 'agent' }
let outsider = { sub: '', role: 'agent' }
let openStatusId = ''
let doneStatusId = ''
let seq = 0

async function newTask(withDue = true) {
  return prisma.task.create({
    data: { project_id: created.projectId, status_id: openStatusId, seq: ++seq, title: `Task ${seq}`, creator_id: agent.sub, due_date: withDue ? new Date(Date.now() + 5 * 86_400_000) : null },
  })
}

async function newTicket(status: 'open' | 'in_progress' | 'resolved' = 'in_progress') {
  const id = `TKT-${S}-${created.tickets.length}`
  await prisma.ticket.create({
    data: {
      id, display_number: `ISA-${S}-${created.tickets.length}`, title: 'Chamado ponte', description: 'x',
      user_id: agent.sub, org_id: created.orgId, assigned_to_id: agent.sub, queue: 'geral', status,
      sla_deadline: new Date(Date.now() + 8 * 3_600_000), first_response_deadline: new Date(Date.now() + 3_600_000),
    },
  })
  created.tickets.push(id)
  return id
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${S}`, tier: 'bronze' } })
  created.orgId = org.id
  const a = await prisma.user.create({ data: { name: 'Analista Ponte', email: `a-${S}@t.local`, role: 'agent', org_id: org.id, module_projects: true } })
  const o = await prisma.user.create({ data: { name: 'Fora', email: `o-${S}@t.local`, role: 'agent', module_projects: true } })
  created.users.push(a.id, o.id)
  agent = { sub: a.id, role: 'agent' }
  outsider = { sub: o.id, role: 'agent' }
  const project = await prisma.project.create({ data: { name: `Projeto ${S}`, owner_id: a.id, members: { create: { user_id: a.id, role: 'owner' } } } })
  created.projectId = project.id
  openStatusId = (await prisma.projectStatus.create({ data: { project_id: project.id, name: 'A Fazer', color: '#999', category: 'open', position: 0 } })).id
  doneStatusId = (await prisma.projectStatus.create({ data: { project_id: project.id, name: 'Concluído', color: '#0a0', category: 'done', position: 1 } })).id
})

afterAll(async () => {
  // Só o que este teste criou.
  await prisma.userOrgScope.deleteMany({ where: { user_id: { in: created.users } } })
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: created.tickets } } })
  await prisma.notification.deleteMany({ where: { ticket_id: { in: created.tickets } } })
  await prisma.ticket.deleteMany({ where: { id: { in: created.tickets } } })
  await prisma.project.deleteMany({ where: { id: created.projectId } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: created.users } } })
  await prisma.user.deleteMany({ where: { id: { in: created.users } } })
  await prisma.organization.deleteMany({ where: { id: created.orgId } })
})

describe('vincular chamado a task', () => {
  it('chamado vai para Pendente — Em projeto, SLA pausa e o histórico registra quem e o SLA restante', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)

    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t.status).toBe('pending')
    expect(t.pending_reason).toBe('pending_project')
    expect(t.project_task_id).toBe(task.id)
    expect(t.sla_paused_at).not.toBeNull()
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: ticketId, to_status: 'pending' }, orderBy: { created_at: 'desc' } })
    expect(ev.user_id).toBe(agent.sub)
    expect(ev.note).toMatch(/task #\d+/)
    expect(ev.note).toMatch(/SLA restante/)
  })

  it('aceita o número do chamado (display_number) e vários chamados na mesma task', async () => {
    const task = await newTask()
    const a = await newTicket()
    const b = await newTicket()
    const numB = (await prisma.ticket.findUniqueOrThrow({ where: { id: b } })).display_number
    await linkTicketToTask(created.projectId, task.id, a, agent)
    await linkTicketToTask(created.projectId, task.id, numB, agent)
    const list = await listTaskTickets(created.projectId, task.id)
    expect(list.map((t) => t.id).sort()).toEqual([a, b].sort())
  })

  it('exige prazo na task (senão o chamado ficaria sem prazo nenhum)', async () => {
    const task = await newTask(false)
    const ticketId = await newTicket()
    await expect(linkTicketToTask(created.projectId, task.id, ticketId, agent)).rejects.toMatchObject({ code: 'TASK_NEEDS_DUE_DATE' })
  })

  it('não vincula chamado resolvido', async () => {
    const task = await newTask()
    const ticketId = await newTicket('resolved')
    await expect(linkTicketToTask(created.projectId, task.id, ticketId, agent)).rejects.toMatchObject({ code: 'TICKET_NOT_ACTIVE' })
  })

  it('não vincula chamado já em outra task', async () => {
    const t1 = await newTask()
    const t2 = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, t1.id, ticketId, agent)
    await expect(linkTicketToTask(created.projectId, t2.id, ticketId, agent)).rejects.toMatchObject({ code: 'TICKET_ALREADY_LINKED' })
  })

  it('admin não vincula (só tem leitura sobre chamados)', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await expect(linkTicketToTask(created.projectId, task.id, ticketId, { sub: agent.sub, role: 'admin' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('não vincula chamado que o usuário não pode ver', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await expect(linkTicketToTask(created.projectId, task.id, ticketId, outsider)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('o que cada lado vê', () => {
  it('analista vê projeto e task; o solicitante só a previsão', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)
    const full: any = await TicketService.getTicketById(ticketId)
    expect(full.project_task).toMatchObject({ id: task.id, seq: task.seq, title: task.title, project: { name: expect.any(String) } })
    const forClient: any = redactForRequester(full)
    expect(forClient.project_task).toEqual({ due_date: task.due_date })
  })
})

describe('ciclo da task', () => {
  it('desvincular devolve o chamado ao atendimento e retoma o SLA', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)
    await unlinkTicketFromTask(created.projectId, task.id, ticketId, agent)
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t.status).toBe('in_progress')
    expect(t.sla_paused_at).toBeNull()
    expect(t.project_task_id).toBeNull()
  })

  it('task concluída resolve os chamados vinculados', async () => {
    const task = await newTask()
    const a = await newTicket()
    const b = await newTicket()
    await linkTicketToTask(created.projectId, task.id, a, agent)
    await linkTicketToTask(created.projectId, task.id, b, agent)
    await updateTask(task.id, agent.sub, { statusId: doneStatusId })
    for (const id of [a, b]) {
      const t = await prisma.ticket.findUniqueOrThrow({ where: { id } })
      expect(t.status).toBe('resolved')
      expect(t.resolution_details).toMatch(/task #\d+/)
    }
  })

  it('chamado tirado da pendência manualmente não é resolvido pela task', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'in_progress', pending_reason: null, sla_paused_at: null } })
    await updateTask(task.id, agent.sub, { statusId: doneStatusId })
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('in_progress')
  })

  it('task arquivada devolve os chamados ao atendimento', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)
    await archiveTask(task.id, agent.sub)
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t.status).toBe('in_progress')
    expect(t.project_task_id).toBeNull()
  })

  it('não deixa remover o prazo de task com chamado vinculado', async () => {
    const task = await newTask()
    const ticketId = await newTicket()
    await linkTicketToTask(created.projectId, task.id, ticketId, agent)
    await expect(updateTask(task.id, agent.sub, { dueDate: null })).rejects.toMatchObject({ code: 'TASK_HAS_LINKED_TICKETS' })
  })
})

describe('texto automático da resolução', () => {
  it('não leva título da task nem nome do projeto, e a nota continua no histórico', async () => {
    const task = await prisma.task.create({
      data: { project_id: created.projectId, status_id: openStatusId, seq: ++seq, key: `ACME-${seq}`, title: 'Migração ACME contrato', creator_id: agent.sub, due_date: new Date(Date.now() + 5 * 86_400_000) },
    })
    const id = await newTicket()
    await linkTicketToTask(created.projectId, task.id, id, agent)
    await updateTask(task.id, agent.sub, { statusId: doneStatusId })

    const t = await prisma.ticket.findUniqueOrThrow({ where: { id } })
    const event = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: id, to_status: 'resolved' } })
    for (const text of [t.resolution_details!, event.note!]) {
      expect(text).toBe(`Resolvido pela conclusão da task #${task.seq}.`)
      expect(text).not.toContain('ACME')
      expect(text).not.toContain(S)
    }
  })
})

describe('leitura dos chamados vinculados', () => {
  async function scopedUser(key: string, data: { module_tickets?: boolean } = {}) {
    const u = await prisma.user.create({ data: { name: key, email: `${key}-${S}@t.local`, role: 'supervisor', module_projects: true, ...data } })
    created.users.push(u.id)
    await prisma.userOrgScope.create({ data: { user_id: u.id, org_id: created.orgId } })
    return { sub: u.id, role: 'supervisor' }
  }

  it('fora da carteira: a lista mantém o formato, só com número e situação do vínculo', async () => {
    const task = await newTask()
    const id = await newTicket()
    await linkTicketToTask(created.projectId, task.id, id, agent)

    const [mine] = await listTaskTickets(created.projectId, task.id, agent)
    expect(mine).toMatchObject({ id, title: 'Chamado ponte', org: { name: `Org ${S}` } })
    expect(mine.sla_deadline).toBeTruthy()

    const [hidden] = await listTaskTickets(created.projectId, task.id, outsider)
    expect(Object.keys(hidden).sort()).toEqual(Object.keys(mine).sort())
    expect(hidden).toMatchObject({
      id, display_number: mine.display_number, status: 'pending', pending_reason: 'pending_project',
      title: 'Chamado restrito', sla_deadline: null, org: null,
    })
  })

  it('a carteira e o admin leem tudo; módulo Chamados desligado não lê pela carteira', async () => {
    const task = await newTask()
    await linkTicketToTask(created.projectId, task.id, await newTicket(), agent)

    expect((await listTaskTickets(created.projectId, task.id, await scopedUser('cart')))[0].title).toBe('Chamado ponte')
    expect((await listTaskTickets(created.projectId, task.id, { sub: outsider.sub, role: 'admin' }))[0].title).toBe('Chamado ponte')
    expect((await listTaskTickets(created.projectId, task.id, await scopedUser('sem-modulo', { module_tickets: false })))[0].title).toBe('Chamado restrito')
  })

  it('task completa: chamado na lixeira some e o título segue a carteira de quem lê', async () => {
    const task = await newTask()
    const kept = await newTicket()
    const trashed = await newTicket()
    await linkTicketToTask(created.projectId, task.id, kept, agent)
    await linkTicketToTask(created.projectId, task.id, trashed, agent)
    await prisma.ticket.update({ where: { id: trashed }, data: { deleted_at: new Date() } })

    const full = await loadFullTask(task.id)
    expect(full!.tickets.map((t) => t.id)).toEqual([kept])
    expect(full!.tickets[0].title).toBe('Chamado ponte')
    expect((await loadFullTask(task.id, agent))!.tickets[0].title).toBe('Chamado ponte')

    const forOutsider = (await loadFullTask(task.id, outsider))!.tickets[0]
    expect(forOutsider).toMatchObject({ id: kept, status: 'pending', title: 'Chamado restrito' })
    expect(Object.keys(forOutsider).sort()).toEqual(['display_number', 'id', 'status', 'title'])
  })
})
