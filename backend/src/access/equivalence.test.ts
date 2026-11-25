// "Ninguém perde acesso": cada rota de hoje, com as travas do porteiro (requireCap),
// responde igual às travas antigas fotografadas em legacy-gates.snapshot.json
// (authorize / authorizeArea / requireModule, antes do porteiro). As duas são
// chamadas de verdade, para todo cargo × área liberada × módulos.
//
// Mudar quem acessa o quê de propósito = atualizar a foto no mesmo commit, com o
// motivo na mensagem (é o que torna a mudança visível na revisão).
//
// Mudança intencional aceita: com Chamados desligado, a equipe
// perde o atendimento. Só nesse sentido (antes deixava, agora nega), só com
// Chamados desligado e só em rotas que exigem uma das capacidades abaixo ou que
// passam pelo modo solicitante (ticketsAsRequester).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { EffectiveModules } from '../services/moduleAccess'

// As travas de módulo consultam o banco: aqui devolvem os módulos do perfil em teste.
const current = vi.hoisted(() => ({ modules: { tickets: true, projects: false, documents: false } as EffectiveModules }))
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => current.modules) }))

import { installRouteRecorder, collectRoutes, type InventoryRoute } from './routeInventory'
import { authorize, authorizeArea, requireModule, type Gate } from '../middlewares/auth'
import { SYSTEM_PERMISSIONS, DELETE_TICKETS_PERMISSION } from '../config/permissions'
import type { AccessSubject } from './can'
import { CAPABILITIES } from './capabilities'
import snapshot from './legacy-gates.snapshot.json'

installRouteRecorder()

const legacy = snapshot as unknown as Record<string, Gate[]>
const TICKETS_OFF_CAPS = ['tickets.work', 'tickets.join', 'dashboard.view', 'knowledge.metrics', 'survey.dashboard']
let routes: InventoryRoute[] = []
beforeAll(async () => {
  routes = collectRoutes((await import('../app')).default)
}, 60_000)

const ROLES = ['admin', 'manager', 'supervisor', 'agent', 'user']
const AREAS = [...SYSTEM_PERMISSIONS, DELETE_TICKETS_PERMISSION, 'email_logs']

/** Perfis: cada cargo sem liberação, com cada área sozinha, com todas, e com módulos ligados/desligados. */
function subjects(): AccessSubject[] {
  const out: AccessSubject[] = []
  for (const role of ROLES) {
    // Módulos como getEffectiveModules devolve: admin tudo; cliente final nunca Projetos/Documentos.
    const variants = role === 'admin' ? [{ tickets: true, projects: true, documents: true }]
      : role === 'user' ? [{ tickets: true, projects: false, documents: false }]
      : [
        { tickets: true, projects: false, documents: false }, { tickets: true, projects: true, documents: true },
        { tickets: false, projects: true, documents: false }, { tickets: false, projects: false, documents: true },
        { tickets: false, projects: false, documents: false },
      ]
    for (const modules of variants) {
      out.push({ sub: 'u', role, permissions: [], modules })
      out.push({ sub: 'u', role, permissions: [...AREAS], modules })
      for (const a of AREAS) out.push({ sub: 'u', role, permissions: [a], modules })
    }
  }
  return out
}

type Fn = (...args: any[]) => unknown

function legacyFn(g: Gate): Fn | null {
  if (g.kind === 'role') return authorize(...g.roles)
  if (g.kind === 'area') return authorizeArea(g.area, ...g.roles)
  if (g.kind === 'module') return requireModule(g.module as 'projects' | 'documents')
  return null
}

/** Passa por todas as travas, na ordem e com a mesma requisição, como o Express faria. */
async function allows(fns: Fn[], s: AccessSubject): Promise<boolean> {
  current.modules = s.modules as EffectiveModules
  const req = { user: { sub: s.sub, role: s.role, orgId: null, permissions: s.permissions } }
  for (const fn of fns) {
    let passed = false
    try {
      await fn(req, {}, () => { passed = true })
    } catch { passed = false }
    if (!passed) return false
  }
  return true
}

const key = (r: InventoryRoute) => `${r.method} ${r.path}`
const hasAuth = (gates: Gate[]) => gates.some(g => g.kind === 'auth')

describe('guarda das rotas', () => {
  it('as rotas de hoje são as mesmas da foto (rota nova ou removida entra na foto de propósito)', () => {
    expect(routes.map(key).sort()).toEqual(Object.keys(legacy).sort())
  })

  it('nenhuma rota usa mais authorize / authorizeArea / requireModule', () => {
    const old = routes.filter(r => r.gates.some(g => g.kind === 'role' || g.kind === 'area' || g.kind === 'module')).map(key)
    expect(old).toEqual([])
  })

  it('rota sem login só se já era pública (login, SSO, pesquisa pública, integrações por chave, MCP)', () => {
    const opened = routes.filter(r => !hasAuth(r.gates) && hasAuth(legacy[key(r)] ?? [])).map(key)
    expect(opened).toEqual([])
  })
})

describe('equivalência antes × depois', () => {
  it('mesma resposta para toda rota, cargo, liberação e módulo', async () => {
    const diffs: string[] = []
    const all = subjects()
    let checked = 0
    let intended = 0
    const ticketsOffRoute = (r: InventoryRoute) =>
      r.gateFns.some(fn => fn.gate.kind === 'requester' || (fn.gate.kind === 'cap' && TICKETS_OFF_CAPS.includes(fn.gate.cap)))
    // A lista acima é a fonte: capacidade nova com módulo Chamados precisa entrar nela.
    const withTicketsModule = Object.entries(CAPABILITIES as Record<string, { module?: string }>).filter(([, c]) => c.module === 'tickets').map(([k]) => k)
    expect(withTicketsModule.sort()).toEqual([...TICKETS_OFF_CAPS].sort())
    for (const r of routes) {
      const before = (legacy[key(r)] ?? []).map(legacyFn).filter((f): f is Fn => !!f)
      const after = r.gateFns.filter(fn => fn.gate.kind !== 'auth')
      if (!before.length && !after.length) continue
      for (const s of all) {
        checked++
        const a = await allows(before, s)
        const b = await allows(after, s)
        if (a && !b && ticketsOffRoute(r) && s.modules?.tickets === false && s.role !== 'user') { intended++; continue }
        if (a !== b) diffs.push(`${key(r)} ${s.role} perms=${JSON.stringify(s.permissions)} mods=${JSON.stringify(s.modules)}: antes=${a} depois=${b}`)
      }
    }
    expect(diffs.slice(0, 20)).toEqual([])
    expect(checked).toBeGreaterThan(50_000)
    expect(intended).toBeGreaterThan(0) // Chamados desligado bloqueia de verdade
  }, 300_000)
})
