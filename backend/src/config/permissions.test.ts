import { describe, it, expect } from 'vitest'
import { userHasPermission, DELETE_TICKETS_PERMISSION, DEFAULT_ROLE_PERMISSIONS, SYSTEM_PERMISSIONS } from './permissions'
import { resolvePermissionGrant, isKnownPermission } from '../access/grants'

describe('delete_tickets permission', () => {
  it('é concedida sempre ao admin e desabilitada por padrão para os demais perfis', () => {
    expect(userHasPermission({ role: 'admin', permissions: [] }, DELETE_TICKETS_PERMISSION)).toBe(true)
    for (const role of ['manager', 'supervisor', 'agent', 'user']) {
      expect(userHasPermission({ role, permissions: [] }, DELETE_TICKETS_PERMISSION)).toBe(false)
    }
  })

  it('vale quando concedida explicitamente, exceto para usuário final', () => {
    for (const role of ['manager', 'supervisor', 'agent']) {
      expect(userHasPermission({ role, permissions: ['orgs', DELETE_TICKETS_PERMISSION] }, DELETE_TICKETS_PERMISSION)).toBe(true)
    }
    expect(userHasPermission({ role: 'user', permissions: [DELETE_TICKETS_PERMISSION] }, DELETE_TICKETS_PERMISSION)).toBe(false)
  })
})

// Acesso a Projetos não é mais permissão de tela: é módulo por carteira do
// gerente (users.module_projects + herança) — ver services/moduleAccess.ts.
describe('projetos não é permissão de tela', () => {
  it('saiu do catálogo e do padrão do gerente', () => {
    expect(SYSTEM_PERMISSIONS).not.toContain('projetos')
    expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain('projetos')
  })
})

// B2: quem não é admin só concede o que tem; nomes inválidos são recusados.
describe('resolvePermissionGrant', () => {
  const manager = { role: 'manager', permissions: [] as string[] } // padrão do cargo
  const agent = { role: 'agent', permissions: [] as string[] }

  it('reconhece as 26 áreas e delete_tickets, e nada além', () => {
    expect(SYSTEM_PERMISSIONS).toHaveLength(26)
    for (const p of SYSTEM_PERMISSIONS) expect(isKnownPermission(p)).toBe(true)
    expect(isKnownPermission(DELETE_TICKETS_PERMISSION)).toBe(true)
    expect(isKnownPermission('superpoder')).toBe(false)
  })

  it('recusa nome desconhecido novo, até para o admin', () => {
    expect(resolvePermissionGrant({ role: 'admin' }, agent, ['superpoder'])).toEqual({ unknown: ['superpoder'] })
  })

  it('descarta nome legado já gravado em vez de travar o salvamento', () => {
    const target = { role: 'agent', permissions: ['orgs', 'antigo'] }
    expect(resolvePermissionGrant(manager, target, ['orgs', 'antigo', 'macros'])).toEqual({ permissions: ['orgs', 'macros'] })
  })

  it('gerente não concede área que ele não tem', () => {
    expect(resolvePermissionGrant(manager, agent, ['orgs', 'webhooks'])).toEqual({ notOwned: ['webhooks'] })
  })

  it('gerente concede área que tem pelo padrão do cargo', () => {
    expect(resolvePermissionGrant(manager, agent, ['orgs', 'users', 'macros'])).toEqual({ permissions: ['orgs', 'users', 'macros'] })
  })

  it('preserva o que o alvo já tem e o solicitante não tem (inclusive delete_tickets)', () => {
    const target = { role: 'agent', permissions: ['orgs', 'webhooks', DELETE_TICKETS_PERMISSION] }
    const r = resolvePermissionGrant(manager, target, ['orgs'])
    expect('permissions' in r && r.permissions.sort()).toEqual([DELETE_TICKETS_PERMISSION, 'orgs', 'webhooks'].sort())
  })

  it('alvo no padrão do cargo não perde área que o solicitante não tem', () => {
    const custom = { role: 'manager', permissions: ['orgs', 'users', 'macros'] } // sem audit
    const supervisor = { role: 'supervisor', permissions: [] as string[] }
    const r = resolvePermissionGrant(custom, supervisor, [...DEFAULT_ROLE_PERMISSIONS.supervisor])
    expect('permissions' in r && r.permissions).toContain('audit')
  })

  it('área de plataforma só o admin concede, mesmo a quem a tem explícita', () => {
    const withWebhooks = { role: 'manager', permissions: ['orgs', 'users', 'webhooks'] }
    expect(resolvePermissionGrant(withWebhooks, agent, ['orgs', 'webhooks'])).toEqual({ notOwned: ['webhooks'] })
  })

  it('só o admin concede delete_tickets', () => {
    expect(resolvePermissionGrant(manager, agent, [DELETE_TICKETS_PERMISSION])).toEqual({ notOwned: [DELETE_TICKETS_PERMISSION] })
    expect(resolvePermissionGrant({ role: 'admin' }, agent, [DELETE_TICKETS_PERMISSION])).toEqual({ permissions: [DELETE_TICKETS_PERMISSION] })
  })
})
