/**
 * O porteiro: uma regra só que responde "essa pessoa pode?".
 *
 * Decisão de capacidade (síncrona):
 *   admin → sim; senão o módulo da capacidade (se houver) está ligado E
 *   o cargo dá, ou a área foi liberada para a pessoa (explícita).
 * Decisão sobre um recurso (assíncrona): além da capacidade,
 *   empresa → está na carteira; pessoa → está abaixo no organograma.
 *
 * Carteira e módulos são calculados uma vez por requisição (accessContext).
 */
import type { Request } from 'express'
import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey, type Module } from './capabilities'
import { userHasExplicitPermission, userHasPermission } from '../config/permissions'
import { getEffectiveModules, type EffectiveModules } from '../services/moduleAccess'
import { getEffectiveScope, canSeeOrg, isInSubtree, type EffectiveScope } from '../services/scope'

export interface AccessSubject {
  sub?: string
  role: string
  permissions?: string[] | null
  modules?: Partial<Record<Module, boolean>>
}

export function can(subject: AccessSubject | null | undefined, capability: CapabilityKey): boolean {
  if (!subject) return false
  const cap = CAPABILITIES[capability] as { roles: readonly string[]; area?: string; module?: Module; perPerson?: boolean; notAdmin?: boolean } | undefined
  if (!cap) return false
  if (subject.role === 'admin') return !cap.notAdmin
  // Módulo é requisito a mais: com ele desligado, nem o cargo nem a área liberam.
  if (cap.module && subject.modules?.[cap.module] !== true) return false
  if (cap.perPerson) return !!cap.area && userHasPermission(subject, cap.area)
  if (cap.roles.includes(subject.role)) return true
  return !!cap.area && userHasExplicitPermission(subject, cap.area)
}

/** Todas as capacidades da pessoa (vai na sessão para a tela montar o menu). */
export function capabilitiesOf(subject: AccessSubject): CapabilityKey[] {
  return CAPABILITY_KEYS.filter(k => can(subject, k))
}

// ── Contexto por requisição ──

interface AccessContext {
  modules?: Promise<EffectiveModules>
  scope?: Promise<EffectiveScope>
  subtree: Map<string, Promise<boolean>>
}

const CTX = Symbol('accessContext')

function context(req: Request): AccessContext {
  const r = req as any
  return (r[CTX] ??= { subtree: new Map() })
}

export function modulesFor(req: Request): Promise<EffectiveModules> {
  const ctx = context(req)
  return (ctx.modules ??= getEffectiveModules(req.user!.sub, req.user!.role))
}

export function scopeFor(req: Request): Promise<EffectiveScope> {
  const ctx = context(req)
  return (ctx.scope ??= getEffectiveScope(req.user!.sub, req.user!.role))
}

/** Sujeito completo da requisição (com módulos), para `can`. */
export async function subjectOf(req: Request): Promise<AccessSubject> {
  return { ...req.user!, modules: await modulesFor(req) }
}

export type Resource = { orgId: string } | { userId: string }

/**
 * Capacidade + recurso. Empresa: na carteira (admin vê todas). Pessoa: quem pede
 * está acima dela no organograma (o admin alcança todos).
 * Ainda sem uso: para editar pessoas valem as regras completas de access/grants.ts
 * (colega de time do Analista, cliente pela carteira).
 */
export async function canOn(req: Request, capability: CapabilityKey, resource: Resource): Promise<boolean> {
  if (!can(await subjectOf(req), capability)) return false
  const user = req.user!
  if (user.role === 'admin') return true
  if ('orgId' in resource) return canSeeOrg(await scopeFor(req), resource.orgId)
  const ctx = context(req)
  let inTeam = ctx.subtree.get(resource.userId)
  if (!inTeam) ctx.subtree.set(resource.userId, (inTeam = isInSubtree(user.sub, resource.userId)))
  return inTeam
}

const STAFF_ROLES = ['agent', 'supervisor', 'manager']

/**
 * Como a pessoa enxerga chamados: equipe com o módulo Chamados desligado vê
 * como solicitante ('user': só os que abriu). Vale para rotas, tempo real e
 * notificações — os três decidem o acesso a partir deste papel.
 */
export async function ticketRole(userId: string, role: string, modules?: EffectiveModules): Promise<string> {
  if (!STAFF_ROLES.includes(role)) return role
  const m = modules ?? await getEffectiveModules(userId, role)
  return m.tickets ? role : 'user'
}
