import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_PERMISSIONS, SYSTEM_AREAS } from './permissions'

// Projetos virou módulo por carteira do gerente (user.modules.projects, vindo do
// login/refresh), não mais área de permissão de tela.
describe('projetos não é área de permissão', () => {
  it('saiu do catálogo e do padrão do gerente', () => {
    expect(SYSTEM_AREAS.some(a => a.id === 'projetos')).toBe(false)
    expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain('projetos')
  })
})
