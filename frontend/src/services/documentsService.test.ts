import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

import api from './api'
import { createDocument, listDocuments } from './documentsService'

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> }

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
})

describe('documentsService', () => {
  it('listDocuments calls the project-scoped endpoint', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [{ id: 'doc-1' }] } })
    const result = await listDocuments('proj-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/projects/proj-1/docs')
    expect(result).toEqual([{ id: 'doc-1' }])
  })

  it('createDocument posts blocks content', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { id: 'doc-1' } } })
    const result = await createDocument('proj-1', { title: 'Runbook', content: [{ type: 'heading', text: 'Runbook' }] })
    expect(mockedApi.post).toHaveBeenCalledWith('/projects/proj-1/docs', { title: 'Runbook', content: [{ type: 'heading', text: 'Runbook' }] })
    expect(result).toEqual({ id: 'doc-1' })
  })
})
