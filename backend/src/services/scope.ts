import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { forbidden, roleLabel, joinPt } from '../utils/denials'

/**
 * Escopo efetivo (carteira) de um usuário.
 * - scopeAll: todas as empresas (dimensão empresa sem filtro).
 * - orgIds: com scopeAll=false é a lista EXATA — vazia significa nenhuma empresa.
 * - queueIds/enforceQueues: só o analista é filtrado por fila; sem fila = nada.
 */
export interface EffectiveScope {
  scopeAll: boolean
  orgIds: string[]
  queueIds: string[]
  enforceQueues: boolean
}

export interface ChainNode {
  id: string
  role: string
  manager_id: string | null
  manager_global: boolean
  queues: string[]
  org_scopes: { org_id: string }[]
}

const CHAIN_SELECT = {
  id: true, role: true, manager_id: true, manager_global: true, queues: true,
  org_scopes: { select: { org_id: true } },
} as const

// 1 query por nível da hierarquia (máx. MAX_DEPTH); cachear por request se virar gargalo.
const MAX_DEPTH = 6
const STAFF = ['agent', 'supervisor', 'manager']

/** [usuário, chefe, chefe do chefe, …] seguindo manager_id; protege contra ciclo. */
export async function loadChain(userId: string): Promise<ChainNode[]> {
  const chain: ChainNode[] = []
  const seen = new Set<string>()
  let id: string | null = userId
  while (id && !seen.has(id) && chain.length < MAX_DEPTH) {
    seen.add(id)
    const u = (await prisma.user.findUnique({ where: { id }, select: CHAIN_SELECT })) as ChainNode | null
    if (!u) break
    chain.push(u)
    id = u.manager_id
  }
  return chain
}

/** `rootId` está acima de `targetId` no organograma (chefe, chefe do chefe…). Não conta o próprio alvo. */
export async function isInSubtree(rootId: string, targetId: string): Promise<boolean> {
  if (rootId === targetId) return false
  return (await loadChain(targetId)).slice(1).some(n => n.id === rootId)
}

/**
 * Carteira efetiva = interseção das carteiras "Selecionadas" da cadeia.
 * "Todas" (manager_global / admin) e "Herdar" (sem linhas) são neutros.
 * Ninguém configurado na cadeia → nenhuma empresa (fail-closed).
 */
export function computeScope(chain: ChainNode[]): { scopeAll: boolean; orgIds: string[] } {
  let configured = false
  let acc: string[] | null = null
  for (const n of chain) {
    if (n.role === 'admin' || n.manager_global) { configured = true; continue }
    const ids = [...new Set((n.org_scopes ?? []).map(s => s.org_id))]
    if (ids.length === 0) continue
    configured = true
    acc = acc === null ? ids : acc.filter(i => ids.includes(i))
  }
  if (!configured) return { scopeAll: false, orgIds: [] }
  if (acc === null) return { scopeAll: true, orgIds: [] }
  return { scopeAll: false, orgIds: acc }
}

export function scopeFromChain(chain: ChainNode[], role: string): EffectiveScope {
  const enforceQueues = role === 'agent'
  if (chain.length === 0) return { scopeAll: false, orgIds: [], queueIds: [], enforceQueues }
  const { scopeAll, orgIds } = computeScope(chain)
  return { scopeAll, orgIds, queueIds: enforceQueues ? chain[0].queues ?? [] : [], enforceQueues }
}

export async function getEffectiveScope(userId: string, role: string): Promise<EffectiveScope> {
  if (role === 'admin') return { scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false }
  return scopeFromChain(await loadChain(userId), role)
}

export function canSeeOrg(scope: EffectiveScope, orgId: string | null | undefined): boolean {
  if (scope.scopeAll) return true
  return !!orgId && scope.orgIds.includes(orgId)
}

/** Analista precisa de fila; chamado sem fila é visível a quem tem ao menos uma fila. */
export function canSeeQueue(scope: EffectiveScope, queue: string | null | undefined): boolean {
  if (!scope.enforceQueues) return true
  if (scope.queueIds.length === 0) return false
  return !queue || scope.queueIds.includes(queue)
}

/** Filtro Prisma de chamados pela carteira. Lista vazia = não casa nada (nunca "sem filtro"). */
export function scopeTicketWhere(scope: EffectiveScope): { AND?: any[] } {
  const and: any[] = []
  if (!scope.scopeAll) and.push({ org_id: { in: scope.orgIds } })
  if (scope.enforceQueues) {
    and.push(scope.queueIds.length === 0
      ? { id: { in: [] } }
      : { OR: [{ queue: null }, { queue: { in: scope.queueIds } }] })
  }
  return and.length ? { AND: and } : {}
}

/** Filtro Prisma de organizações pela carteira. */
export function scopeOrgWhere(scope: EffectiveScope): { id?: { in: string[] } } {
  return scope.scopeAll ? {} : { id: { in: scope.orgIds } }
}

