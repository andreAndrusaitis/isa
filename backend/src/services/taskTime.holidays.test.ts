// Feriados no tempo de task com portfólio antigo (task de 2023 não pode deixar
// os feriados de 2026 de fora). Prisma real; cleanup restrito aos IDs daqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/taskTime.holidays.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { loadProjectTime } from './taskTime'
import { nationalHolidays } from '../utils/businessHours'

const S = `tth-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
let userId: string
let projectId: string
let holidayTaskId: string
let workdayTaskId: string

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: 'Tempo Feriado', email: `${S}@t.local`, role: 'agent', module_projects: true } })).id
  projectId = (await prisma.project.create({ data: { name: `Feriados ${S}`, owner_id: userId } })).id
  const doing = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Em Progresso', color: '#00f', category: 'in_progress', position: 0 } })
  const done = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Concluído', color: '#0a0', category: 'done', position: 1 } })

  await prisma.task.create({ data: { project_id: projectId, status_id: doing.id, seq: 1, title: 'antiga', creator_id: userId, created_at: new Date('2023-03-01T12:00:00Z') } })
  // Finados (seg 02/11/2026) das 08h às 17h de SP; controle no dia útil seguinte.
  const make = async (seq: number, start: string, end: string) => {
    const task = await prisma.task.create({ data: { project_id: projectId, status_id: done.id, seq, title: `t${seq}`, creator_id: userId, created_at: new Date(start) } })
    await prisma.taskActivity.create({ data: { task_id: task.id, actor_id: userId, type: 'status_changed', from_value: doing.id, to_value: done.id, created_at: new Date(end) } })
    // Status inicial (em andamento) sai do histórico: from_value do 1º status_changed.
    return task.id
  }
  holidayTaskId = await make(2, '2026-11-02T11:00:00Z', '2026-11-02T20:00:00Z')
  workdayTaskId = await make(3, '2026-11-03T11:00:00Z', '2026-11-03T20:00:00Z')
})

afterAll(async () => {
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
  await prisma.task.deleteMany({ where: { project_id: projectId } })
  await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
  await prisma.project.delete({ where: { id: projectId } })
  await prisma.user.delete({ where: { id: userId } })
})

describe('loadProjectTime com task de 2023 no portfólio', () => {
  it('Finados de 2026 é feriado nacional', () => {
    expect(nationalHolidays(2026)).toContain('2026-11-02')
  })

  it('não conta horas úteis no feriado de 2026 e conta no dia útil', async () => {
    const rows = await loadProjectTime([projectId])
    const byId = new Map(rows.map((r) => [r.task.id, r]))
    const holiday = byId.get(holidayTaskId)!
    const workday = byId.get(workdayTaskId)!
    expect(holiday.time.completedAt).toEqual(new Date('2026-11-02T20:00:00Z'))
    expect(holiday.time.activeMinutes).toBe(0)
    expect(holiday.cycleMinutes).toBe(0)
    expect(workday.time.activeMinutes).toBeGreaterThan(0)
    expect(workday.wallActiveMinutes).toBe(9 * 60)
    expect(workday.cycleMinutes).toBe(workday.time.activeMinutes)
  })

  it('cada task recebe só o próprio histórico (agrupado por task)', async () => {
    const rows = await loadProjectTime([projectId])
    const old = rows.find((r) => r.task.seq === 1)!
    expect(old.time.completedAt).toBeNull()
    expect(old.time.running).toBe(true)
    expect(rows.filter((r) => r.time.completedAt).map((r) => r.task.id).sort()).toEqual([holidayTaskId, workdayTaskId].sort())
  })
})
