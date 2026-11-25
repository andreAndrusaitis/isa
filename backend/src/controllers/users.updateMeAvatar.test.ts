import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import app from '../app'
import prisma from '../config/prisma'
import { blobEnabled } from '../config/blob'

const SUFFIX = `avatar-${Date.now()}`
let userId: string
let orgId: string
let accessToken: string
const PASSWORD = 'senha-123456'
// PNG 1x1 transparente
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Avatar Org ${SUFFIX}`, tier: 'bronze' },
  })
  orgId = org.id

  const hashed = await bcrypt.hash(PASSWORD, 10)
  const user = await prisma.user.create({
    data: { name: `Avatar User ${SUFFIX}`, email: `av-${SUFFIX}@t.com`, password: hashed, role: 'user', org_id: orgId },
  })
  userId = user.id
  const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })
  accessToken = loginRes.body.data.accessToken
})

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user_id: userId } })
  await prisma.auditLog.deleteMany({ where: { user_id: userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.organization.delete({ where: { id: orgId } })
})

describe('PATCH /api/users/me com avatar em data URI', () => {
  it('salva o avatar e devolve uma URL de leitura (ou o data URI intacto quando blob desabilitado)', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatar: TINY_PNG })

    expect(res.status).toBe(200)
    expect(res.body.data.avatar).toBeTruthy()

    if (blobEnabled) {
      // Blob real configurado: espera URL assinada do Azure, não o data URI cru.
      expect(res.body.data.avatar.startsWith('data:')).toBe(false)
      expect(res.body.data.avatar).toContain('blob.core.windows.net')
    } else {
      // Sem blob configurado (dev local sem Azure): comportamento legado, guarda o data URI.
      expect(res.body.data.avatar).toBe(TINY_PNG)
    }

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (blobEnabled) {
      expect(stored.avatar?.startsWith('data:')).toBe(false)
    } else {
      expect(stored.avatar).toBe(TINY_PNG)
    }
  })
})
