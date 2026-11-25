// Tempo médio de ciclo por tipo de task no Dashboard de Projetos.
// Ciclo = 1ª entrada em andamento → conclusão, em horas úteis (mesmo calendário
// do SLA). Prisma real contra o banco descartável; cleanup restrito aos IDs daqui.
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { createProject } from './projects'
import { getCycleTimeByType, summarizeCycleByType } from './projectsTeam'
import { getBusinessHoursConfig } from './businessHours'
import { getBusinessMinutesBetween, holidaysAround } from '../utils/businessHours'

// O módulo Projetos tem teste próprio (projects.authz.test): aqui o usuário já o tem.
vi.mock('./moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))

import projectsTeamRoutes from '../routes/projectsTeam'
import { errorHandler } from '../middlewares/errorHandler'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsTeamRoutes)
app.use(errorHandler)

const S = `cycle-${Date.now()}`
const DAY = 86_400_000
let managerId: string
let outsiderId: string
let projectId: string
let seq = 0
const expectedFeatureMinutes: number[] = []

const at = (daysAgo: number, hour: number) => {
  const d = new Date(Date.now() - daysAgo * DAY)
  d.setUTCHours(hour + 3, 0, 0, 0) // hora de São Paulo (UTC−3)
  return d
}

beforeAll(async () => {
  managerId = (await prisma.user.create({ data: { name: `Gerente ${S}`, email: `ger-${S}@t.com`, role: 'manager', module_projects: true } })).id
  outsiderId = (await prisma.user.create({ data: { name: `Fora ${S}`, email: `fora-${S}@t.com`, role: 'manager', module_projects: true } })).id
  projectId = (await createProject(managerId, { name: `Projeto ${S}`, privacy: 'organization' })).id

  const statuses = await prisma.projectStatus.findMany({ where: { project_id: projectId } })
  const backlog = statuses.find((s) => s.category === 'open')!.id
  const doing = statuses.find((s) => s.category === 'in_progress')!.id
  const done = statuses.find((s) => s.category === 'done')!.id
  const feature = await prisma.taskType.create({ data: { project_id: projectId, name: 'Feature', icon: 'star', color: '#2563eb', prefix: `F${seq}` } })
  const bug = await prisma.taskType.create({ data: { project_id: projectId, name: 'Bug', icon: 'bug', color: '#dc2626', prefix: `B${seq}` } })

  const cfg = await getBusinessHoursConfig()
  const business = (a: Date, b: Date) => getBusinessMinutesBetween(a, b, cfg, holidaysAround(new Date(Date.UTC(a.getUTCFullYear() - 1, 0, 1))))

  // Cada task: criada, e a sequência de mudanças de status no histórico.
  async function task(typeId: string, finalStatus: string, moves: Array<[string, string, Date]>, createdAt: Date) {
    const t = await prisma.task.create({ data: { project_id: projectId, status_id: finalStatus, task_type_id: typeId, creator_id: managerId, seq: ++seq, title: `t${seq}`, created_at: createdAt } })
    for (const [from, to, when] of moves) {
      await prisma.taskActivity.create({ data: { task_id: t.id, actor_id: managerId, type: 'status_changed', from_value: from, to_value: to, created_at: when } })
    }
  }

  // Feature 1: andamento → concluída no mesmo dia.
  await task(feature.id, done, [[backlog, doing, at(10, 10)], [doing, done, at(10, 14)]], at(10, 9))
  expectedFeatureMinutes.push(business(at(10, 10), at(10, 14)))
  // Feature 2: atravessa a noite (só horas úteis contam).
  await task(feature.id, done, [[backlog, doing, at(12, 10)], [doing, done, at(11, 10)]], at(12, 9))
  expectedFeatureMinutes.push(business(at(12, 10), at(11, 10)))
  // Feature 3: ainda em andamento — sem ciclo.
  await task(feature.id, doing, [[backlog, doing, at(5, 10)]], at(5, 9))
  // Bug 1: concluída sem passar por andamento — sem ciclo.
  await task(bug.id, done, [[backlog, done, at(8, 11)]], at(8, 9))
  // Bug 2: concluída há 200 dias — fora de um período de 90.
  await task(bug.id, done, [[backlog, doing, at(201, 10)], [doing, done, at(200, 10)]], at(201, 9))
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.user.deleteMany({ where: { id: { in: [managerId, outsiderId] } } })
  await prisma.$disconnect()
})

const avgHours = (mins: number[]) => Math.round((mins.reduce((a, b) => a + b, 0) / mins.length / 60) * 10) / 10

describe('ciclo médio por tipo de task', () => {
  it('soma só concluídas que passaram por andamento, dentro do período', async () => {
    const { byType } = await getCycleTimeByType(managerId, 90)
    expect(byType).toEqual([
      { type: 'Feature', color: '#2563eb', tasks: 2, avgHours: avgHours(expectedFeatureMinutes), medianHours: avgHours(expectedFeatureMinutes) },
    ])
  })

  it('período maior inclui a conclusão antiga', async () => {
    const { byType } = await getCycleTimeByType(managerId, 365)
    expect(byType.map((r) => [r.type, r.tasks])).toEqual([['Feature', 2], ['Bug', 1]])
  })

  it('quem não enxerga o projeto não vê os números dele', async () => {
    expect((await getCycleTimeByType(outsiderId, 365)).byType).toEqual([])
  })

  it('GET /api/projects/cycle-time devolve o resumo autenticado', async () => {
    const token = jwt.sign({ sub: managerId, role: 'manager', orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
    const res = await request(app).get('/api/projects/cycle-time?days=90').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.days).toBe(90)
    expect(res.body.data.byType[0]).toMatchObject({ type: 'Feature', tasks: 2 })

    const bad = await request(app).get('/api/projects/cycle-time?days=3').set('Authorization', `Bearer ${token}`)
    expect(bad.status).toBe(400)
  })
})

describe('summarizeCycleByType', () => {
  const since = new Date('2026-01-01T00:00:00Z')
  const done = new Date('2026-06-01T00:00:00Z')
  const types = new Map([['f1', { name: 'Feature', color: '#111' }], ['f2', { name: ' feature ', color: '#222' }]])

  it('junta tipos de mesmo nome de projetos diferentes e calcula a mediana', () => {
    const rows = [60, 120, 600].map((m, i) => ({ task: { task_type_id: i ? 'f2' : 'f1' }, time: { completedAt: done }, cycleMinutes: m }))
    expect(summarizeCycleByType(rows, types, since)).toEqual([{ type: 'Feature', color: '#111', tasks: 3, avgHours: 4.3, medianHours: 2 }])
  })

  it('task sem tipo vira "Sem tipo"', () => {
    const rows = [{ task: { task_type_id: null }, time: { completedAt: done }, cycleMinutes: 90 }]
    expect(summarizeCycleByType(rows, types, since)).toEqual([{ type: 'Sem tipo', color: null, tasks: 1, avgHours: 1.5, medianHours: 1.5 }])
  })
})
