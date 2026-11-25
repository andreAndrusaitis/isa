/** Dados das telas iniciais por cargo: Turno, Carteira e Saúde. */
import api from './api'

export type DeadlineState = 'ok' | 'soon' | 'late' | 'paused'
export interface ShiftPerson { id: string; name: string; avatar: string | null; queues: string[]; active: number; late: number; soon: number; tickets: { id: string; number: string; title: string; state: DeadlineState }[] }
export interface ShiftDecision {
  id: string; number: string; title: string; priority: string; state: DeadlineState
  queueId: string | null; queue: string | null
  org: { id: string; name: string } | null
  owner: { id: string; name: string; avatar: string | null } | null
  createdAt: string; deadline: string; needsForecast: boolean
  suggestion: { id: string; name: string; avatar: string | null; active: number; otherTeam?: boolean } | null
}
export interface Shift {
  numbers: { late: number; lateTop: { name: string; count: number } | null; soon: number; unassigned: number; unassignedOldest: string | null; waiting: number }
  decisions: ShiftDecision[]
  pending: number
  repeated: { category: { id: string; name: string }; count: number; orgs: string[] }[]
  people: ShiftPerson[]
}

export interface PortfolioClient {
  org: { id: string; name: string; tier: string }
  active: number; overdue: number; paused: number
  rate: number | null; previous: number | null; done: number; late: number
  weeks: (number | null)[]
  opened: number; openedBefore: number; csat: number | null
}
export interface Portfolio {
  days: number; from: string; to: string
  total: { rate: number | null; previous: number | null; done: number; late: number; active: number }
  causes: { category: { name: string; count: number } | null; person: { name: string; count: number } | null; unassigned: number }
  csat: { score: number | null; responses: number }
  clients: PortfolioClient[]
}

export interface HealthCheck { id: string; label: string; detail: string; state: 'ok' | 'todo' | 'alert'; view: string }
export interface SystemHealth {
  checks: HealthCheck[]
  signals: { lastEmailAt: string | null; emailFailures: number; inboundFailures: number; loginFailures: number; rulesOn: number; orgs: number }
  changes: { id: string; action: string; resource: string; at: string; who: string; target: string | null }[]
}

const get = <T,>(url: string, params?: object) => api.get<{ data: T }>(url, { params }).then(r => r.data.data)

export const homesService = {
  getShift: () => get<Shift>('/dashboard/shift'),
  getPortfolio: (days = 30) => get<Portfolio>('/dashboard/portfolio', { days }),
  getHealth: () => get<SystemHealth>('/system-config/health'),
}
