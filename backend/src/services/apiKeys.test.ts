import { afterAll, afterEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import {
  createApiKey, updateApiKey, deleteApiKey, regenerateApiKey, listApiKeys, hashApiKey, listScopes,
} from './apiKeys'

const SUFFIX = `apikeys-${Date.now()}`
const createdIds: string[] = []

afterEach(async () => {
  if (createdIds.length > 0) {
    await prisma.apiRequestLog.deleteMany({ where: { api_key_id: { in: createdIds } } }).catch(() => undefined)
    await prisma.apiKey.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined)
    createdIds.length = 0
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('listScopes', () => {
  it('retorna o catálogo fixo de escopos', () => {
    expect(listScopes()).toContain('create_ticket')
    expect(listScopes()).toContain('read_subcategories')
  })
})

describe('createApiKey', () => {
  it('cria a key, retorna o valor pleno uma única vez e nunca grava em texto puro', async () => {
    const created = await createApiKey({ name: `Key ${SUFFIX}`, scopes: ['create_ticket', 'read_categories'] })
    createdIds.push(created.id)

    expect(created.key).toMatch(/^isakey_/)
    expect((created as any).key_hash).toBeUndefined()
    expect(created.key_prefix).toBe(created.key!.slice(0, 11))

    const stored = await prisma.apiKey.findUnique({ where: { id: created.id } })
    expect(stored?.key_hash).toBe(hashApiKey(created.key!))
    expect(stored?.key_hash).not.toBe(created.key)
  })

  it('rejeita org_id que não existe', async () => {
    await expect(
      createApiKey({ name: `Key ${SUFFIX} org invalida`, scopes: ['create_ticket'], org_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/não existe ou está inativa/)
  })
})

describe('updateApiKey / deleteApiKey / regenerateApiKey', () => {
  it('atualiza escopos e status', async () => {
    const created = await createApiKey({ name: `Key ${SUFFIX} update`, scopes: ['create_ticket'] })
    createdIds.push(created.id)

    const updated = await updateApiKey(created.id, { scopes: ['create_ticket', 'update_ticket'], active: false })
    expect(updated.scopes).toEqual(['create_ticket', 'update_ticket'])
    expect(updated.active).toBe(false)
  })

  it('regenera a key — hash muda e o valor pleno só aparece na resposta', async () => {
    const created = await createApiKey({ name: `Key ${SUFFIX} regen`, scopes: ['create_ticket'] })
    createdIds.push(created.id)

    const before = await prisma.apiKey.findUnique({ where: { id: created.id } })
    const regenerated = await regenerateApiKey(created.id)
    const after = await prisma.apiKey.findUnique({ where: { id: created.id } })

    expect(regenerated.key).toMatch(/^isakey_/)
    expect(regenerated.key).not.toBe(created.key)
    expect(after?.key_hash).not.toBe(before?.key_hash)
  })

  it('exclui a key', async () => {
    const created = await createApiKey({ name: `Key ${SUFFIX} delete`, scopes: ['create_ticket'] })
    await deleteApiKey(created.id)

    const stored = await prisma.apiKey.findUnique({ where: { id: created.id } })
    expect(stored).toBeNull()
  })
})

describe('listApiKeys', () => {
  it('lista sem expor key_hash', async () => {
    const created = await createApiKey({ name: `Key ${SUFFIX} list`, scopes: ['create_ticket'] })
    createdIds.push(created.id)

    const keys = await listApiKeys()
    const found = keys.find(k => k.id === created.id)
    expect(found).toBeTruthy()
    expect((found as any).key_hash).toBeUndefined()
    expect(found?.requests_count).toBe(0)
  })
})
