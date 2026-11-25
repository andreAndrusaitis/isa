import { describe, it, expect } from 'vitest'
import { SCREENS, pathForView, viewForPath } from './routes'
import { homeOf, legacyHomeOf } from '@/utils/home'

describe('endereços das telas', () => {
  it('cada tela tem um endereço único e ida e volta batem', () => {
    const paths = SCREENS.map(s => s.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const s of SCREENS) {
      expect(pathForView(s.view)).toBe(s.path)
      expect(viewForPath(s.path)).toBe(s.view)
    }
  })

  it('filas têm endereço próprio', () => {
    expect(pathForView('queue_geral')).toBe('/chamados/filas/geral')
    expect(viewForPath('/chamados/filas/geral')).toBe('queue_geral')
    expect(viewForPath('/chamados/filas/todas')).toBe('queue')
  })

  it('base de conhecimento tem endereço próprio em Sistema', () => {
    expect(pathForView('admin_knowledge')).toBe('/admin/ia/conhecimento')
    expect(viewForPath('/admin/ia/conhecimento')).toBe('admin_knowledge')
  })

  it('telas antigas sem endereço caem na equivalente', () => {
    expect(pathForView('queue_all')).toBe('/chamados/filas/todas')
    expect(pathForView('dashboard')).toBe('/gestao/dashboard')
    expect(pathForView('desconhecida')).toBeNull()
  })

  it('raiz de área sem tela e barra no fim', () => {
    expect(viewForPath('/gestao')).toBeNull()
    expect(viewForPath('/configuracoes/sla/')).toBe('admin_sla')
  })
})

describe('tela inicial', () => {
  const on = { tickets: true, projects: false }
  it('usa a do servidor', () => {
    expect(homeOf({ role: 'agent', modules: on, home: '/chamados' })).toBe('/chamados')
  })
  it('sessão antiga (home de antes) recalcula em vez de entrar em laço', () => {
    expect(homeOf({ role: 'manager', modules: on, home: '/supervisor' })).toBe('/gestao/carteira')
    expect(homeOf({ role: 'supervisor', modules: on, home: '/gestao/dashboard' })).toBe('/gestao/turno')
    expect(homeOf({ role: 'user', modules: on, home: '/portal' })).toBe('/solicitacoes')
  })
  it('regra local igual à do servidor', () => {
    expect(legacyHomeOf({ role: 'agent', modules: on })).toBe('/chamados')
    expect(legacyHomeOf({ role: 'manager', modules: { tickets: false, projects: true } })).toBe('/projetos/semana')
    expect(legacyHomeOf({ role: 'admin', modules: on })).toBe('/gestao/dashboard')
    expect(legacyHomeOf({ role: 'manager', modules: on, capabilities: [] })).toBe('/chamados')
  })
})
