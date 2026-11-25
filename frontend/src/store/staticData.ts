import { create } from 'zustand'
import { Category, Queue, Organization } from '@/types'
import { adminService } from '@/services/adminService'

const TTL_MS = 5 * 60 * 1000 // 5 minutos

interface StaticDataState {
  categories: Category[]
  queues: Queue[]
  orgs: Organization[]
  _catTs: number
  _queueTs: number
  _orgTs: number

  getCategories: () => Promise<Category[]>
  getQueues: () => Promise<Queue[]>
  getOrgs: () => Promise<Organization[]>
  invalidate: () => void
}

export const useStaticDataStore = create<StaticDataState>((set, get) => ({
  categories: [],
  queues: [],
  orgs: [],
  _catTs: 0,
  _queueTs: 0,
  _orgTs: 0,

  async getCategories() {
    const s = get()
    if (s.categories.length && Date.now() - s._catTs < TTL_MS) return s.categories
    const data = await adminService.getCategories()
    set({ categories: data, _catTs: Date.now() })
    return data
  },

  async getQueues() {
    const s = get()
    if (s.queues.length && Date.now() - s._queueTs < TTL_MS) return s.queues
    const data = await adminService.getQueues()
    set({ queues: data, _queueTs: Date.now() })
    return data
  },

  async getOrgs() {
    const s = get()
    if (s.orgs.length && Date.now() - s._orgTs < TTL_MS) return s.orgs
    const data = await adminService.getOrganizations()
    set({ orgs: data, _orgTs: Date.now() })
    return data
  },

  invalidate() {
    set({ _catTs: 0, _queueTs: 0, _orgTs: 0 })
  },
}))
