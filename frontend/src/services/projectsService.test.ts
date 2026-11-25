import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './api'
import {
  updateProject, archiveProject, listMembers, updateMemberRole,
  removeMember, listFolders, createFolder, listLists, createList,
} from './projectsService'

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

describe('projectsService — funções ampliadas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updateProject faz PATCH /projects/:id e retorna data.data', async () => {
    ;(api.patch as any).mockResolvedValue({ data: { data: { id: 'p1', name: 'Novo nome' } } })
    const result = await updateProject('p1', { name: 'Novo nome' })
    expect(api.patch).toHaveBeenCalledWith('/projects/p1', { name: 'Novo nome' })
    expect(result).toEqual({ id: 'p1', name: 'Novo nome' })
  })

  it('archiveProject faz DELETE /projects/:id', async () => {
    ;(api.delete as any).mockResolvedValue({})
    await archiveProject('p1')
    expect(api.delete).toHaveBeenCalledWith('/projects/p1')
  })

  it('listMembers faz GET /projects/:id/members', async () => {
    ;(api.get as any).mockResolvedValue({ data: { data: [{ userId: 'u1' }] } })
    const result = await listMembers('p1')
    expect(api.get).toHaveBeenCalledWith('/projects/p1/members')
    expect(result).toEqual([{ userId: 'u1' }])
  })

  it('updateMemberRole faz PATCH /projects/:id/members/:userId', async () => {
    ;(api.patch as any).mockResolvedValue({ data: { data: { userId: 'u1', role: 'manager' } } })
    const result = await updateMemberRole('p1', 'u1', 'manager')
    expect(api.patch).toHaveBeenCalledWith('/projects/p1/members/u1', { role: 'manager' })
    expect(result).toEqual({ userId: 'u1', role: 'manager' })
  })

  it('removeMember faz DELETE /projects/:id/members/:userId', async () => {
    ;(api.delete as any).mockResolvedValue({})
    await removeMember('p1', 'u1')
    expect(api.delete).toHaveBeenCalledWith('/projects/p1/members/u1')
  })

  it('listFolders faz GET /projects/:id/folders', async () => {
    ;(api.get as any).mockResolvedValue({ data: { data: [] } })
    await listFolders('p1')
    expect(api.get).toHaveBeenCalledWith('/projects/p1/folders')
  })

  it('createFolder faz POST /projects/:id/folders', async () => {
    ;(api.post as any).mockResolvedValue({ data: { data: { id: 'f1', name: 'Sprint 1' } } })
    const result = await createFolder('p1', 'Sprint 1')
    expect(api.post).toHaveBeenCalledWith('/projects/p1/folders', { name: 'Sprint 1' })
    expect(result).toEqual({ id: 'f1', name: 'Sprint 1' })
  })

  it('listLists faz GET /projects/:id/lists', async () => {
    ;(api.get as any).mockResolvedValue({ data: { data: [] } })
    await listLists('p1')
    expect(api.get).toHaveBeenCalledWith('/projects/p1/lists')
  })

  it('createList faz POST /projects/:id/lists', async () => {
    ;(api.post as any).mockResolvedValue({ data: { data: { id: 'l1', name: 'Backlog' } } })
    const result = await createList('p1', { name: 'Backlog', folderId: 'f1' })
    expect(api.post).toHaveBeenCalledWith('/projects/p1/lists', { name: 'Backlog', folderId: 'f1' })
    expect(result).toEqual({ id: 'l1', name: 'Backlog' })
  })
})
