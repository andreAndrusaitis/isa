import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { authenticateProjectApiToken, createProjectApiKey } from './projectApiKeys'

// Banco real. A chave vale o que o dono ainda pode: perdeu o módulo, a liberação ou
// virou cliente, ela para de funcionar mesmo com as linhas de membro intactas.
const S = `pak-${Date.now()}`
const userIds: string[] = []
const keyIds: string[] = []
const serviceUserIds: string[] = []
let projectId: string

async function mkUser(key: string, data: Record<string, any>) {
  const user = await prisma.user.create({ data: { name: `${key} ${S}`, email: `${key}-${S}@t.local`, ...data } as any })
  userIds.push(user.id)
  await prisma.projectMember.create({ data: { project_id: projectId, user_id: user.id, role: 'manager' } })
  return user
}

async function mkKey(creatorId: string) {
  const { key, ...created } = await createProjectApiKey(creatorId, {
    name: `Chave ${S} ${keyIds.length}`, scopes: ['read_tasks'], active: true, projectIds: [projectId],
  })
  keyIds.push(created.id)
  serviceUserIds.push(created.service_user_id)
  return key
}

const invalid = { statusCode: 401, code: 'API_KEY_INVALID' }

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { name: `dono ${S}`, email: `dono-${S}@t.local`, role: 'manager' } })
  userIds.push(owner.id)
  projectId = (await prisma.project.create({ data: { name: `P ${S}`, owner_id: owner.id } as any })).id
})

afterAll(async () => {
  await prisma.projectApiKey.deleteMany({ where: { id: { in: keyIds } } })
  await prisma.projectMember.deleteMany({ where: { project_id: projectId } })
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.user.deleteMany({ where: { id: { in: [...userIds, ...serviceUserIds] } } })
})

describe('authenticateProjectApiToken confere o dono da chave a cada requisição', () => {
  it('Gerente com o módulo usa a chave no papel dele', async () => {
    const user = await mkUser('gerente', { role: 'manager', module_projects: true })
    const ctx = await authenticateProjectApiToken(await mkKey(user.id))
    expect(ctx.projectIds).toEqual([projectId])
    expect(ctx.roles[projectId]).toBe('manager')
  })

  it('recusa quando o dono perde o módulo Projetos e volta quando ele é religado', async () => {
    const user = await mkUser('semmodulo', { role: 'manager', module_projects: true })
    const key = await mkKey(user.id)

    await prisma.user.update({ where: { id: user.id }, data: { module_projects: false } })
    await expect(authenticateProjectApiToken(key)).rejects.toMatchObject(invalid)

    await prisma.user.update({ where: { id: user.id }, data: { module_projects: true } })
    await expect(authenticateProjectApiToken(key)).resolves.toBeTruthy()
  })

  it('chave de Analista sem a liberação de integrações segue valendo: ela é regra para criar', async () => {
    const user = await mkUser('analista', { role: 'agent', module_projects: true, permissions: [] })
    const key = await mkKey(user.id)
    await expect(authenticateProjectApiToken(key)).resolves.toBeTruthy()
  })

  it('recusa quando o dono vira cliente', async () => {
    const user = await mkUser('rebaixado', { role: 'manager', module_projects: true })
    const key = await mkKey(user.id)

    await prisma.user.update({ where: { id: user.id }, data: { role: 'user' } })
    await expect(authenticateProjectApiToken(key)).rejects.toMatchObject(invalid)
  })

  it('admin não depende de módulo nem de liberação', async () => {
    const user = await mkUser('admin', { role: 'admin', module_projects: false })
    await expect(authenticateProjectApiToken(await mkKey(user.id))).resolves.toBeTruthy()
  })
})
