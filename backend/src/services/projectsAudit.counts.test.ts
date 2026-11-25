// Auditoria de Projetos: arquivar projeto solta chamados, "atrasada" só no dia
// seguinte ao prazo, números de gestão ignoram projeto arquivado.
// Prisma real contra o banco descartável. Cleanup restrito aos IDs criados aqui.
//   cd backend && npx vitest run --fileParallelism=false src/services/projectsAudit.counts.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { archiveProject, createProject, listProjectsForUser } from './projects'
import { createTask } from './tasks'
import { getDashboardGlobal, getTeamWorkload } from './projectsTeam'
import { getMyArea, getProjectDashboard } from './projectDashboard'
import { dayKey, overdueCutoff } from './projectInsights'
import { linkTicketToTask } from './ticketTaskLink'

const S = `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const created = { users: [] as string[], tickets: [] as string[], projects: [] as string[], orgId: '' }
let managerId: string
let analystId: string
let projectId: string
let archivedId: string

const noon = (offsetDays: number) => `${dayKey(new Date(Date.now() + offsetDays * 86_400_000))}T12:00:00.000Z`

beforeAll(async () => {
  created.orgId = (await prisma.organization.create({ data: { name: `Org ${S}`, tier: 'bronze' } })).id
  managerId = (await prisma.user.create({ data: { name: 'Gerente Auditoria', email: `m-${S}@t.local`, role: 'manager', org_id: created.orgId, module_projects: true } })).id
  analystId = (await prisma.user.create({ data: { name: 'Analista Auditoria', email: `a-${S}@t.local`, role: 'agent', manager_id: managerId, org_id: created.orgId, module_projects: true } })).id
  created.users.push(managerId, analystId)

  projectId = (await createProject(managerId, { name: `Prazos ${S}`, privacy: 'restricted' })).id
  archivedId = (await createProject(managerId, { name: `Arquivado ${S}`, privacy: 'restricted' })).id
  created.projects.push(projectId, archivedId)
  for (const id of [projectId, archivedId]) await prisma.projectMember.create({ data: { project_id: id, user_id: analystId, role: 'member' } })

  const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'open' } })
  // Vence hoje (não atrasada), venceu ontem (atrasada), vence daqui a 2 dias.
  await createTask(projectId, managerId, { title: 'vence hoje', statusId: open.id, assigneeId: analystId, dueDate: noon(0) })
  await createTask(projectId, managerId, { title: 'venceu ontem', statusId: open.id, assigneeId: analystId, dueDate: noon(-1) })
  await createTask(projectId, managerId, { title: 'vence depois', statusId: open.id, dueDate: noon(2) })

  const openArchived = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: archivedId, category: 'open' } })
  await createTask(archivedId, managerId, { title: 'do arquivado', statusId: openArchived.id, assigneeId: analystId, dueDate: noon(-5) })
  await prisma.project.update({ where: { id: archivedId }, data: { archived_at: new Date() } })
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: created.tickets } } })
  await prisma.notification.deleteMany({ where: { ticket_id: { in: created.tickets } } })
  await prisma.ticket.deleteMany({ where: { id: { in: created.tickets } } })
  await prisma.notification.deleteMany({ where: { task: { project_id: { in: created.projects } } } })
  await prisma.taskAssignee.deleteMany({ where: { task: { project_id: { in: created.projects } } } })
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: { in: created.projects } } } })
  await prisma.task.deleteMany({ where: { project_id: { in: created.projects } } })
  await prisma.project.deleteMany({ where: { id: { in: created.projects } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: created.users } } })
  await prisma.user.deleteMany({ where: { id: { in: created.users } } })
  await prisma.organization.deleteMany({ where: { id: created.orgId } })
})

describe('corte de "atrasada" (dia seguinte ao prazo, em SP)', () => {
  it('prazo de hoje às 12:00Z não atrasa nem às 23h de SP; atrasa à 00h do dia seguinte', () => {
    const due = new Date('2026-11-03T12:00:00.000Z')
    expect(due < overdueCutoff(new Date('2026-11-03T20:00:00.000Z'))).toBe(false)
    expect(due < overdueCutoff(new Date('2026-11-04T02:59:00.000Z'))).toBe(false) // 23:59 em SP
    expect(due < overdueCutoff(new Date('2026-11-04T03:00:00.000Z'))).toBe(true) // 00:00 em SP do dia 4
  })

  it('catálogo conta só a que venceu ontem', async () => {
    const [p] = (await listProjectsForUser(managerId)).filter((x) => x.id === projectId)
    expect(p).toMatchObject({ total_tasks: 3, open_tasks: 3, overdue_tasks: 1 })
  })

  it('dashboard do projeto: vence hoje entra em "vence em breve", não em atrasada', async () => {
    const dash = await getProjectDashboard(projectId)
    expect(dash.totals).toMatchObject({ overdue: 1, dueSoon: 2 })
    expect(dash.upcoming.map((t) => t.title)).toEqual(['vence hoje', 'vence depois'])
  })

  it('Minha Área (cards dos projetos e contadores) e BI global contam 1 atrasada', async () => {
    const area = await getMyArea(analystId)
    expect(area.counts.overdue).toBe(1)
    const stats = area.recentProjects.find((p) => p.id === projectId)
    expect(stats?.overdueTasks).toBe(1)
    const global = await getDashboardGlobal(managerId)
    expect(global.overdueCount).toBe(1)
  })
})

describe('números de gestão ignoram projeto arquivado', () => {
  it('BI global não soma tasks do projeto arquivado', async () => {
    const global = await getDashboardGlobal(managerId)
    expect(global.totalTasks).toBe(3)
  })

  it('carga da equipe não conta task do projeto arquivado', async () => {
    const workload = await getTeamWorkload(managerId)
    expect(workload).toEqual([{ userId: analystId, name: 'Analista Auditoria', avatar: null, taskCount: 2 }])
  })
})

describe('arquivar projeto', () => {
  it('chamados vinculados às tasks voltam ao atendimento antes de arquivar', async () => {
    const pid = (await createProject(analystId, { name: `Com chamado ${S}`, privacy: 'restricted' })).id
    created.projects.push(pid)
    const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: pid, category: 'open' } })
    const task = await createTask(pid, analystId, { title: 'com chamado', statusId: open.id, dueDate: noon(5) })
    const ticketId = `TKT-${S}`
    await prisma.ticket.create({
      data: {
        id: ticketId, display_number: `ISA-${S}`, title: 'Chamado arquivar', description: 'x',
        user_id: analystId, org_id: created.orgId, assigned_to_id: analystId, queue: 'geral', status: 'in_progress',
        sla_deadline: new Date(Date.now() + 8 * 3_600_000), first_response_deadline: new Date(Date.now() + 3_600_000),
      },
    })
    created.tickets.push(ticketId)
    await linkTicketToTask(pid, task.id, ticketId, { sub: analystId, role: 'agent' })
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).pending_reason).toBe('pending_project')

    await archiveProject(pid, analystId)

    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t.status).toBe('in_progress')
    expect(t.project_task_id).toBeNull()
    expect(t.sla_paused_at).toBeNull()
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: ticketId, to_status: 'in_progress' }, orderBy: { created_at: 'desc' } })
    expect(ev.note).toMatch(/foi arquivado/)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: pid } })).archived_at).not.toBeNull()
  })

  it('sem chamados vinculados só arquiva', async () => {
    const pid = (await createProject(analystId, { name: `Sem chamado ${S}`, privacy: 'restricted' })).id
    created.projects.push(pid)
    await archiveProject(pid)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: pid } })).archived_at).not.toBeNull()
  })
})
