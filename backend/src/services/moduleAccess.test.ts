import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import { getEffectiveModules } from './moduleAccess'

type Row = { role?: string; manager_id?: string | null; module_tickets?: boolean | null; module_projects?: boolean | null; module_documents?: boolean | null }
const db = (rows: Record<string, Row>) =>
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
    const r = rows[where.id]
    return Promise.resolve(r ? { role: 'agent', manager_id: null, module_tickets: null, module_projects: null, module_documents: null, ...r } : null)
  })

beforeEach(() => vi.clearAllMocks())

describe('módulos efetivos', () => {
  it('admin tudo; cliente final só Chamados', async () => {
    expect(await getEffectiveModules('x', 'admin')).toEqual({ tickets: true, projects: true, documents: true })
    expect(await getEffectiveModules('x', 'user')).toEqual({ tickets: true, projects: false, documents: false })
  })

  it('gerente sem botões gravados: Chamados ligado, Projetos desligado', async () => {
    db({ g: { role: 'manager' } })
    expect(await getEffectiveModules('g', 'manager')).toEqual({ tickets: true, projects: false, documents: false })
  })

  it('gerente só de projetos', async () => {
    db({ g: { role: 'manager', module_tickets: false, module_projects: true } })
    expect(await getEffectiveModules('g', 'manager')).toEqual({ tickets: false, projects: true, documents: false })
  })

  it('analista herda os dois botões do gerente da cadeia (via TM)', async () => {
    db({
      a: { manager_id: 'tm' },
      tm: { role: 'supervisor', manager_id: 'g' },
      g: { role: 'manager', module_tickets: false, module_projects: true },
    })
    expect(await getEffectiveModules('a', 'agent')).toEqual({ tickets: false, projects: true, documents: false })
  })

  it('gravar só Projetos não congela Chamados: Chamados continua herdando', async () => {
    db({
      a: { manager_id: 'g', module_projects: false },
      g: { role: 'manager', module_tickets: false, module_projects: true },
    })
    expect(await getEffectiveModules('a', 'agent')).toEqual({ tickets: false, projects: false, documents: false })
  })

  it('Documentos: padrão desligado, herda do gerente e a exceção própria vence', async () => {
    db({ a: { manager_id: 'g' }, b: { manager_id: 'g', module_documents: false }, g: { role: 'manager', module_documents: true } })
    expect((await getEffectiveModules('a', 'agent')).documents).toBe(true)
    expect((await getEffectiveModules('b', 'agent')).documents).toBe(false)
    db({ a: { manager_id: 'g' }, g: { role: 'manager' } })
    expect((await getEffectiveModules('a', 'agent')).documents).toBe(false)
  })

  it('exceção própria vence a herança, botão a botão', async () => {
    db({
      a: { manager_id: 'g', module_tickets: true },
      g: { role: 'manager', module_tickets: false, module_projects: true },
    })
    expect(await getEffectiveModules('a', 'agent')).toEqual({ tickets: true, projects: true, documents: false })
  })
})
