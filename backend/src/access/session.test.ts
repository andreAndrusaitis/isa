import { describe, it, expect } from 'vitest'
import { homeFor } from './session'
import { capabilitiesOf, can } from './can'

const on = { tickets: true, projects: false, documents: false }

describe('tela inicial (homeFor) — endereços por área', () => {
  const dash = ['dashboard.view']
  it('cada cargo vai para a sua área', () => {
    expect(homeFor('user', on)).toBe('/solicitacoes')
    expect(homeFor('agent', on)).toBe('/chamados')
    expect(homeFor('supervisor', on, dash)).toBe('/gestao/turno')
    expect(homeFor('manager', on, dash)).toBe('/gestao/carteira')
    expect(homeFor('admin', { tickets: true, projects: true, documents: true }, dash)).toBe('/gestao/dashboard')
  })

  it('sem o painel, TM/Gerente começam pelos chamados', () => {
    expect(homeFor('manager', on, [])).toBe('/chamados')
  })

  it('equipe só de projetos vai para Projetos', () => {
    for (const role of ['agent', 'supervisor', 'manager']) {
      expect(homeFor(role, { tickets: false, projects: true, documents: true }, dash)).toBe('/projetos/semana')
    }
  })

  it('equipe só de documentos vai para Documentos', () => {
    for (const role of ['agent', 'supervisor', 'manager']) {
      expect(homeFor(role, { tickets: false, projects: false, documents: true }, dash)).toBe('/documentos')
    }
  })

  it('sem nenhum módulo: só as próprias solicitações', () => {
    expect(homeFor('manager', { tickets: false, projects: false, documents: false })).toBe('/solicitacoes')
  })
})

describe('capacidades da sessão', () => {
  it('admin tem todas; cliente final só o que o cargo dá', () => {
    expect(capabilitiesOf({ role: 'admin', modules: { tickets: true, projects: true, documents: true } })).toContain('system.admin')
    const user = capabilitiesOf({ role: 'user', permissions: [], modules: on })
    expect(user.sort()).toEqual(['orgs.view', 'tickets.create'])
  })

  it('liberação explícita soma ao cargo (D8: não retira)', () => {
    const agent = { role: 'agent', permissions: ['webhooks'], modules: on }
    expect(can(agent, 'integrations.manage')).toBe(true)
    expect(can({ role: 'manager', permissions: ['orgs'], modules: on }, 'audit.view')).toBe(true) // cargo dá, mesmo sem a área
  })

  it('Chamados desligado tira o atendimento e os painéis, mas não abrir chamado', () => {
    const off = capabilitiesOf({ role: 'manager', permissions: [], modules: { tickets: false, projects: true, documents: false } })
    expect(off).not.toContain('tickets.work')
    expect(off).not.toContain('dashboard.view')
    expect(off).toContain('tickets.create')
    expect(off).toContain('projects.use')
  })

  it('Documentos segue o módulo efetivo; cliente final nunca tem', () => {
    expect(can({ role: 'agent', modules: on }, 'documents.use')).toBe(false)
    expect(can({ role: 'agent', modules: { documents: true } }, 'documents.use')).toBe(true)
    expect(can({ role: 'user', modules: on }, 'documents.use')).toBe(false)
  })

  it('Projetos segue o módulo efetivo', () => {
    expect(can({ role: 'manager', modules: on }, 'projects.use')).toBe(false)
    expect(can({ role: 'agent', modules: { tickets: false, projects: true, documents: false } }, 'projects.use')).toBe(true)
  })
})

// Editar mensagens de outras pessoas é opção da ficha; TM vem com ela ligada.
describe('moderar mensagens (tickets.messages.moderate)', () => {
  const cap = 'tickets.messages.moderate' as const
  it('TM tem por padrão; Analista e Gerente não', () => {
    expect(can({ role: 'supervisor', permissions: [] }, cap)).toBe(true)
    expect(can({ role: 'agent', permissions: [] }, cap)).toBe(false)
    expect(can({ role: 'manager', permissions: [] }, cap)).toBe(false)
  })
  it('a ficha liga para qualquer pessoa da equipe e desliga do TM', () => {
    expect(can({ role: 'agent', permissions: ['orgs', 'edit_messages'] }, cap)).toBe(true)
    expect(can({ role: 'manager', permissions: ['edit_messages'] }, cap)).toBe(true)
    expect(can({ role: 'supervisor', permissions: ['orgs', 'users'] }, cap)).toBe(false)
  })
  it('Admin e cliente final nunca', () => {
    expect(can({ role: 'admin' }, cap)).toBe(false)
    expect(can({ role: 'user', permissions: ['edit_messages'] }, cap)).toBe(false)
  })
})
