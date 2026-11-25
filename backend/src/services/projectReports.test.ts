// "Meu ciclo por projeto" (Minha Área) e a lente "Meus projetos" do BI.
// Prisma real contra o banco descartável; cleanup restrito aos IDs daqui.
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { createProject } from './projects'
import { getMyCycle, getMyProjectsReport, managedProjectIds, getDashboardGlobalFor } from './projectReports'
import { getBusinessHoursConfig } from './businessHours'
import { getBusinessMinutesBetween, holidaysAround } from '../utils/businessHours'

vi.mock('./moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))

import projectsTeamRoutes from '../routes/projectsTeam'
import { errorHandler } from '../middlewares/errorHandler'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsTeamRoutes)
app.use(errorHandler)

const S = `myrep-${Date.now()}`
const DAY = 86_400_000
const userIds: string[] = []
const projectIds: string[] = []
let analystId: string, coworkerId: string, managerId: string, otherManagerId: string
let projA: string, projC: string, projD: string, projE: string, projArchived: string
let seq = 0
let expectedA: number[] = []
let runningStart: Date

const at = (daysAgo: number, hour: number) => {
  const d = new Date(Date.now() - daysAgo * DAY)
  d.setUTCHours(hour + 3, 0, 0, 0) // hora de São Paulo (UTC−3)
  return d
}

async function user(prefix: string, role: 'agent' | 'manager') {
  const u = await prisma.user.create({ data: { name: `${prefix} ${S}`, email: `${prefix}-${S}@t.com`, role, module_projects: true } })
  userIds.push(u.id)
  return u.id
}

async function project(ownerId: string, name: string) {
  const p = await createProject(ownerId, { name: `${name} ${S}`, privacy: 'organization' })
  projectIds.push(p.id)
  return p.id
}

async function statuses(projectId: string) {
  const all = await prisma.projectStatus.findMany({ where: { project_id: projectId } })
  return {
    open: all.find((s) => s.category === 'open')!.id,
    doing: all.find((s) => s.category === 'in_progress')!.id,
    done: all.find((s) => s.category === 'done')!.id,
  }
}

async function task(projectId: string, opts: { status: string; assignee: string | null; coAssignees?: string[]; moves?: Array<[string, string, Date]>; createdAt: Date; due?: Date }) {
  const t = await prisma.task.create({
    data: {
      project_id: projectId, status_id: opts.status, assignee_id: opts.assignee, creator_id: managerId, seq: ++seq,
      title: `t${seq} ${S}`, created_at: opts.createdAt, due_date: opts.due ?? null,
    },
  })
  for (const uid of opts.coAssignees ?? []) await prisma.taskAssignee.create({ data: { task_id: t.id, user_id: uid } })
  for (const [from, to, when] of opts.moves ?? []) {
    await prisma.taskActivity.create({ data: { task_id: t.id, actor_id: managerId, type: 'status_changed', from_value: from, to_value: to, created_at: when } })
  }
  return t.id
}

