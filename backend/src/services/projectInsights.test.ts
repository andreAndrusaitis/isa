// Indicadores dos gráficos de Projetos. Prisma real — banco descartável:
//   DATABASE_URL=postgresql://isa:isa@127.0.0.1:5434/isa DIRECT_URL=$DATABASE_URL npx vitest run --fileParallelism=false --test-timeout=30000 src/services/projectInsights.test.ts
// Cleanup restrito aos IDs criados aqui.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { getInsights, getActivityHeatmap, lastDays, weekKey, dayKey } from './projectInsights'

const S = `pin-${Date.now()}`
const ids = { userId: '', projectId: '' }
const DAY = 86_400_000
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY)

beforeAll(async () => {
  ids.userId = (await prisma.user.create({ data: { name: 'Gráficos', email: `${S}@t.local`, role: 'agent' } })).id
  const project = await prisma.project.create({ data: { name: `Proj ${S}`, owner_id: ids.userId, members: { create: { user_id: ids.userId, role: 'owner' } } } })
  ids.projectId = project.id
  const open = await prisma.projectStatus.create({ data: { project_id: project.id, name: 'A Fazer', color: '#999', category: 'open', position: 0 } })
  const done = await prisma.projectStatus.create({ data: { project_id: project.id, name: 'Feito', color: '#0a0', category: 'done', position: 1 } })
  const bug = await prisma.taskType.create({ data: { project_id: project.id, name: 'Bug', prefix: 'BUG', icon: 'Bug', color: '#f00', position: 0 } })
  const epic = await prisma.taskType.create({ data: { project_id: project.id, name: 'Epic', prefix: 'EPIC', icon: 'Flag', color: '#00f', position: 1 } })
  const sprint = await prisma.sprint.create({ data: { project_id: project.id, name: 'Sprint 1', status: 'active', start_date: at(5), end_date: at(-5) } })
  let seq = 0
  const task = async (o: { type: string; doneDaysAgo?: number; dueDaysAgo?: number; key: string; sprint?: boolean; points?: number }) => {
    const t = await prisma.task.create({
      data: {
        project_id: project.id, status_id: o.doneDaysAgo !== undefined ? done.id : open.id, seq: ++seq, key: o.key, title: o.key,
        creator_id: ids.userId, task_type_id: o.type, created_at: at(20), due_date: o.dueDaysAgo !== undefined ? at(o.dueDaysAgo) : null,
        sprint_id: o.sprint ? sprint.id : null, story_points: o.points ?? null,
      },
    })
    if (o.doneDaysAgo !== undefined) {
      await prisma.taskActivity.create({ data: { task_id: t.id, actor_id: ids.userId, type: 'status_changed', from_value: open.id, to_value: done.id, created_at: at(o.doneDaysAgo) } })
    }
  }
  await task({ type: bug.id, key: 'BUG-1', doneDaysAgo: 3, dueDaysAgo: 1, sprint: true, points: 3 }) // no prazo
  await task({ type: bug.id, key: 'BUG-2', doneDaysAgo: 2, dueDaysAgo: 4, sprint: true, points: 5 }) // atrasada
  await task({ type: bug.id, key: 'BUG-3', sprint: true, points: 2 }) // aberta
  await task({ type: epic.id, key: 'EPIC-1', doneDaysAgo: 1 }) // vira evento
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.user.deleteMany({ where: { id: ids.userId } })
})

describe('indicadores dos gráficos', () => {
  it('datas: lista de dias termina hoje e semana começa na segunda', () => {
    const days = lastDays(7)
    expect(days).toHaveLength(7)
    expect(days[6]).toBe(dayKey(new Date()))
    expect(weekKey('2026-10-09')).toBe('2026-10-05') // sexta → segunda
    expect(weekKey('2026-10-05')).toBe('2026-10-05')
  })

  it('dayKey (conta UTC−3) bate com o Intl de São Paulo, inclusive perto da meia-noite', () => {
    const base = new Date('2025-01-01T00:00:00Z').getTime()
    for (let i = 0; i < 2000; i++) {
      const d = new Date(base + i * 7_919_000) // passo "quebrado": cobre todas as horas do dia
      expect(dayKey(d)).toBe(d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
    }
  })

  it('tipos, prazo, fluxo diário, semanas com evento e burndown', async () => {
    const r = await getInsights([ids.projectId])
    expect(r.byType).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Bug', total: 3, done: 2 }),
      expect.objectContaining({ name: 'Epic', total: 1, done: 1 }),
    ]))
    expect(r.onTime).toEqual({ onTime: 1, late: 1, pct: 50 })
    const last = r.daily[r.daily.length - 1]
    expect(last).toMatchObject({ open: 1, doneTotal: 3 })
    expect(r.daily.reduce((n, d) => n + d.completed, 0)).toBe(3)
    expect(r.weekly.reduce((n, w) => n + w.completed, 0)).toBe(3)
    expect(r.events.map((e) => e.label)).toEqual(['EPIC-1 concluído'])
    expect(r.burndown).toMatchObject({ unit: 'pontos', total: 10, sprint: { name: 'Sprint 1' } })
    const today = r.burndown!.days.find((d) => d.date === dayKey(new Date()))!
    expect(today.remaining).toBe(2) // 10 − 3 − 5
    expect(r.burndown!.days.at(-1)!.remaining).toBeNull() // futuro
    expect(r.burndown!.days[0].ideal).toBe(10)
  })

  it('mapa de calor conta atividades por dia e filtra por pessoa', async () => {
    const team = await getActivityHeatmap([ids.projectId])
    expect(team.reduce((n, d) => n + d.count, 0)).toBe(3)
    expect(await getActivityHeatmap([ids.projectId], ids.userId)).toEqual(team)
    expect(await getActivityHeatmap([ids.projectId], '00000000-0000-0000-0000-000000000099')).toEqual([])
  })
})
