import { describe, it, expect } from 'vitest'
import { buildMenu, type NavEntry } from './menu'

const input = { queues: [{ id: 'geral', name: 'Geral' }, { id: 'vip', name: 'VIP' }], counts: { my: 2, total: 9, geral: 4 } }
const on = { tickets: true, projects: false }
const labels = (nav: NavEntry[]) => nav.map(e => ('section' in e ? `#${e.section}` : e.label))

describe('menu único', () => {
  it('analista: chamados das filas dele, cadastros pelo padrão do cargo, sem gestão', () => {
    const nav = labels(buildMenu({ role: 'agent', permissions: [], modules: on, queues: ['geral'] }, input))
    expect(nav).toEqual(['Minhas solicitações', '#Chamados', 'Meus chamados', 'Todos os chamados', 'Geral', '#Cadastros', 'Empresas', 'Usuários'])
  })

  it('gerente: painéis, equipe e configurações do cargo', () => {
    const nav = labels(buildMenu({ role: 'manager', permissions: [], modules: { tickets: true, projects: true }, queues: [] }, input))
    expect(nav).toEqual([
      'Carteira', 'Minhas solicitações', 'Projetos', '#Chamados', 'Meus chamados', 'Todos os chamados',
      '#Gestão', 'Painel', 'Turno', 'Satisfação', 'Equipe', 'Organograma', 'Auditoria',
      '#Cadastros', 'Empresas', 'Usuários', '#Configurações', 'Filas', 'Categorias', 'Respostas prontas',
    ])
  })

  it('cada cargo abre na sua pergunta; as outras telas ficam em Gestão', () => {
    const of = (role: any) => labels(buildMenu({ role, permissions: [], modules: on, queues: [] }, input))
    expect(of('supervisor')[0]).toBe('Turno')
    expect(of('supervisor').slice(of('supervisor').indexOf('#Gestão'))).toContain('Carteira')
    expect(of('manager')[0]).toBe('Carteira')
    expect(of('agent')).not.toContain('Turno')
  })

  it('gerente só de projetos: sem chamados e sem painéis de chamados', () => {
    const nav = labels(buildMenu({ role: 'manager', permissions: [], modules: { tickets: false, projects: true }, queues: [] }, input))
    expect(nav).not.toContain('#Chamados')
    expect(nav).not.toContain('Painel')
    expect(nav).toContain('Projetos')
    expect(nav).toContain('Minhas solicitações')
    expect(nav).not.toContain('Carteira')
  })

  it('admin: tudo, mesmos nomes da equipe, sem Meus chamados', () => {
    const nav = labels(buildMenu({ role: 'admin', permissions: [], modules: { tickets: true, projects: true }, queues: [] }, input))
    expect(nav).toContain('Empresas')
    expect(nav).not.toContain('Organizações')
    expect(nav).toContain('Agentes de IA')
    expect(nav).toContain('E-mail')
    expect(nav).not.toContain('Meus chamados')
    expect(nav).not.toContain('Minhas solicitações')
    expect(nav).toContain('Saúde do sistema')
  })

  it('base de conhecimento fica em Configurações, só para o admin', () => {
    const admin = labels(buildMenu({ role: 'admin', permissions: [], modules: on, queues: [] }, input))
    expect(admin.slice(admin.indexOf('#Configurações'))).toContain('Base de conhecimento')
    for (const role of ['manager', 'supervisor', 'agent', 'user'] as const) {
      expect(labels(buildMenu({ role, permissions: ['admin_ai', 'email_logs'], modules: on, queues: [] }, input))).not.toContain('Base de conhecimento')
    }
  })

  it('analista com Logs de e-mail liberado vê a tela em Configurações', () => {
    const nav = labels(buildMenu({ role: 'agent', permissions: ['orgs', 'users', 'email_logs'], modules: on, queues: [] }, input))
    expect(nav.slice(-2)).toEqual(['#Configurações', 'E-mail'])
  })
})
