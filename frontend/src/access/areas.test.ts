import { describe, expect, it } from 'vitest'
import { areaOfPath, areaOfView, buildAreas } from './areas'

const admin = { role: 'admin' as const, permissions: [], modules: { tickets: true, projects: true, documents: true }, queues: [] }

describe('áreas da barra do topo', () => {
  it('admin: todas as áreas, na ordem, cada uma abrindo na primeira tela', () => {
    const areas = buildAreas(admin)
    expect(areas.map(a => a.id)).toEqual(['chamados', 'gestao', 'projetos', 'documentos', 'cadastros', 'configuracoes'])
    expect(areas.find(a => a.id === 'chamados')?.path).toBe('/chamados/filas/todas')
    expect(areas.find(a => a.id === 'gestao')?.path).toBe('/gestao/dashboard')
  })

  it('analista sem módulos extras não vê projetos, documentos, gestão nem sistema', () => {
    const ids = buildAreas({ role: 'agent', permissions: [], modules: { tickets: true, projects: false }, queues: [] }).map(a => a.id)
    expect(ids).toEqual(['chamados', 'cadastros', 'solicitacoes'])
  })

  it('reconhece a área pela tela e pelo endereço, inclusive de uma fila', () => {
    const areas = buildAreas(admin)
    expect(areaOfView(areas, 'admin_appearance')).toBe('configuracoes')
    expect(areaOfView(areas, 'home_health')).toBe('configuracoes')
    // Turno e Carteira: dentro de Gestão para quem não abre nelas.
    expect(areaOfView(areas, 'home_shift')).toBe('gestao')
    expect(areaOfView(areas, 'queue_geral')).toBe('chamados')
    expect(areaOfPath(areas, '/documentos/abc')).toBe('documentos')
    expect(areaOfPath(areas, '/configuracoes/sla')).toBe('configuracoes')
    expect(areaOfPath(areas, '/perfil')).toBeNull()
  })
})
