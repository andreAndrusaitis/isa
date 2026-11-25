import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import api from './api'
import { knowledgeService } from './knowledgeService'

const mocked = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>

beforeEach(() => vi.clearAllMocks())

describe('knowledgeService', () => {
  it('lista com os filtros e devolve o envelope da API', async () => {
    const body = { data: [{ id: 'a1' }], total: 1, page: 2, pageSize: 25 }
    mocked.get.mockResolvedValue({ data: body })
    await expect(knowledgeService.list({ page: 2, pageSize: 25, status: 'draft' })).resolves.toEqual(body)
    expect(mocked.get).toHaveBeenCalledWith('/knowledge', { params: { page: 2, pageSize: 25, status: 'draft' } })
  })

  it('lê o artigo completo pelo id', async () => {
    mocked.get.mockResolvedValue({ data: { data: { id: 'a1', content: 'texto' } } })
    await expect(knowledgeService.get('a1')).resolves.toEqual({ id: 'a1', content: 'texto' })
    expect(mocked.get).toHaveBeenCalledWith('/knowledge/a1')
  })

  it('escreve e publica nas rotas do contrato', async () => {
    mocked.post.mockResolvedValue({ data: { data: { id: 'a1' } } })
    mocked.put.mockResolvedValue({ data: { data: { id: 'a1' } } })
    mocked.delete.mockResolvedValue({})
    await knowledgeService.create({ title: 't', content: 'c', categoryIds: [] })
    await knowledgeService.update('a1', { title: 't', content: 'c', categoryIds: ['c1'] })
    await knowledgeService.publish('a1')
    await knowledgeService.unpublish('a1')
    await knowledgeService.remove('a1')
    expect(mocked.post).toHaveBeenCalledWith('/knowledge', { title: 't', content: 'c', categoryIds: [] })
    expect(mocked.put).toHaveBeenCalledWith('/knowledge/a1', { title: 't', content: 'c', categoryIds: ['c1'] })
    expect(mocked.post).toHaveBeenCalledWith('/knowledge/a1/publish')
    expect(mocked.post).toHaveBeenCalledWith('/knowledge/a1/unpublish')
    expect(mocked.delete).toHaveBeenCalledWith('/knowledge/a1')
  })

  it('importa mandando nome e data URI em base64', async () => {
    mocked.post.mockResolvedValue({ data: { data: { id: 'a1' } } })
    await knowledgeService.importFile(new File(['oi'], 'nota.txt', { type: 'text/plain' }))
    expect(mocked.post).toHaveBeenCalledWith('/knowledge/import', { fileName: 'nota.txt', dataUri: 'data:text/plain;base64,b2k=' })
  })
})
