// Modais de detalhe e histórico da task. Prisma real contra o banco descartável;
// cleanup restrito aos IDs daqui.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { createProject } from '../services/projects'

const S = `drill-${Date.now()}`
const DAY = 86_400_000
const userIds: string[] = []
const projectIds: string[] = []
let manager: string, analyst: string, otherManager: string, otherAnalyst: string, outsider: string
let projA: string, projB: string, projHidden: string
let doing: string, doneStatus: string, openStatus: string
let overdueTask: string, runningTask: string, doneTask: string, hiddenTask: string
let seq = 0

async function user(prefix: string, role: 'agent' | 'manager', managerId?: string) {
  const u = await prisma.user.create({ data: { name: `${prefix} ${S}`, email: `${prefix}-${S}@t.local`, role, module_projects: true, manager_id: managerId ?? null } })
  userIds.push(u.id)
  return u.id
}
async function project(owner: string, name: string) {
  const p = await createProject(owner, { name: `${name} ${S}`, privacy: 'organization' })
  projectIds.push(p.id)
  return p.id
}
const statusOf = async (projectId: string, category: 'open' | 'in_progress' | 'done') =>
  (await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category } })).id
async function task(projectId: string, statusId: string, assignee: string | null, due?: Date) {
  const t = await prisma.task.create({ data: { project_id: projectId, status_id: statusId, assignee_id: assignee, creator_id: manager, seq: ++seq, title: `t${seq} ${S}`, due_date: due ?? null } })
  return t.id
}
const auth = (sub: string, role: string) => `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
const asManager = () => auth(manager, 'manager')
const asAnalyst = () => auth(analyst, 'agent')

beforeAll(async () => {
  manager = await user('gerente', 'manager')
  analyst = await user('analista', 'agent', manager)
  otherManager = await user('outrogerente', 'manager')
  otherAnalyst = await user('outroanalista', 'agent', otherManager)
  outsider = await user('fora', 'agent')

  projA = await project(manager, 'A')
  projB = await project(manager, 'B')
  projHidden = await project(otherManager, 'Oculto')
  await prisma.projectMember.create({ data: { project_id: projA, user_id: analyst, role: 'member' } })
  await prisma.projectMember.create({ data: { project_id: projA, user_id: otherAnalyst, role: 'member' } })
  await prisma.projectMember.create({ data: { project_id: projHidden, user_id: analyst, role: 'member' } })

  openStatus = await statusOf(projA, 'open')
  doing = await statusOf(projA, 'in_progress')
  doneStatus = await statusOf(projA, 'done')

  overdueTask = await task(projA, openStatus, analyst, new Date(Date.now() - 5 * DAY))
  runningTask = await task(projA, doing, analyst, new Date(Date.now() + 3 * DAY))
  doneTask = await task(projA, doneStatus, analyst)
  await task(projA, openStatus, otherAnalyst, new Date(Date.now() - 2 * DAY))
  await prisma.taskActivity.create({ data: { task_id: runningTask, actor_id: analyst, type: 'status_changed', from_value: openStatus, to_value: doing, created_at: new Date(Date.now() - 2 * DAY) } })
  await prisma.taskActivity.create({ data: { task_id: doneTask, actor_id: analyst, type: 'status_changed', from_value: openStatus, to_value: doing, created_at: new Date(Date.now() - 4 * DAY) } })
  await prisma.taskActivity.create({ data: { task_id: doneTask, actor_id: analyst, type: 'status_changed', from_value: doing, to_value: doneStatus, created_at: new Date(Date.now() - DAY) } })

  hiddenTask = await task(projHidden, await statusOf(projHidden, 'open'), analyst)
}, 60_000)

afterAll(async () => {
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: { in: projectIds } } } })
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
})

describe('modal do projeto', () => {
  it('traz os mesmos números da tabela e separa atrasadas, andamento e pessoas', async () => {
    const res = await request(app).get(`/api/projects/${projA}/drill`).set('Authorization', asManager())
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.totals).toMatchObject({ total: 4, open: 3, done: 1, overdue: 2, running: 1 })
    expect(d.overdue.map((t: { taskId: string }) => t.taskId)).toContain(overdueTask)
    expect(d.running[0]).toMatchObject({ taskId: runningTask, running: true })
    expect(d.people.find((p: { userId: string }) => p.userId === analyst)).toMatchObject({ open: 2, overdue: 1, running: 1, done: 1 })
    expect(d.weekly).toHaveLength(8)
    expect(d.weekly.reduce((n: number, w: { completed: number }) => n + w.completed, 0)).toBe(1)
  })

  it('quem não vê o projeto recebe 404, sem saber que ele existe', async () => {
    const res = await request(app).get(`/api/projects/${projA}/drill`).set('Authorization', auth(outsider, 'agent'))
    expect(res.status).toBe(404)
  })
})

describe('lista de tasks por trás de um número', () => {
  it('atrasadas do portfólio batem com o KPI do dashboard global', async () => {
    const [list, kpi] = await Promise.all([
      request(app).get('/api/projects/drill/tasks?kind=overdue').set('Authorization', asManager()),
      request(app).get('/api/projects/dashboard-global').set('Authorization', asManager()),
    ])
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(kpi.body.data.overdueCount)
  })

  it('não entra projeto que o gerente não enxerga', async () => {
    const res = await request(app).get('/api/projects/drill/tasks?kind=all').set('Authorization', asManager())
    // O analista da equipe é membro do "Oculto", então o gerente enxerga o projeto (leitura); o de fora, não.
    const other = await request(app).get('/api/projects/drill/tasks?kind=all').set('Authorization', auth(otherManager, 'manager'))
    expect(res.body.data.tasks.map((t: { taskId: string }) => t.taskId)).toContain(hiddenTask)
    expect(other.body.data.tasks.every((t: { projectId: string }) => t.projectId !== projB)).toBe(true)
  })

  it('pessoa de fora da equipe vem marcada para não abrir', async () => {
    const res = await request(app).get('/api/projects/drill/tasks?kind=overdue').set('Authorization', asManager())
    const by = res.body.data.byAssignee as Array<{ userId: string; canOpen: boolean }>
    expect(by.find((p) => p.userId === analyst)?.canOpen).toBe(true)
    expect(by.find((p) => p.userId === otherAnalyst)?.canOpen).toBe(false)
  })

  it('analista sem liberação não abre o portfólio, mas abre o projeto dele', async () => {
    expect((await request(app).get('/api/projects/drill/tasks?kind=open').set('Authorization', asAnalyst())).status).toBe(403)
    const own = await request(app).get(`/api/projects/drill/tasks?kind=open&projectId=${projA}`).set('Authorization', asAnalyst())
    expect(own.status).toBe(200)
    expect(own.body.data.total).toBe(3)
  })

  it('projeto que a pessoa não vê: 404 mesmo passando o id', async () => {
    const res = await request(app).get(`/api/projects/drill/tasks?projectId=${projA}`).set('Authorization', auth(outsider, 'agent'))
    expect(res.status).toBe(404)
  })

  it('filtra por etapa e por status do projeto', async () => {
    const byCategory = await request(app).get(`/api/projects/drill/tasks?projectId=${projA}&categories=in_progress`).set('Authorization', asManager())
    expect(byCategory.body.data.total).toBe(1)
    const byStatus = await request(app).get(`/api/projects/drill/tasks?projectId=${projA}&statusId=${doneStatus}`).set('Authorization', asManager())
    expect(byStatus.body.data.tasks[0].taskId).toBe(doneTask)
  })
})

describe('modal da pessoa', () => {
  it('gerente vê quem é da equipe, só nos projetos que ele enxerga', async () => {
    const res = await request(app).get(`/api/projects/drill/people/${analyst}`).set('Authorization', asManager())
    expect(res.status).toBe(200)
    expect(res.body.data.totals).toMatchObject({ open: 3, overdue: 1, running: 1, done: 1 })
    expect(res.body.data.byProject.map((p: { projectId: string }) => p.projectId).sort()).toEqual([projA, projHidden].sort())
  })

  it('gerente não abre analista de outro gerente pelo portfólio', async () => {
    const res = await request(app).get(`/api/projects/drill/people/${otherAnalyst}`).set('Authorization', asManager())
    expect(res.status).toBe(403)
    expect(res.body.code ?? res.body.error?.code).toBe('PERSON_OUT_OF_TEAM')
  })

  it('dentro de um projeto, abre quem trabalha nele e só com os dados dele', async () => {
    const res = await request(app).get(`/api/projects/drill/people/${otherAnalyst}?projectId=${projA}`).set('Authorization', asManager())
    expect(res.status).toBe(200)
    expect(res.body.data.scopedTo).toContain('A ')
    expect(res.body.data.byProject.map((p: { projectId: string }) => p.projectId)).toEqual([projA])
  })

  it('com projectId, quem não tem relação com o projeto não abre: 404, sem nome nem cargo', async () => {
    const res = await request(app).get(`/api/projects/drill/people/${outsider}?projectId=${projA}`).set('Authorization', asAnalyst())
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain(S)
  })

  it('com projectId, ex-responsável fora do projeto continua abrindo (o tempo por pessoa mostra ele)', async () => {
    const former = await user('exresponsavel', 'agent')
    await prisma.taskActivity.create({ data: { task_id: doneTask, actor_id: manager, type: 'assignee_changed', from_value: former, to_value: analyst } })
    const res = await request(app).get(`/api/projects/drill/people/${former}?projectId=${projA}`).set('Authorization', asAnalyst())
    expect(res.status).toBe(200)
    expect(res.body.data.person.id).toBe(former)
  })

  it('com projectId, quem se abre não precisa de vínculo com tasks', async () => {
    expect((await request(app).get(`/api/projects/drill/people/${manager}?projectId=${projB}`).set('Authorization', asManager())).status).toBe(200)
  })

  it('o próprio analista se abre sem liberação; colega, não', async () => {
    expect((await request(app).get(`/api/projects/drill/people/${analyst}`).set('Authorization', asAnalyst())).status).toBe(200)
    expect((await request(app).get(`/api/projects/drill/people/${otherAnalyst}`).set('Authorization', asAnalyst())).status).toBe(403)
  })

  it('o que vê de si fica nos projetos em que é membro', async () => {
    const res = await request(app).get(`/api/projects/drill/people/${otherAnalyst}?projectId=${projB}`).set('Authorization', auth(otherAnalyst, 'agent'))
    expect(res.status).toBe(404)
  })
})

describe('modal da task', () => {
  it('traz tempo, ciclo e histórico da task', async () => {
    const res = await request(app).get(`/api/projects/${projA}/tasks/${doneTask}/drill`).set('Authorization', asManager())
    expect(res.status).toBe(200)
    expect(res.body.data.time.cycleMinutes).not.toBeNull()
    expect(res.body.data.assignees[0]).toEqual({ id: analyst, name: `analista ${S}` }) // sem e-mail
    expect(res.body.data.timeline.map((e: { to: string }) => e.to)).toEqual(expect.arrayContaining([expect.any(String)]))
  })

  it('task de outro projeto pela URL do meu: 404', async () => {
    const res = await request(app).get(`/api/projects/${projB}/tasks/${hiddenTask}/drill`).set('Authorization', asManager())
    expect(res.status).toBe(404)
  })
})

describe('histórico da task', () => {
  it('registra checklist, tag, dependência, início e subtask com o autor e traduz os ids', async () => {
    const base = `/api/projects/${projA}/tasks/${runningTask}`
    const h = { Authorization: asAnalyst() }

    const item = await request(app).post(`${base}/checklist`).set(h).send({ text: 'Validar em QA' })
    expect(item.status).toBe(201)
    await request(app).patch(`${base}/checklist/${item.body.data.id}`).set(h).send({ done: true })
    await request(app).delete(`${base}/checklist/${item.body.data.id}`).set(h)

    const tag = await prisma.tag.create({ data: { project_id: projA, name: `urgente ${S}`, color: '#f00' } })
    await request(app).post(`${base}/tags/${tag.id}`).set(h)
    await request(app).delete(`${base}/tags/${tag.id}`).set(h)

    const dep = await request(app).post(`${base}/dependencies`).set(h).send({ dependsOnId: overdueTask })
    expect(dep.status).toBe(201)

    await request(app).patch(base).set(h).send({ startDate: new Date('2026-11-10T12:00:00Z').toISOString() })
    await request(app).patch(base).set(h).send({ statusId: doneStatus })

    const res = await request(app).get(`${base}/activity`).set(h)
    expect(res.status).toBe(200)
    const events = res.body.data as Array<{ type: string; from?: string; to?: string; action?: string; actor: { id: string } }>

    expect(events.filter((e) => e.type === 'checklist_changed').map((e) => [e.action, e.to])).toEqual([
      ['added', 'Validar em QA'], ['done', 'Validar em QA'], ['removed', 'Validar em QA'],
    ])
    expect(events.filter((e) => e.type === 'tag_changed').map((e) => e.to ?? e.from)).toEqual([`urgente ${S}`, `urgente ${S}`])
    expect(events.find((e) => e.type === 'dependency_changed')?.to).toContain(`t1 ${S}`)
    expect(events.some((e) => e.type === 'start_date_changed')).toBe(true)

    const status = events.filter((e) => e.type === 'status_changed').at(-1)!
    expect(status.from).not.toMatch(/^[0-9a-f-]{36}$/) // nome do status, não o id
    expect(status.to).toBeTruthy()
    expect(events.every((e) => e.actor.id === analyst)).toBe(true)
  })

  it('histórico vem do mais antigo para o mais novo e não expõe outro projeto', async () => {
    const res = await request(app).get(`/api/projects/${projA}/tasks/${doneTask}/activity`).set('Authorization', asManager())
    const times = (res.body.data as Array<{ createdAt: string }>).map((e) => new Date(e.createdAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
    const cross = await request(app).get(`/api/projects/${projB}/tasks/${hiddenTask}/activity`).set('Authorization', asManager())
    expect(cross.status).toBe(404)
  })
})
