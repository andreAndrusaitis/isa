// IDOR entre projetos: o guard confere a participação no :projectId da URL;
// recursos referenciados por id (task, status, sprint, documento...) têm de
// pertencer a esse mesmo projeto. Prisma real: rodar contra banco de teste.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'

const S = `idor-${Date.now()}`
const ids: Record<string, string> = {}
let auth = ''

beforeAll(async () => {
  const me = await prisma.user.create({ data: { name: 'Membro A', email: `a-${S}@t.local`, role: 'agent', module_projects: true } })
  const other = await prisma.user.create({ data: { name: 'Dono B', email: `b-${S}@t.local`, role: 'agent', module_projects: true } })
  ids.me = me.id; ids.other = other.id
  const a = await prisma.project.create({ data: { name: `A ${S}`, owner_id: me.id, members: { create: { user_id: me.id, role: 'owner' } } } })
  const b = await prisma.project.create({ data: { name: `B ${S}`, owner_id: other.id, privacy: 'private', members: { create: { user_id: other.id, role: 'owner' } } } })
  ids.a = a.id; ids.b = b.id
  ids.statusA = (await prisma.projectStatus.create({ data: { project_id: a.id, name: 'A Fazer', color: '#999', category: 'open' } })).id
  ids.statusB = (await prisma.projectStatus.create({ data: { project_id: b.id, name: 'A Fazer', color: '#999', category: 'open' } })).id
  ids.taskB = (await prisma.task.create({ data: { project_id: b.id, status_id: ids.statusB, seq: 1, title: 'Segredo de B', creator_id: other.id } })).id
  ids.sprintB = (await prisma.sprint.create({ data: { project_id: b.id, name: 'Sprint B' } })).id
  ids.docB = (await prisma.document.create({ data: { project_id: b.id, title: 'Doc B', content: [], created_by: other.id, updated_by: other.id } })).id
  auth = `Bearer ${jwt.sign({ sub: me.id, role: 'agent', orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: [ids.a, ids.b] } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.me, ids.other] } } })
})

describe('recursos de outro projeto pela URL do meu projeto', () => {
  it('não lê task de outro projeto', async () => {
    const res = await request(app).get(`/api/projects/${ids.a}/tasks/${ids.taskB}`).set('Authorization', auth)
    expect(res.status).toBe(404)
  })

  it('não edita task de outro projeto', async () => {
    const res = await request(app).patch(`/api/projects/${ids.a}/tasks/${ids.taskB}`).set('Authorization', auth).send({ title: 'invadido' })
    expect(res.status).toBe(404)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ids.taskB } })).title).toBe('Segredo de B')
  })

  it('não lê comentários nem tempo de task de outro projeto', async () => {
    for (const path of ['comments', 'time', 'checklist']) {
      const res = await request(app).get(`/api/projects/${ids.a}/tasks/${ids.taskB}/${path}`).set('Authorization', auth)
      expect(res.status, path).toBe(404)
    }
  })

  it('não mexe em sprint nem em documento de outro projeto', async () => {
    const s = await request(app).patch(`/api/projects/${ids.a}/sprints/${ids.sprintB}`).set('Authorization', auth).send({ name: 'x' })
    expect(s.status).toBe(404)
    const d = await request(app).get(`/api/projects/${ids.a}/docs/${ids.docB}`).set('Authorization', auth)
    expect(d.status).toBe(404)
  })

  it('não cria task no meu projeto apontando para status de outro', async () => {
    const res = await request(app).post(`/api/projects/${ids.a}/tasks`).set('Authorization', auth).send({ title: 't', statusId: ids.statusB })
    expect(res.status).toBe(400)
  })

  it('não move task do meu projeto para status/sprint de outro', async () => {
    const mine = await prisma.task.create({ data: { project_id: ids.a, status_id: ids.statusA, seq: 999, title: 'Minha', creator_id: ids.me } })
    const st = await request(app).patch(`/api/projects/${ids.a}/tasks/${mine.id}`).set('Authorization', auth).send({ statusId: ids.statusB })
    expect(st.status).toBe(400)
    const sp = await request(app).patch(`/api/projects/${ids.a}/tasks/${mine.id}`).set('Authorization', auth).send({ sprintId: ids.sprintB })
    expect(sp.status).toBe(400)
  })

  it('continua funcionando dentro do próprio projeto', async () => {
    const res = await request(app).post(`/api/projects/${ids.a}/tasks`).set('Authorization', auth).send({ title: 'ok', statusId: ids.statusA })
    expect(res.status).toBe(201)
  })
})
