import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  attachment: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  taskComment: { findFirst: vi.fn(), findMany: vi.fn() },
  document: { findFirst: vi.fn() },
  taskActivity: { create: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../services/uploads', () => ({
  storeAttachment: vi.fn(async () => 'projects/2026/09/fake-blob.png'),
  presentAttachment: vi.fn((key: string) => `https://signed.example/${key}`),
}))

import projectAttachmentsRoutes from './projectAttachments'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'
import { storeAttachment } from '../services/uploads'

const app = express()
app.use(express.json({ limit: '15mb' }))
app.use('/api/projects/:projectId/files', projectAttachmentsRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
  prismaMock.task.findFirst.mockResolvedValue({ id: 'task-1' })
  prismaMock.taskComment.findFirst.mockResolvedValue(null)
  prismaMock.document.findFirst.mockResolvedValue(null)
})

describe('project attachments routes', () => {
  it('uploads a file to a task', async () => {
    prismaMock.attachment.create.mockResolvedValue({
      id: 'att-1', project_id: 'proj-1', entity_type: 'task', entity_id: 'task-1',
      file_name: 'foto.png', file_size: 10, mime_type: 'image/png', storage_key: 'projects/2026/09/fake-blob.png',
    })
    const res = await request(app)
      .post('/api/projects/proj-1/files')
      .set('Authorization', bearer('manager'))
      .send({ entityType: 'task', entityId: 'task-1', fileName: 'foto.png', dataUri: 'data:image/png;base64,AAAA' })
    expect(res.status).toBe(201)
    expect(res.body.data.url).toBe('https://signed.example/projects/2026/09/fake-blob.png')
  })

  it('lists attachments for a project with signed URLs', async () => {
    prismaMock.attachment.findMany.mockResolvedValue([
      { id: 'att-1', storage_key: 'projects/2026/09/fake-blob.png', file_name: 'foto.png', mime_type: 'image/png' },
    ])
    const res = await request(app).get('/api/projects/proj-1/files').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data[0].url).toBe('https://signed.example/projects/2026/09/fake-blob.png')
  })

  it('lista quem enviou e a task de origem, direta ou pelo comentário', async () => {
    prismaMock.attachment.findMany.mockResolvedValue([
      { id: 'a1', storage_key: 'k1', file_name: 'a.pdf', entity_type: 'task', entity_id: 't1', uploader: { id: 'u1', name: 'Ana' } },
      { id: 'a2', storage_key: 'k2', file_name: 'b.pdf', entity_type: 'comment', entity_id: 'c1', uploader: { id: 'u2', name: 'Bia' } },
      { id: 'a3', storage_key: 'k3', file_name: 'c.pdf', entity_type: 'document', entity_id: 'proj-1', uploader: { id: 'u1', name: 'Ana' } },
    ])
    prismaMock.taskComment.findMany.mockResolvedValue([{ id: 'c1', task_id: 't2' }])
    prismaMock.task.findMany.mockResolvedValue([{ id: 't1', key: 'FEAT-1', title: 'Login' }, { id: 't2', key: 'BUG-2', title: 'Erro' }])
    const res = await request(app).get('/api/projects/proj-1/files').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((d: { uploader: { name: string }; task: { key: string } | null }) => [d.uploader.name, d.task?.key ?? null]))
      .toEqual([['Ana', 'FEAT-1'], ['Bia', 'BUG-2'], ['Ana', null]])
    expect(prismaMock.task.findMany).toHaveBeenCalledTimes(1)
  })

  describe('o anexo pendura em algo do próprio projeto', () => {
    const upload = (body: object) => request(app).post('/api/projects/proj-1/files').set('Authorization', bearer('manager'))
      .send({ fileName: 'contrato-assinado.pdf', dataUri: 'data:image/png;base64,AAAA', ...body })

    it('task de outro projeto: 400, sem arquivo nem entrada no histórico dela', async () => {
      prismaMock.task.findFirst.mockResolvedValue(null)
      const res = await upload({ entityType: 'task', entityId: 'task-de-outro-projeto' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('CROSS_PROJECT_REFERENCE')
      expect(prismaMock.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-de-outro-projeto', project_id: 'proj-1' } }))
      expect(storeAttachment).not.toHaveBeenCalled()
      expect(prismaMock.attachment.create).not.toHaveBeenCalled()
      expect(prismaMock.taskActivity.create).not.toHaveBeenCalled()
    })

    it('comentário e documento de outro projeto: 400', async () => {
      expect((await upload({ entityType: 'comment', entityId: 'c-fora' })).status).toBe(400)
      expect((await upload({ entityType: 'document', entityId: 'd-fora' })).status).toBe(400)
      expect(storeAttachment).not.toHaveBeenCalled()
    })

    it('a Central de arquivos segue enviando como documento com o id do próprio projeto', async () => {
      prismaMock.attachment.create.mockResolvedValue({ id: 'att-2', storage_key: 'projects/2026/09/fake-blob.png' })
      expect((await upload({ entityType: 'document', entityId: 'proj-1' })).status).toBe(201)
    })

    it('comentário e documento do projeto passam', async () => {
      prismaMock.attachment.create.mockResolvedValue({ id: 'att-3', storage_key: 'projects/2026/09/fake-blob.png' })
      prismaMock.taskComment.findFirst.mockResolvedValue({ id: 'c-1' })
      prismaMock.document.findFirst.mockResolvedValue({ id: 'd-1' })
      expect((await upload({ entityType: 'comment', entityId: 'c-1' })).status).toBe(201)
      expect((await upload({ entityType: 'document', entityId: 'd-1' })).status).toBe(201)
    })
  })
})