/** Lança 403 explicativo se a empresa não está na carteira de quem pede. Admin passa; usuário final só a própria. */
export async function assertOrgInScope(user: { sub: string; role: string; orgId?: string | null }, orgId: string) {
  if (user.role === 'admin') return
  if (!STAFF.includes(user.role)) {
    if (user.orgId === orgId) return
    throw forbidden('ORG_NOT_OWN', 'Você só pode acessar os dados da sua própria empresa.')
  }
  const scope = await getEffectiveScope(user.sub, user.role)
  if (canSeeOrg(scope, orgId)) return
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, deleted_at: true } })
  if (!org || org.deleted_at) throw new AppError(404, 'Empresa não encontrada', 'ORG_NOT_FOUND')
  if (!scope.scopeAll && scope.orgIds.length === 0) {
    throw forbidden('SCOPE_NOT_CONFIGURED', 'Você ainda não tem empresas na sua carteira. Peça ao administrador ou ao seu gerente para configurar as empresas que você atende.')
  }
  throw forbidden('ORG_OUT_OF_SCOPE', `A empresa ${org.name} não está na sua carteira. Peça ao administrador para incluí-la na sua carteira (ou na do seu gerente).`)
}

/**
 * Subordinado só pode restringir dentro da carteira do chefe. Lança 400 dizendo
 * quais empresas estão fora e onde incluí-las.
 */
export async function validateCarteiraAgainstChief(chiefId: string | null | undefined, orgIds: string[] | undefined) {
  if (!chiefId || !orgIds || orgIds.length === 0) return
  const chain = await loadChain(chiefId)
  if (chain.length === 0) return
  const chief = scopeFromChain(chain, chain[0].role)
  if (chief.scopeAll) return
  const outside = orgIds.filter(id => !chief.orgIds.includes(id))
  if (outside.length === 0) return
  const orgs = await prisma.organization.findMany({ where: { id: { in: outside } }, select: { name: true } })
  const names = joinPt(orgs.map(o => o.name))
  throw new AppError(
    400,
    `${names || 'Empresas selecionadas'} não ${outside.length > 1 ? 'estão' : 'está'} na carteira do chefe (${roleLabel(chain[0].role)}). Quem herda de um chefe só pode atender empresas dele — inclua primeiro na carteira do chefe.`,
    'CARTEIRA_OUTSIDE_CHIEF',
  )
}

/**
 * Empresa criada por não-admin entra na carteira do criador e de cada ancestral
 * em "Selecionadas"; se o topo da cadeia não tem carteira nem Todas, entra nele
 * (raiz da herança) — senão o criador perderia a empresa que acabou de criar.
 */
export async function addOrgToCreatorChain(actorId: string, orgId: string) {
  const chain = await loadChain(actorId)
  if (chain.length === 0 || chain[0].role === 'admin') return
  const targets = new Set<string>()
  for (const n of chain) {
    if (n.role === 'admin' || n.manager_global) continue
    if ((n.org_scopes ?? []).length > 0) targets.add(n.id)
  }
  const top = chain[chain.length - 1]
  if (top.role !== 'admin' && !top.manager_global && (top.org_scopes ?? []).length === 0) targets.add(top.id)
  if (targets.size === 0) return
  await prisma.userOrgScope.createMany({
    data: [...targets].map(user_id => ({ user_id, org_id: orgId })),
    skipDuplicates: true,
  })
}

export interface ServedBy {
  managers: { id: string; name: string; email: string; avatar: string | null; mode: 'all' | 'selected' }[]
  team: { id: string; name: string; email: string; avatar: string | null; role: string; mode: 'inherit' | 'restricted'; queues: string[] }[]
}

/** Quem atende a empresa: calcula o escopo efetivo de toda a equipe em memória (1 query). */
export async function getOrgServedBy(orgId: string): Promise<ServedBy> {
  const staff = (await prisma.user.findMany({
    where: { role: { in: STAFF as any }, active: true, deleted_at: null },
    select: { ...CHAIN_SELECT, name: true, email: true, avatar: true },
    orderBy: { name: 'asc' },
  })) as (ChainNode & { name: string; email: string; avatar: string | null })[]
  const byId = new Map(staff.map(u => [u.id, u]))
  const chainOf = (id: string) => {
    const chain: ChainNode[] = []
    const seen = new Set<string>()
    let cur: string | null = id
    while (cur && !seen.has(cur) && byId.has(cur) && chain.length < MAX_DEPTH) {
      seen.add(cur)
      const u: ChainNode = byId.get(cur)!
      chain.push(u)
      cur = u.manager_id
    }
    return chain
  }
  const result: ServedBy = { managers: [], team: [] }
  for (const u of staff) {
    const scope = computeScope(chainOf(u.id))
    if (!scope.scopeAll && !scope.orgIds.includes(orgId)) continue
    if (u.role === 'manager') {
      result.managers.push({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, mode: u.manager_global ? 'all' : 'selected' })
    } else {
      result.team.push({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role, mode: u.org_scopes.length ? 'restricted' : 'inherit', queues: u.queues })
    }
  }
  return result
}
