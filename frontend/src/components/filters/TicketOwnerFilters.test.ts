import { describe, it, expect } from 'vitest'
import { assigneeParams, visibleAssignees } from './TicketOwnerFilters'
import type { User } from '@/types'

const u = (id: string, role: string, manager_id: string | null = null) => ({ id, name: id, role, manager_id }) as User
// gerente G → TM T → analistas A1, A2; outro gerente H → analista B
const users = [u('G', 'manager'), u('T', 'supervisor', 'G'), u('A1', 'agent', 'T'), u('A2', 'agent', 'T'), u('H', 'manager'), u('B', 'agent', 'H'), u('C', 'user')]
const ids = (me: { id: string; role: string }) => visibleAssignees(users, me).map((x) => x.id).sort()

describe('visibleAssignees', () => {
  it('gerente vê a hierarquia inteira, não só diretos', () => expect(ids({ id: 'G', role: 'manager' })).toEqual(['A1', 'A2', 'T']))
  it('TM vê o próprio time', () => expect(ids({ id: 'T', role: 'supervisor' })).toEqual(['A1', 'A2']))
  it('analista vê os colegas do time', () => expect(ids({ id: 'A1', role: 'agent' })).toEqual(['A2']))
  it('admin vê toda a equipe (sem clientes)', () => expect(ids({ id: 'X', role: 'admin' })).toEqual(['A1', 'A2', 'B', 'G', 'H', 'T']))
})

describe('assigneeParams', () => {
  it('"Meus" vira o próprio id e "Sem responsável" vira unassigned', () => {
    expect(assigneeParams('all', 'me1')).toEqual({ assignedToId: undefined, unassigned: undefined })
    expect(assigneeParams('me,A2,none', 'me1')).toEqual({ assignedToId: 'me1,A2', unassigned: true })
    expect(assigneeParams('none', 'me1')).toEqual({ assignedToId: undefined, unassigned: true })
  })
})