beforeAll(async () => {
  analystId = await user('analista', 'agent')
  coworkerId = await user('colega', 'agent')
  managerId = await user('gerente', 'manager')
  otherManagerId = await user('outro', 'manager')

  projA = await project(managerId, 'A')
  await prisma.projectMember.createMany({ data: [{ project_id: projA, user_id: analystId, role: 'member' }, { project_id: projA, user_id: coworkerId, role: 'member' }] })
  projC = await project(otherManagerId, 'C') // analista não é membro
  projD = await project(otherManagerId, 'D')
  await prisma.projectMember.create({ data: { project_id: projD, user_id: managerId, role: 'manager' } })
  projE = await project(otherManagerId, 'E')
  await prisma.projectMember.create({ data: { project_id: projE, user_id: managerId, role: 'member' } })
  projArchived = await project(managerId, 'Arquivado')
  await prisma.project.update({ where: { id: projArchived }, data: { archived_at: new Date() } })

  const cfg = await getBusinessHoursConfig()
  const business = (a: Date, b: Date) => getBusinessMinutesBetween(a, b, cfg, holidaysAround(new Date(Date.UTC(a.getUTCFullYear() - 1, 0, 1))))
  const a = await statuses(projA)

  // Responsável principal, concluída há 10 dias.
  await task(projA, { status: a.done, assignee: analystId, createdAt: at(11, 9), moves: [[a.open, a.doing, at(10, 10)], [a.doing, a.done, at(10, 15)]] })
  // Co-responsável, concluída há 5 dias (atravessa a noite).
  await task(projA, { status: a.done, assignee: coworkerId, coAssignees: [analystId], createdAt: at(7, 9), moves: [[a.open, a.doing, at(6, 10)], [a.doing, a.done, at(5, 11)]] })
  expectedA = [business(at(10, 10), at(10, 15)), business(at(6, 10), at(5, 11))]
  // Do colega, sem mim: fica de fora.
  await task(projA, { status: a.done, assignee: coworkerId, createdAt: at(4, 9), moves: [[a.open, a.doing, at(3, 10)], [a.doing, a.done, at(3, 12)]] })
  // Minha, concluída há 200 dias: só no período de 365.
  await task(projA, { status: a.done, assignee: analystId, createdAt: at(202, 9), moves: [[a.open, a.doing, at(201, 10)], [a.doing, a.done, at(200, 10)]] })
  // Minha, em andamento há 3 dias.
  runningStart = at(3, 10)
  await task(projA, { status: a.doing, assignee: analystId, createdAt: at(4, 9), moves: [[a.open, a.doing, runningStart]] })
  // Minha, aberta e atrasada (prazo anteontem); outra com prazo hoje não conta como atrasada.
  await task(projA, { status: a.open, assignee: analystId, createdAt: at(4, 9), due: at(2, 9) })
  await task(projA, { status: a.open, assignee: coworkerId, createdAt: at(4, 9), due: at(0, 9) })

  // Projeto que o analista não enxerga: tarefa dele lá não entra.
  const c = await statuses(projC)
  await task(projC, { status: c.done, assignee: analystId, createdAt: at(3, 9), moves: [[c.open, c.doing, at(2, 10)], [c.doing, c.done, at(2, 12)]] })
  // Projeto arquivado: fora de tudo.
  const z = await statuses(projArchived)
  await task(projArchived, { status: z.done, assignee: analystId, createdAt: at(3, 9), moves: [[z.open, z.doing, at(2, 10)], [z.doing, z.done, at(2, 12)]] })
  await task(projD, { status: (await statuses(projD)).open, assignee: otherManagerId, createdAt: at(1, 9) })
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

const toHours = (mins: number[]) => Math.round((mins.reduce((x, y) => x + y, 0) / mins.length / 60) * 10) / 10
const token = (sub: string, role: string) => `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

describe('meu ciclo por projeto', () => {
  it('conta só as minhas tasks (responsável ou co-responsável) concluídas no período', async () => {
    const data = await getMyCycle(analystId, 90)
    expect(data.projects).toHaveLength(1)
    expect(data.projects[0]).toMatchObject({ projectId: projA, done: 2, open: 2, inProgress: 1, avgCycleHours: toHours(expectedA) })
    const sorted = [...expectedA].sort((x, y) => x - y)
    expect(data.projects[0].medianCycleHours).toBe(toHours(sorted))
  })

  it('últimas entregas, da mais recente, e o que está em andamento com horas úteis até agora', async () => {
    const data = await getMyCycle(analystId, 90)
    expect(data.recent.map((r) => r.completedAt!.getTime())).toEqual([at(5, 11).getTime(), at(10, 15).getTime()])
    expect(data.recent[0].projectName).toBe(`A ${S}`)
    expect(data.current).toHaveLength(1)
    const cfg = await getBusinessHoursConfig()
    const expected = getBusinessMinutesBetween(runningStart, new Date(), cfg, holidaysAround(new Date(Date.UTC(runningStart.getUTCFullYear() - 1, 0, 1)))) / 60
    expect(data.current[0].hoursSoFar).toBeCloseTo(expected, 0)
    expect(data.current[0].startedAt!.getTime()).toBe(runningStart.getTime())
  })

  it('período maior traz a conclusão antiga', async () => {
    expect((await getMyCycle(analystId, 365)).projects[0].done).toBe(3)
  })

  it('quem não tem tasks não vê projeto nenhum; tarefas do outro ficam de fora', async () => {
    const colega = await getMyCycle(coworkerId, 90)
    expect(colega.projects[0]).toMatchObject({ projectId: projA, done: 2, open: 1, inProgress: 0 })
    expect(colega.current).toEqual([])
    expect((await getMyCycle(otherManagerId, 90)).projects.map((p) => p.projectId)).toEqual([projD])
  })

  it('GET /api/projects/my-cycle vale para o analista, sem liberação de relatórios', async () => {
    const res = await request(app).get('/api/projects/my-cycle?days=30').set('Authorization', token(analystId, 'agent'))
    expect(res.status).toBe(200)
    expect(res.body.data.days).toBe(30)
    expect(res.body.data.projects[0]).toMatchObject({ projectId: projA, done: 2, inProgress: 1 })
    expect(res.body.data.current[0]).toHaveProperty('hoursSoFar')
    const bad = await request(app).get('/api/projects/my-cycle?days=10').set('Authorization', token(analystId, 'agent'))
    expect(bad.status).toBe(400)
  })
})

describe('lente "Meus projetos"', () => {
  it('só projetos de que sou dono ou gerente, não arquivados', async () => {
    expect((await managedProjectIds(managerId)).sort()).toEqual([projA, projD].sort())
    expect((await managedProjectIds(analystId))).toEqual([])
  })

  it('tabela por projeto: abertas, concluídas, atrasadas (o dia do prazo não conta), ciclo e membros', async () => {
    const { projects } = await getMyProjectsReport(managerId, 90)
    const a = projects.find((p) => p.id === projA)!
    expect(a).toMatchObject({ openTasks: 3, doneTasks: 4, overdueTasks: 1, membersCount: 3 })
    expect(a.avgCycleHours).not.toBeNull()
    expect(projects.find((p) => p.id === projD)).toMatchObject({ openTasks: 1, doneTasks: 0, overdueTasks: 0, avgCycleHours: null, membersCount: 2 })
    expect(projects.map((p) => p.id)).not.toContain(projE)
    expect(projects.map((p) => p.id)).not.toContain(projC)
  })

  it('dashboard com scope=mine soma só os projetos geridos; padrão continua o da equipe', async () => {
    const mine = await request(app).get('/api/projects/dashboard-global?scope=mine').set('Authorization', token(managerId, 'manager'))
    expect(mine.status).toBe(200)
    expect(await getDashboardGlobalFor([projA, projD])).toMatchObject({ totalTasks: 8, byStatus: { done: 4, open: 3, in_progress: 1 }, overdueCount: 1 })
    expect(mine.body.data).toMatchObject({ totalTasks: 8, byStatus: { done: 4, open: 3, inProgress: 1 }, overdueCount: 1 })
    const team = await request(app).get('/api/projects/dashboard-global').set('Authorization', token(managerId, 'manager'))
    expect(team.status).toBe(200)
    expect(team.body.data.totalTasks).toBeGreaterThanOrEqual(mine.body.data.totalTasks)
    const bad = await request(app).get('/api/projects/dashboard-global?scope=all').set('Authorization', token(managerId, 'manager'))
    expect(bad.status).toBe(400)
  })

  it('cycle-time com scope=mine e GET /reports/my-projects exigem relatórios', async () => {
    const cycle = await request(app).get('/api/projects/cycle-time?scope=mine&days=90').set('Authorization', token(managerId, 'manager'))
    expect(cycle.status).toBe(200)
    expect(cycle.body.data.byType.reduce((n: number, r: { tasks: number }) => n + r.tasks, 0)).toBe(3)
    const report = await request(app).get('/api/projects/reports/my-projects').set('Authorization', token(managerId, 'manager'))
    expect(report.status).toBe(200)
    expect(report.body.data.projects.map((p: { id: string }) => p.id).sort()).toEqual([projA, projD].sort())
    expect(report.body.data.projects[0]).toHaveProperty('membersCount')
    const denied = await request(app).get('/api/projects/reports/my-projects').set('Authorization', token(analystId, 'agent'))
    expect(denied.status).toBe(403)
  })
})
