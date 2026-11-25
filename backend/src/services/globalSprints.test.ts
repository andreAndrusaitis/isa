// Prisma real contra o banco de teste (5434). Cleanup restrito aos IDs criados aqui.
//   DATABASE_URL=… DIRECT_URL=… npx vitest run --fileParallelism=false src/services/globalSprints.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createGlobalSprint, updateGlobalSprint, startGlobalSprint, deleteGlobalSprint, setProjectSprintSource, getGlobalSprintOverview, listOwners, listGlobalSprints, allowedCalendarOwners } from './globalSprints'
import { createSprint, listSprints } from './sprints'
import { createNavFolder, updateNavFolder, deleteNavFolder, moveProjectToNavFolder, listNavFolders } from './projectNavFolders'

describe('sprints globais e pastas da sidebar', () => {
  let managerId: string
  let otherId: string
  let projectIds: string[] = []
  let folderIds: string[] = []
  const actor = () => ({ sub: managerId, role: 'manager' })

  beforeEach(async () => {
    const tag = `${Date.now()}-${Math.random()}`
    managerId = (await prisma.user.create({ data: { name: 'Gerente GS', email: `gs-mgr-${tag}@test.com`, role: 'manager' } })).id
    otherId = (await prisma.user.create({ data: { name: 'Analista GS', email: `gs-agt-${tag}@test.com`, role: 'agent' } })).id
    for (const name of ['A', 'B']) {
      const p = await prisma.project.create({ data: { name: `GS ${name} ${tag}`, owner_id: managerId } })
      await prisma.projectMember.create({ data: { project_id: p.id, user_id: managerId, role: 'owner' } })
      projectIds.push(p.id)
    }
  })

  afterEach(async () => {
    await prisma.project.updateMany({ where: { id: { in: projectIds } }, data: { nav_folder_id: null } })
    await prisma.projectNavFolder.updateMany({ where: { id: { in: folderIds } }, data: { parent_id: null } })
    await prisma.projectNavFolder.deleteMany({ where: { id: { in: folderIds } } })
    await prisma.sprint.deleteMany({ where: { project_id: { in: projectIds } } })
    await prisma.globalSprint.deleteMany({ where: { owner_id: managerId } })
    await prisma.projectMember.deleteMany({ where: { project_id: { in: projectIds } } })
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [managerId, otherId] } } })
    projectIds = []
    folderIds = []
  })

  it('replica o sprint global nos projetos que seguem o Gerente e propaga edição/status', async () => {
    const [a, b] = projectIds
    await setProjectSprintSource(a, managerId)
    const g = await createGlobalSprint(actor(), managerId, { name: 'Sprint 5', startDate: '2026-11-02T12:00:00.000Z' })

    expect((await listSprints(a)).map((s) => s.name)).toEqual(['Sprint 5'])
    expect(await listSprints(b)).toEqual([]) // B segue os próprios

    await updateGlobalSprint(actor(), g.id, { name: 'Sprint 5 (ajustado)' })
    await startGlobalSprint(actor(), g.id)
    const [copy] = await listSprints(a)
    expect(copy).toMatchObject({ name: 'Sprint 5 (ajustado)', status: 'active', global_sprint_id: g.id })

    // B adere depois: ganha a cópia sem duplicar; voltar a "próprios" esconde sem apagar.
    await setProjectSprintSource(b, managerId)
    await setProjectSprintSource(b, managerId)
    expect(await prisma.sprint.count({ where: { project_id: b } })).toBe(1)
    await setProjectSprintSource(a, null)
    expect(await listSprints(a)).toEqual([])
    expect(await prisma.sprint.count({ where: { project_id: a } })).toBe(1)
  })

  it('projeto seguindo o global não cria sprint próprio; Gerente não mexe no calendário de outro', async () => {
    await setProjectSprintSource(projectIds[0], managerId)
    await expect(createSprint(projectIds[0], { name: 'X' })).rejects.toMatchObject({ code: 'GLOBAL_SPRINT_MANAGED' })
    await expect(createGlobalSprint({ sub: otherId, role: 'manager' }, managerId, { name: 'Y' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(setProjectSprintSource(projectIds[1], otherId)).rejects.toMatchObject({ code: 'INVALID_SPRINT_SOURCE' })
  })

  it('painel mostra só projetos de que o usuário é membro; excluir o global limpa as cópias', async () => {
    for (const id of projectIds) await setProjectSprintSource(id, managerId)
    const g = await createGlobalSprint(actor(), managerId, { name: 'Sprint P', startDate: '2026-10-05T12:00:00.000Z', endDate: '2026-10-09T12:00:00.000Z' })
    const overview = await getGlobalSprintOverview(managerId, g.id)
    expect(overview.projects).toHaveLength(2)
    // Burndown somado das cópias: um dia por data da sprint (05 a 09 = 5 dias), sem tasks = total 0.
    expect(overview.burndown?.days).toHaveLength(5)
    expect(overview.burndown?.total).toBe(0)
    // Analista fora do organograma e sem projeto seguindo o calendário: nem o sprint aparece.
    await expect(getGlobalSprintOverview(otherId, g.id)).rejects.toMatchObject({ code: 'GLOBAL_SPRINT_NOT_VISIBLE' })

    await deleteGlobalSprint(actor(), g.id)
    expect(await prisma.sprint.count({ where: { project_id: { in: projectIds } } })).toBe(0)
  })

  it('pastas: aninha, recusa ciclo, apagar sobe filhos, e quem não organiza só vê o caminho dos seus projetos', async () => {
    const desenv = await createNavFolder({ name: 'desenv' })
    const andre = await createNavFolder({ name: 'andre', parentId: desenv.id })
    const vazia = await createNavFolder({ name: 'vazia' })
    folderIds.push(desenv.id, andre.id, vazia.id)

    await expect(updateNavFolder(desenv.id, { parentId: andre.id })).rejects.toMatchObject({ code: 'NAV_FOLDER_CYCLE' })

    await moveProjectToNavFolder(projectIds[0], andre.id)
    const seen = (await listNavFolders(managerId, false)).map((f) => f.name)
    expect(seen).toEqual(expect.arrayContaining(['desenv', 'andre']))
    expect(seen).not.toContain('vazia')
    expect(await listNavFolders(otherId, false)).toEqual([])

    await deleteNavFolder(andre.id)
    expect((await prisma.project.findUnique({ where: { id: projectIds[0] } }))?.nav_folder_id).toBe(desenv.id)
  })
})

describe('quem vê e escolhe calendário de sprints', () => {
  const ids: Record<string, string> = {}
  const projects: string[] = []
  const tag = `cal-${Date.now()}`
  const mk = (k: string, role: string, managerKey?: string) =>
    prisma.user.create({ data: { name: `${k} ${tag}`, email: `${k}-${tag}@t.com`, role: role as any, manager_id: managerKey ? ids[managerKey] : null } }).then((u) => { ids[k] = u.id })

  beforeAll(async () => {
    await mk('diretor', 'manager')
    await mk('gerente', 'manager', 'diretor')
    await mk('analista', 'agent', 'gerente')
    await mk('outroGerente', 'manager')
    await mk('admin', 'admin')
    const p = await prisma.project.create({ data: { name: `Cal ${tag}`, owner_id: ids.analista } })
    await prisma.projectMember.create({ data: { project_id: p.id, user_id: ids.analista, role: 'owner' } })
    projects.push(p.id)
  })


  it('analista vê os Gerentes acima dele; Gerente vê o próprio e os de cima; admin vê todos', async () => {
    expect((await listOwners(ids.analista)).map((o) => o.id).sort()).toEqual([ids.diretor, ids.gerente].sort())
    expect([...(await allowedCalendarOwners(ids.gerente))!].sort()).toEqual([ids.diretor, ids.gerente].sort())
    expect(await allowedCalendarOwners(ids.admin)).toBeNull()
    const adminSees = (await listOwners(ids.admin)).map((o) => o.id)
    expect(adminSees).toEqual(expect.arrayContaining([ids.outroGerente, ids.gerente]))
  })

  it('não lê nem prende projeto no calendário de um Gerente de fora', async () => {
    await expect(listGlobalSprints(ids.analista, ids.outroGerente)).rejects.toMatchObject({ code: 'GLOBAL_SPRINT_NOT_VISIBLE' })
    await expect(setProjectSprintSource(projects[0], ids.outroGerente, ids.analista)).rejects.toMatchObject({ code: 'GLOBAL_SPRINT_NOT_VISIBLE' })
    await setProjectSprintSource(projects[0], ids.gerente, ids.analista)
    expect((await prisma.project.findUnique({ where: { id: projects[0] } }))!.sprint_source_id).toBe(ids.gerente)
  })

  it('calendário seguido por um projeto visível continua visível (e trocável de volta)', async () => {
    // Um admin prendeu o projeto ao calendário do Gerente de fora: o analista vê esse calendário.
    await setProjectSprintSource(projects[0], ids.outroGerente, ids.admin)
    expect((await allowedCalendarOwners(ids.analista))!.has(ids.outroGerente)).toBe(true)
    await expect(listGlobalSprints(ids.analista, ids.outroGerente)).resolves.toEqual([])
    await setProjectSprintSource(projects[0], null, ids.analista)
  })

  afterAll(async () => {
    await prisma.sprint.deleteMany({ where: { project_id: { in: projects } } })
    await prisma.projectMember.deleteMany({ where: { project_id: { in: projects } } })
    await prisma.project.deleteMany({ where: { id: { in: projects } } })
    await prisma.user.updateMany({ where: { id: { in: Object.values(ids) } }, data: { manager_id: null } })
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
  })
})
