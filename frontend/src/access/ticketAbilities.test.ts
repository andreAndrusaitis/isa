import { describe, it, expect } from 'vitest'
import { ticketAbilities } from './ticketAbilities'

const u = (role: string, extra: Record<string, unknown> = {}) => ({ id: 'me', role, permissions: [], modules: { tickets: true, projects: false }, queues: ['geral'], ...extra }) as any
const t = (extra: Record<string, unknown> = {}) => ({ status: 'in_progress', queue: 'geral', escalated: false, ...extra }) as any

describe('ticketAbilities', () => {
  it('admin só olha: não atua, não modera, mas exclui', () => {
    const a = ticketAbilities(u('admin'), t(), { isOwner: false })
    expect(a).toMatchObject({ act: false, reassign: false, revert: false, moderate: false, aiActions: false, useProjects: false, delete: true })
  })
  it('colaborador escalonado altera mas não troca o responsável', () => {
    const a = ticketAbilities(u('agent'), t(), { isOwner: false, participation: { role: 'collaborator' } })
    expect(a).toMatchObject({ act: true, collaboratorOnly: true, reassign: false })
  })
  it('analista entra como colaborador num chamado escalonado para a fila dele', () => {
    expect(ticketAbilities(u('agent'), t({ escalated: true }), { isOwner: false }).join).toBe(true)
    expect(ticketAbilities(u('agent'), t({ escalated: true, status: 'resolved' }), { isOwner: false }).join).toBe(false)
    expect(ticketAbilities(u('supervisor'), t({ escalated: true }), { isOwner: false }).join).toBe(false)
  })
  it('desfazer escalonamento: responsável ou gestão', () => {
    expect(ticketAbilities(u('agent'), t(), { isOwner: true }).revert).toBe(true)
    expect(ticketAbilities(u('agent'), t(), { isOwner: false }).revert).toBe(false)
    expect(ticketAbilities(u('manager'), t(), { isOwner: false }).revert).toBe(true)
  })
  it('moderar mensagens: TM por padrão, opção da ficha para os demais', () => {
    expect(ticketAbilities(u('supervisor'), t(), { isOwner: false }).moderate).toBe(true)
    expect(ticketAbilities(u('agent', { permissions: ['edit_messages'] }), t(), { isOwner: false }).moderate).toBe(true)
    expect(ticketAbilities(u('manager'), t(), { isOwner: false }).moderate).toBe(false)
  })
})
