import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from './api'
import {
  createTask, listTasks, updateTask,
  listChecklist, createChecklistItem, toggleChecklistItem, deleteChecklistItem,
  listComments, createComment,
} from './tasksService'

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
})

describe('tasksService', () => {
  it('listTasks calls the project-scoped endpoint', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [{ id: 'task-1' }] } })
    const result = await listTasks('proj-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/projects/proj-1/tasks', { params: undefined })
    expect(result).toEqual([{ id: 'task-1' }])
  })

  it('createTask posts to the project-scoped endpoint', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { id: 'task-1' } } })
    const result = await createTask('proj-1', { title: 'Nova', statusId: 'status-1' })
    expect(mockedApi.post).toHaveBeenCalledWith('/projects/proj-1/tasks', { title: 'Nova', statusId: 'status-1' })
    expect(result).toEqual({ id: 'task-1' })
  })

  it('updateTask patches the task-scoped endpoint', async () => {
    mockedApi.patch.mockResolvedValue({ data: { data: { id: 'task-1', statusId: 'status-2' } } })
    const result = await updateTask('proj-1', 'task-1', { statusId: 'status-2' })
    expect(mockedApi.patch).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1', { statusId: 'status-2' })
    expect(result.statusId).toBe('status-2')
  })

  it('listChecklist calls the checklist endpoint via getTask (embedded) — falls back to task.checklist', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: { id: 'task-1', checklist: [{ id: 'c1', text: 'Item 1', done: false }] } } })
    const result = await listChecklist('proj-1', 'task-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1')
    expect(result).toEqual([{ id: 'c1', text: 'Item 1', done: false }])
  })

  it('createChecklistItem posts to the checklist endpoint', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { id: 'c1', text: 'Novo item' } } })
    const result = await createChecklistItem('proj-1', 'task-1', 'Novo item')
    expect(mockedApi.post).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1/checklist', { text: 'Novo item' })
    expect(result).toEqual({ id: 'c1', text: 'Novo item' })
  })

  it('toggleChecklistItem patches the item endpoint', async () => {
    mockedApi.patch.mockResolvedValue({ data: { data: { id: 'c1', done: true } } })
    const result = await toggleChecklistItem('proj-1', 'task-1', 'c1', true)
    expect(mockedApi.patch).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1/checklist/c1', { done: true })
    expect(result).toEqual({ id: 'c1', done: true })
  })

  it('deleteChecklistItem deletes the item endpoint', async () => {
    mockedApi.delete.mockResolvedValue({})
    await deleteChecklistItem('proj-1', 'task-1', 'c1')
    expect(mockedApi.delete).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1/checklist/c1')
  })

  it('listComments calls the comments endpoint', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [{ id: 'com1', body: 'Oi' }] } })
    const result = await listComments('proj-1', 'task-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1/comments')
    expect(result).toEqual([{ id: 'com1', body: 'Oi' }])
  })

  it('createComment posts to the comments endpoint', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { id: 'com1', body: 'Novo comentário' } } })
    const result = await createComment('proj-1', 'task-1', 'Novo comentário')
    expect(mockedApi.post).toHaveBeenCalledWith('/projects/proj-1/tasks/task-1/comments', { body: 'Novo comentário' })
    expect(result).toEqual({ id: 'com1', body: 'Novo comentário' })
  })
})
