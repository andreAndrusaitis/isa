// Prisma real contra o banco descartável 5434. Cleanup restrito aos IDs criados aqui.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject, listProjectsForUser } from './projects'
import { teamUserIds, effectiveProjectRole, visibleProjectsWhere } from './projectAccess'

const S = `team-${Date.now()}`
const ids: Record<string, string> = {}
const projectIds: string[] = []

const mk = (key: string, role: string, managerKey?: string) =>
  prisma.user.create({
    data: { name: `${key} ${S}`, email: `${key}-${S}@t.com`, role: role as any, manager_id: managerKey ? ids[managerKey] : null, module_projects: true },
  }).then((u) => { ids[key] = u.id; return u })

beforeAll(async () => {
  await mk('gerente', 'manager')
  await mk('tm', 'supervisor', 'gerente')
  await mk('analista', 'agent', 'tm')
  await mk('fora', 'agent')
  await mk('dono', 'admin')

  const daEquipe = await createProject(ids.dono, { name: `Equipe ${S}`, privacy: 'organization' })
  const deFora = await createProject(ids.dono, { name: `Fora ${S}`, privacy: 'organization' })
  projectIds.push(daEquipe.id, deFora.id)
  await prisma.projectMember.createMany({
    data: [
      { project_id: daEquipe.id, user_id: ids.analista, role: 'member' },
      { project_id: deFora.id, user_id: ids.fora, role: 'member' },
    ],
  })
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
  await prisma.user.updateMany({ where: { id: { in: Object.values(ids) } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
  await prisma.$disconnect()
})

describe('equipe do gerente (organograma)', () => {
  it('inclui todos os níveis abaixo dele, sem ele mesmo', async () => {
    const team = await teamUserIds(ids.gerente)
    expect(team).toEqual(expect.arrayContaining([ids.tm, ids.analista]))
    expect(team).not.toContain(ids.gerente)
    expect(team).not.toContain(ids.fora)
  })

  it('termina mesmo com ciclo no organograma', async () => {
    await prisma.user.update({ where: { id: ids.gerente }, data: { manager_id: ids.analista } })
    try {
      const team = await teamUserIds(ids.gerente)
      expect(team).toEqual(expect.arrayContaining([ids.tm, ids.analista]))
    } finally {
      await prisma.user.update({ where: { id: ids.gerente }, data: { manager_id: null } })
    }
  })

  it('gerente vê projeto da equipe como viewer e não vê projeto de fora', async () => {
    expect(await effectiveProjectRole(projectIds[0], ids.gerente)).toBe('viewer')
    expect(await effectiveProjectRole(projectIds[1], ids.gerente)).toBeNull()
    const where = await visibleProjectsWhere(ids.gerente)
    const visible = await prisma.project.findMany({ where: { ...where, id: { in: projectIds } }, select: { id: true } })
    expect(visible.map((p) => p.id)).toEqual([projectIds[0]])
  })

  it('Ticket Manager não ganha visão de equipe', async () => {
    expect(await effectiveProjectRole(projectIds[0], ids.tm)).toBeNull()
  })

  it('membro continua com o próprio papel', async () => {
    expect(await effectiveProjectRole(projectIds[0], ids.analista)).toBe('member')
  })

  it('catálogo marca o projeto só da equipe com team_only', async () => {
    const list = await listProjectsForUser(ids.gerente)
    const mine = list.filter((p) => projectIds.includes(p.id))
    expect(mine.map((p) => [p.id, p.team_only])).toEqual([[projectIds[0], true]])
    const asMember = (await listProjectsForUser(ids.analista)).find((p) => p.id === projectIds[0])
    expect(asMember?.team_only).toBe(false)
  })
})
