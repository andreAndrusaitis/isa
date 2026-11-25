// Prisma real contra o banco descartável 5434 + JWT de verdade. Cleanup restrito aos IDs criados aqui.
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import projectsTeamRoutes from './projectsTeam'
import { createProject } from '../services/projects'
import { createTask } from '../services/tasks'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsTeamRoutes)
app.use(errorHandler)

const S = `exp-${Date.now()}`
const ids: Record<string, string> = {}
const projectIds: string[] = []
const orgIds: string[] = []
const bearer = (key: string, role: string) =>
  `Bearer ${jwt.sign({ sub: ids[key], role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

// Corpo binário do supertest (o padrão tentaria ler como texto).
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

beforeAll(async () => {
  const mk = async (key: string, role: string, manager?: string) => {
    ids[key] = (await prisma.user.create({ data: { name: `${key} ${S}`, email: `${key}-${S}@t.com`, role: role as any, module_projects: true, manager_id: manager ? ids[manager] : null } })).id
  }
  await mk('gerente', 'manager')
  await mk('analista', 'agent', 'gerente')
  await mk('fora', 'agent')
  await mk('dono', 'admin')
  const equipe = await createProject(ids.dono, { name: `Equipe <b>${S}</b>`, privacy: 'organization' })
  const fora = await createProject(ids.dono, { name: `Fora ${S}`, privacy: 'organization' })
  projectIds.push(equipe.id, fora.id)
  await prisma.projectMember.createMany({ data: [
    { project_id: equipe.id, user_id: ids.analista, role: 'member' },
    { project_id: fora.id, user_id: ids.fora, role: 'member' },
  ] })
  const open = await prisma.projectStatus.findFirstOrThrow({ where: { project_id: equipe.id, category: 'open' } })
  const task = await createTask(equipe.id, ids.dono, { title: 'Task do dossiê', statusId: open.id })

  // Dois chamados na mesma task; a carteira do gerente só tem a empresa do primeiro.
  orgIds.push(
    (await prisma.organization.create({ data: { name: `Org Minha ${S}`, tier: 'bronze' } })).id,
    (await prisma.organization.create({ data: { name: `Org Alheia ${S}`, tier: 'bronze' } })).id,
  )
  await prisma.userOrgScope.create({ data: { user_id: ids.gerente, org_id: orgIds[0] } })
  for (const [i, orgId] of orgIds.entries()) {
    await prisma.ticket.create({
      data: {
        id: `TKT-${S}-${i}`, display_number: `ISA-${S}-${i}`, title: i === 0 ? `Chamado da carteira ${S}` : `Chamado alheio ${S}`, description: 'x',
        user_id: ids.dono, org_id: orgId, status: 'pending', pending_reason: 'pending_project', project_task_id: task.id,
        sla_deadline: new Date(Date.now() + 3_600_000), first_response_deadline: new Date(Date.now() + 3_600_000),
      },
    })
  }
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { org_id: { in: orgIds } } })
  await prisma.userOrgScope.deleteMany({ where: { org_id: { in: orgIds } } })
  await prisma.taskActivity.deleteMany({ where: { task: { project_id: { in: projectIds } } } })
  await prisma.task.deleteMany({ where: { project_id: { in: projectIds } } })
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: Object.values(ids) } } })
  await prisma.user.updateMany({ where: { id: { in: Object.values(ids) } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe('GET /api/projects/export', () => {
  it('gerente exporta HTML com o projeto da equipe e não com o de fora', async () => {
    const res = await request(app).get('/api/projects/export?format=html').set('Authorization', bearer('gerente', 'manager'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="dossie-projetos-\d{4}-\d{2}-\d{2}\.html"/)
    expect(res.text).toContain(`Equipe &lt;b&gt;${S}&lt;/b&gt;`)
    expect(res.text).toContain('Task do dossiê')
    expect(res.text).not.toContain(`Fora ${S}`)
    const audit = await prisma.auditLog.findFirst({ where: { user_id: ids.gerente, action: 'PROJECTS_EXPORT' } })
    expect(audit).toBeTruthy()
  })

  it('chamado fora da carteira não entra na seção de chamados: a task fica só com o número', async () => {
    const res = await request(app).get('/api/projects/export?format=html').set('Authorization', bearer('gerente', 'manager'))
    expect(res.status).toBe(200)
    expect(res.text).toContain(`Chamado da carteira ${S}`)
    expect(res.text).toContain(`Org Minha ${S}`)
    expect(res.text).not.toContain(`Chamado alheio ${S}`)
    expect(res.text).not.toContain(`Org Alheia ${S}`)
    expect(res.text).toContain(`ISA-${S}-1`)
  })

  it('relatório de chamados em projeto só lista o que a pessoa pode ler', async () => {
    const res = await request(app).get('/api/projects/linked-tickets').set('Authorization', bearer('gerente', 'manager'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual([`Chamado da carteira ${S}`])
    expect(res.body.data[0]).toMatchObject({ org: { name: `Org Minha ${S}` }, projectTask: { title: 'Task do dossiê' } })
  })

  it('exporta Excel legível de um projeto escolhido', async () => {
    const res = await request(app).get(`/api/projects/export?format=xlsx&projectIds=${projectIds[0]}`)
      .set('Authorization', bearer('gerente', 'manager')).buffer(true).parse(binary)
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    expect(wb.getWorksheet('Tasks')!.getRow(2).getCell(3).value).toBe('Task do dossiê')
  })

  it('recusa projeto fora do acesso', async () => {
    const res = await request(app).get(`/api/projects/export?format=html&projectIds=${projectIds[1]}`).set('Authorization', bearer('gerente', 'manager'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PROJECT_FORBIDDEN')
  })

  it('valida formato e período', async () => {
    expect((await request(app).get('/api/projects/export?format=pdf').set('Authorization', bearer('gerente', 'manager'))).status).toBe(400)
    expect((await request(app).get('/api/projects/export?format=html&from=15/10/2026').set('Authorization', bearer('gerente', 'manager'))).status).toBe(400)
  })

  it('analista sem a liberação "Relatórios de Projetos" não exporta', async () => {
    const res = await request(app).get('/api/projects/export?format=html').set('Authorization', bearer('analista', 'agent'))
    expect(res.status).toBe(403)
  })

  it('quem não vê nenhum projeto recebe 400 explicando', async () => {
    const lonely = (await prisma.user.create({ data: { name: `So ${S}`, email: `so-${S}@t.com`, role: 'agent', module_projects: true, permissions: ['projects_reports'] } })).id
    ids.so = lonely
    const res = await request(app).get('/api/projects/export?format=html').set('Authorization', bearer('so', 'agent'))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NO_PROJECTS')
  })
})
