// Matriz papel × relação com o chamado × ação, contra o backend REAL (E2E_BASE_URL).
// Cada ação de escrita roda num chamado novo; o resultado (HTTP + efeito conferido)
// vai para um relatório Markdown com as anomalias marcadas. A base de conhecimento e a
// Skadi, que não dependem de chamado, têm uma seção à parte. Não é vitest: rodar com
//   E2E_BASE_URL=http://localhost:3012 npx tsx e2e/role-matrix.ts [saida.md]
// Precisa do ambiente isolado do e2e/README.md (seed + seed-test-rbac). Use
// API_RATE_LIMIT_MAX alto no backend: a matriz faz milhares de requisições.
import { writeFileSync } from 'node:fs'
import { http, login, PASS, uid, type Res } from './helpers'

type Role = 'admin' | 'manager' | 'supervisor' | 'agent' | 'user'
interface Actor { key: string; email: string; role: Role; label: string; scope: 'acme' | 'initech' | 'all' | 'globex' | 'none' }

const ACTORS: Actor[] = [
  { key: 'admin', email: 'admin.teste@isa.local', role: 'admin', label: 'Admin', scope: 'all' },
  { key: 'gerente', email: 'gerente.teste@isa.local', role: 'manager', label: 'Gerente (ACME+Globex+Initech)', scope: 'all' },
  { key: 'tm', email: 'tm.teste@isa.local', role: 'supervisor', label: 'Ticket Manager (ACME+Globex)', scope: 'acme' },
  { key: 'tm2', email: 'tm2.teste@isa.local', role: 'supervisor', label: 'Ticket Manager 2 (Initech)', scope: 'initech' },
  { key: 'an1', email: 'analista1.teste@isa.local', role: 'agent', label: 'Analista 1 (ACME, geral+vip)', scope: 'acme' },
  { key: 'an2', email: 'analista2.teste@isa.local', role: 'agent', label: 'Analista 2 (ACME+Globex, só geral)', scope: 'acme' },
  { key: 'an3', email: 'analista3.teste@isa.local', role: 'agent', label: 'Analista 3 (Initech)', scope: 'initech' },
  { key: 'acme1', email: 'usuario1.acme@isa.local', role: 'user', label: 'Cliente ACME 1', scope: 'acme' },
  { key: 'acme2', email: 'usuario2.acme@isa.local', role: 'user', label: 'Cliente ACME 2', scope: 'acme' },
  { key: 'globex1', email: 'usuario1.globex@isa.local', role: 'user', label: 'Cliente Globex 1', scope: 'globex' },
]

// Relação do ator com o chamado
type Rel = 'proprio' | 'acme' | 'initech' | 'meu' | 'de_outro'
const REL_LABEL: Record<Rel, string> = {
  proprio: 'chamado aberto por ele mesmo',
  acme: 'chamado de cliente ACME (sem responsável)',
  initech: 'chamado de cliente Initech (sem responsável)',
  meu: 'chamado da carteira atribuído a ele',
  de_outro: 'chamado da carteira atribuído a outro analista',
}

const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const tok = (k: string) => tokens[k]
let escalationRuleId = ''
let kbArticleId = ''

async function setupUsers() {
  for (const e of [...ACTORS.map(a => [a.key, a.email]), ['initech1', 'usuario1.initech@isa.local'], ['globex2', 'usuario2.globex@isa.local']]) {
    const s = await login(e[1], PASS)
    tokens[e[0]] = s.token
    ids[e[0]] = s.user.id
  }
  const r = await http('POST', '/api/escalation', { token: tok('admin'), body: { name: `Matriz ${uid()}`, type: 'same_ticket', target_queue_id: 'geral', active: true } })
  escalationRuleId = r.body?.data?.id ?? ''
  if (!escalationRuleId) console.warn('regra de escalonamento não criada:', r.status, JSON.stringify(r.body))
  const kbr = await http('POST', '/api/knowledge', { token: tok('admin'), body: { title: `Matriz ${uid()}`, content: 'Artigo da matriz.' } })
  if (kbr.status !== 201) throw new Error(`artigo da matriz → ${kbr.status} ${JSON.stringify(kbr.body).slice(0, 200)}`)
  kbArticleId = kbr.body.data.id
}

const get = (k: string, path: string) => http('GET', path, { token: tok(k) })
const patch = (k: string, id: string, body: any) => http('PATCH', `/api/tickets/${id}`, { token: tok(k), body })
async function ticketAs(k: string, id: string) { return (await get(k, `/api/tickets/${id}`)).body?.data }
const adminView = (id: string) => ticketAs('admin', id)

type Co = 'acme' | 'globex' | 'initech'
// Quem administra a carteira do chamado nos preparativos (TM da empresa).
const tmOf = (co: Co) => (co === 'initech' ? 'tm2' : 'tm')
const clientOf = (co: Co, a: Actor) => co === 'initech' ? 'initech1' : co === 'globex' ? (a.key === 'globex1' ? 'globex2' : 'globex1') : a.key === 'acme1' ? 'acme2' : 'acme1'
// Analista que atende a fila da empresa (ACME cai na Fila VIP: só o Analista 1; Globex na geral: Analista 2).
const ANALYST: Record<Co, string> = { acme: 'an1', globex: 'an2', initech: 'an3' }
/** Outro membro da equipe que atende a empresa (para "atribuído a outro"). */
const otherOf = (co: Co, a: Actor) => (ANALYST[co] === a.key ? tmOf(co) : ANALYST[co])
const companyOf = (a: Actor): Co => (a.scope === 'initech' ? 'initech' : a.key === 'an2' || a.scope === 'globex' ? 'globex' : 'acme')

async function open(k: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await http('POST', '/api/tickets', { token: tok(k), body: { title: `Matriz ${uid()}`, description: 'Chamado da matriz de papéis: impressora parou de imprimir no 2º andar.', ...extra } })
  if (r.status !== 201) throw new Error(`abrir como ${k} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  return r.body.data
}

/** Prepara um chamado novo na relação pedida; lança erro (vira "preparo falhou") se não der. */
async function makeTicket(rel: Rel, a: Actor): Promise<any> {
  const co = companyOf(a)
  if (rel === 'proprio') return open(a.key)
  if (rel === 'acme') return open(clientOf('acme', a))
  if (rel === 'initech') return open('initech1')
  const t = await open(clientOf(co, a))
  const assignee = rel === 'meu' ? a.key : otherOf(co, a)
  const r = await patch(tmOf(co), t.id, { assigned_to_id: ids[assignee] })
  if (r.status !== 200) throw new Error(`atribuir a ${assignee} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  return t
}

/** Deixa o chamado resolvido por um analista da empresa do chamado (preparo de fechar/reabrir). */
async function resolveFirst(t: any, rel: Rel, a: Actor) {
  const co: Co = rel === 'initech' ? 'initech' : rel === 'acme' ? 'acme' : companyOf(a)
  // Analista resolvendo o próprio chamado: ele mesmo assume e resolve.
  // Chamado próprio da equipe é da ISA Interna, atendida pelo Analista 2 (seed-test-rbac).
  const owner = rel === 'proprio' && a.role !== 'user' ? (a.role === 'agent' ? a.key : 'an2') : ANALYST[co]
  const by = rel === 'proprio' && a.role !== 'user' ? a.key : tmOf(co)
  const r1 = await patch(by, t.id, { assigned_to_id: ids[owner] })
  if (r1.status !== 200) throw new Error(`preparo: ${by} atribuir a ${owner} → ${r1.status} ${r1.body?.code ?? ''}`)
  const r = await patch(owner, t.id, { status: 'resolved', resolution_details: 'Resolvido no preparo da matriz de papéis.' })
  if (r.status !== 200) throw new Error(`preparo: resolver como ${owner} → ${r.status} ${r.body?.code ?? ''}`)
}

interface Outcome { status: number | string; code?: string; msg?: string; effect?: string; ok?: boolean }
interface Action {
  key: string
  label: string
  write: boolean
  /** Ação só de equipe (cliente nunca deveria conseguir). */
  staffOnly?: boolean
  /** Precisa do chamado resolvido antes. */
  needsResolved?: boolean
  run: (a: Actor, t: any, rel: Rel) => Promise<Outcome>
}

const out = (r: Res, effect?: string, ok?: boolean): Outcome => ({ status: r.status, code: r.body?.code, msg: typeof r.body?.error === 'string' ? r.body.error : undefined, effect, ok })

const ACTIONS: Action[] = [
  { key: 'ver', label: 'Ver o chamado', write: false, run: async (a, t) => out(await get(a.key, `/api/tickets/${t.id}`)) },
  { key: 'lista', label: 'Aparece na lista dele', write: false, run: async (a, t) => {
    const r = await get(a.key, `/api/tickets?search=${encodeURIComponent(t.title)}`)
    const rows = r.body?.data?.tickets ?? r.body?.data ?? []
    const found = Array.isArray(rows) && rows.some((x: any) => x.id === t.id)
    return { status: r.status, effect: found ? 'aparece' : 'não aparece', ok: found }
  } },
  { key: 'msgs', label: 'Ler mensagens', write: false, run: async (a, t) => out(await get(a.key, `/api/tickets/${t.id}/messages`)) },
  { key: 'pesquisa', label: 'Pegar link da pesquisa', write: false, run: async (a, t) => out(await get(a.key, `/api/tickets/${t.id}/survey-link`)) },
  { key: 'triagem', label: 'Ver triagem IA', write: false, staffOnly: true, run: async (a, t) => out(await get(a.key, `/api/ai/tickets/${t.id}/triage`)) },
  { key: 'msg', label: 'Mensagem pública', write: true, run: async (a, t) => {
    const r = await http('POST', `/api/tickets/${t.id}/messages`, { token: tok(a.key), body: { text: `mensagem pública de ${a.key}` } })
    const after = await adminView(t.id)
    return out(r, `status do chamado depois: ${after?.status}`)
  } },
  { key: 'nota', label: 'Nota interna', write: true, staffOnly: true, run: async (a, t) => out(await http('POST', `/api/tickets/${t.id}/messages`, { token: tok(a.key), body: { text: `nota interna de ${a.key}`, type: 'internal' } })) },
  { key: 'assumir', label: 'Assumir (autoatribuir)', write: true, staffOnly: true, run: async (a, t) => {
    const r = await patch(a.key, t.id, { assigned_to_id: ids[a.key] })
    const after = await adminView(t.id)
    const mine = after?.assigned_to_id === ids[a.key]
    return out(r, mine ? 'ficou responsável' : `responsável: ${after?.assigned_to?.name ?? 'ninguém'}`, r.status !== 200 || mine)
  } },
  { key: 'atribuir_an', label: 'Atribuir a um analista da carteira', write: true, staffOnly: true, run: async (a, t, rel) => {
    const target = rel === 'initech' ? 'an3' : rel === 'acme' ? 'an1' : otherOf(companyOf(a), a)
    const r = await patch(a.key, t.id, { assigned_to_id: ids[target] })
    const after = await adminView(t.id)
    return out(r, `responsável: ${after?.assigned_to?.name ?? 'ninguém'}`, r.status !== 200 || after?.assigned_to_id === ids[target])
  } },
  { key: 'atribuir_gerente', label: 'Atribuir ao GERENTE', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: ids.gerente })) },
  { key: 'atribuir_tm', label: 'Atribuir ao TICKET MANAGER', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: ids.tm })) },
  { key: 'atribuir_admin', label: 'Atribuir ao ADMIN', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: ids.admin })) },
  { key: 'atribuir_cliente', label: 'Atribuir a um CLIENTE', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: ids.acme2 })) },
  { key: 'atribuir_solicitante', label: 'Atribuir ao próprio solicitante', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: t.user_id })) },
  { key: 'tirar_resp', label: 'Tirar o responsável', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { assigned_to_id: null })) },
  { key: 'atender', label: 'Pôr Em Atendimento', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { status: 'in_progress' })) },
  { key: 'pendente', label: 'Pôr Pendente', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { status: 'pending', pending_reason: 'pending_user', note: 'aguardando retorno do solicitante' })) },
  { key: 'resolver', label: 'Resolver', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { status: 'resolved', resolution_details: 'Resolvido pela matriz de papéis.' })) },
  { key: 'assumir_resolver', label: 'Assumir e resolver (sozinho)', write: true, staffOnly: true, run: async (a, t) => {
    const r1 = await patch(a.key, t.id, { assigned_to_id: ids[a.key] })
    if (r1.status !== 200) return { ...out(r1), effect: 'não conseguiu assumir' }
    const r2 = await patch(a.key, t.id, { status: 'resolved', resolution_details: 'Resolvido por quem assumiu.' })
    const after = await adminView(t.id)
    return out(r2, `status: ${after?.status}`)
  } },
  { key: 'fechar', label: 'Fechar (resolvido → fechado)', write: true, staffOnly: true, needsResolved: true, run: async (a, t) => out(await patch(a.key, t.id, { status: 'closed' })) },
  { key: 'reabrir', label: 'Reabrir resolvido', write: true, needsResolved: true, run: async (a, t) => out(await http('POST', `/api/tickets/${t.id}/reopen`, { token: tok(a.key), body: { reason: 'Voltou a acontecer depois da resolução.' } })) },
  { key: 'prioridade', label: 'Mudar prioridade', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { priority: 'high' })) },
  { key: 'fila', label: 'Mudar fila (→ Mesa Especializada)', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { queue: 'especializada' })) },
  { key: 'tipo', label: 'Mudar tipo (→ requisição)', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { type: 'request' })) },
  { key: 'solicitante', label: 'Trocar solicitante (→ cliente ACME 2)', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { requesterId: ids.acme2 })) },
  { key: 'sla', label: 'Alterar prazo de SLA', write: true, staffOnly: true, run: async (a, t) => out(await patch(a.key, t.id, { sla_deadline: new Date(Date.now() + 864e5).toISOString() })) },
  { key: 'escalar', label: 'Escalonar', write: true, staffOnly: true, run: async (a, t) => out(await http('POST', `/api/tickets/${t.id}/escalate`, { token: tok(a.key), body: { ruleId: escalationRuleId } })) },
  { key: 'entrar', label: 'Entrar como colaborador (join)', write: true, staffOnly: true, run: async (a, t) => out(await http('POST', `/api/tickets/${t.id}/join`, { token: tok(a.key), body: {} })) },
  { key: 'dispensar_ia', label: 'Dispensar marca da IA (completude)', write: true, staffOnly: true, run: async (a, t) => out(await http('POST', `/api/ai/intake/tickets/${t.id}/dismiss`, { token: tok(a.key), body: {} })) },
  { key: 'apagar', label: 'Apagar (lixeira)', write: true, staffOnly: true, run: async (a, t) => out(await http('DELETE', `/api/tickets/${t.id}`, { token: tok(a.key) })) },
]

const ok2xx = (s: Outcome['status']) => typeof s === 'number' && s >= 200 && s < 300

/** Fora da carteira/empresa do ator? */
function outOfScope(a: Actor, rel: Rel): boolean {
  if (a.scope === 'all') return false
  if (rel === 'initech') return a.scope !== 'initech'
  if (rel === 'acme') return a.scope !== 'acme'
  return false
}

function flags(a: Actor, rel: Rel, act: Action, o: Outcome): string[] {
  const f: string[] = []
  if (typeof o.status === 'number' && o.status >= 500) f.push('ERRO 5xx')
  if (o.status === 'ERR') f.push('conexão falhou')
  if (act.key === 'lista') {
    if (outOfScope(a, rel) && o.ok) f.push('FORA da carteira e aparece na lista')
    return f
  }
  if (o.ok === false) f.push('2xx sem o efeito esperado')
  if (ok2xx(o.status)) {
    if (a.role === 'admin' && act.write) f.push('admin deveria ser só leitura')
    if (a.role === 'user' && act.staffOnly) f.push('cliente executou ação de equipe')
    if (outOfScope(a, rel)) f.push('FORA da carteira/empresa e funcionou')
    if (['atribuir_admin', 'atribuir_cliente'].includes(act.key)) f.push('responsável inválido aceito')
    if (act.key === 'atribuir_solicitante' && rel !== 'proprio') f.push('QUESTIONÁVEL: solicitante virou responsável')
  }
  if (o.code === 'IN_USE' && act.key !== 'apagar') f.push('mensagem "não pode ser excluído" fora de exclusão')
  return f
}

// Base de conhecimento e Skadi não dependem de chamado: cada ação roda uma vez por
// ator, e `allowed` é quem passa pela porta. Recusa é 401/403; o resto abaixo de 500
// passou, porque 404 de id inexistente ou 409 de estado já estão depois da porta.
interface GlobalAction { key: string; label: string; allowed: readonly Role[]; run: (a: Actor) => Promise<Res> }

const ONLY_ADMIN: readonly Role[] = ['admin']
const REQUESTERS: readonly Role[] = ['manager', 'supervisor', 'agent', 'user']
const EVERYONE: readonly Role[] = ['admin', ...REQUESTERS]
const NO_ID = '00000000-0000-0000-0000-000000000000'
const kb = (k: string, method: string, path: string, body?: unknown) => http(method, `/api/knowledge${path}`, { token: tok(k), body })
const mdFile = `data:text/markdown;base64,${Buffer.from('# Manual da matriz').toString('base64')}`

// Excluir fica por último: as ações do admin anteriores usam o artigo.
const GLOBAL_ACTIONS: GlobalAction[] = [
  { key: 'kb_listar', label: 'Listar artigos', allowed: ONLY_ADMIN, run: a => kb(a.key, 'GET', '') },
  { key: 'kb_ler', label: 'Ler artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'GET', `/${kbArticleId}`) },
  { key: 'kb_lacunas', label: 'Ver lacunas da base', allowed: ONLY_ADMIN, run: a => kb(a.key, 'GET', '/gaps') },
  { key: 'kb_criar', label: 'Criar artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'POST', '', { title: `Matriz ${uid()}`, content: 'Artigo da matriz.' }) },
  { key: 'kb_importar', label: 'Importar artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'POST', '/import', { fileName: 'matriz.md', dataUri: mdFile }) },
  { key: 'kb_editar', label: 'Editar artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'PUT', `/${kbArticleId}`, { title: `Matriz ${uid()}` }) },
  { key: 'kb_publicar', label: 'Publicar artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'POST', `/${kbArticleId}/publish`, {}) },
  { key: 'kb_despublicar', label: 'Despublicar artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'POST', `/${kbArticleId}/unpublish`, {}) },
  { key: 'kb_excluir', label: 'Excluir artigo', allowed: ONLY_ADMIN, run: a => kb(a.key, 'DELETE', `/${kbArticleId}`) },
  { key: 'ia_status', label: 'Status da sugestão', allowed: EVERYONE, run: a => get(a.key, '/api/ai/suggest/status') },
  { key: 'ia_sugerir', label: 'Pedir sugestão da Skadi', allowed: EVERYONE, run: a => http('POST', '/api/ai/suggest', { token: tok(a.key), body: { title: 'Impressora parou' } }) },
  // Admin não abre chamado: nem aceitando sugestão.
  { key: 'ia_aceitar', label: 'Aceitar sugestão', allowed: REQUESTERS, run: a => http('POST', `/api/ai/suggest/${NO_ID}/accept`, { token: tok(a.key), body: { title: 'Matriz', description: 'Aceite da matriz' } }) },
  { key: 'ia_avaliar', label: 'Avaliar resposta (Útil / Não útil)', allowed: EVERYONE, run: a => http('POST', '/api/ai/feedback', { token: tok(a.key), body: { interactionId: NO_ID, value: 'useful' } }) },
  { key: 'ia_metricas', label: 'Métricas da base', allowed: ['admin', 'manager'], run: a => get(a.key, '/api/ai/insights/knowledge') },
]

interface GlobalRow { actor: Actor; action: GlobalAction; o: Outcome; f: string[] }

function globalFlags(a: Actor, act: GlobalAction, o: Outcome): string[] {
  if (typeof o.status !== 'number') return ['conexão falhou']
  if (o.status >= 500) return ['ERRO 5xx']
  const denied = o.status === 401 || o.status === 403
  if (act.allowed.includes(a.role)) return denied ? ['deveria passar'] : []
  return denied ? [] : ['deveria ser recusado']
}

async function runGlobalActions(): Promise<GlobalRow[]> {
  const rows: GlobalRow[] = []
  for (const actor of ACTORS) {
    for (const action of GLOBAL_ACTIONS) {
      const o = await action.run(actor).then(r => out(r), (e: any) => ({ status: 'ERR', msg: String(e?.message ?? e) }))
      rows.push({ actor, action, o, f: globalFlags(actor, action, o) })
    }
  }
  return rows
}

interface Row { actor: Actor; rel: Rel; action: Action; o: Outcome; f: string[] }

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]) }))
}

function relsFor(a: Actor): Rel[] {
  const rels: Rel[] = []
  if (a.role !== 'admin') rels.push('proprio')
  rels.push('acme', 'initech')
  if (['agent', 'supervisor', 'manager'].includes(a.role)) rels.push('meu', 'de_outro')
  return rels
}

async function main() {
  const file = process.argv[2] ?? 'role-matrix.report.md'
  await setupUsers()
  const rows: Row[] = []
  const shared = new Map<string, any>() // chamado compartilhado das ações de leitura, por ator+relação
  const jobs: { a: Actor; rel: Rel; act: Action }[] = []
  for (const a of ACTORS) for (const rel of relsFor(a)) for (const act of ACTIONS) jobs.push({ a, rel, act })
  let done = 0
  await pool(jobs, 6, async ({ a, rel, act }) => {
    let o: Outcome
    try {
      let t: any
      if (!act.write) {
        const k = `${a.key}:${rel}`
        if (!shared.has(k)) shared.set(k, makeTicket(rel, a))
        t = await shared.get(k)
      } else {
        t = await makeTicket(rel, a)
        if (act.needsResolved) await resolveFirst(t, rel, a)
      }
      o = await act.run(a, t, rel)
    } catch (e: any) {
      const m = String(e?.message ?? e)
      o = m.includes('fetch failed') ? { status: 'ERR', msg: m } : { status: 'preparo', msg: m }
    }
    rows.push({ actor: a, rel, action: act, o, f: flags(a, rel, act, o) })
    if (++done % 50 === 0) console.log(`${done}/${jobs.length}`)
  })
  const globalRows = await runGlobalActions()

  // ── Relatório ──
  const L: string[] = [`# Matriz de papéis × ações — ${new Date().toLocaleString('pt-BR')}`, '', `Backend: ${process.env.E2E_BASE_URL}. ${rows.length + globalRows.length} combinações.`, '']
  const anomalies = rows.filter(r => r.f.length)
  const globalAnomalies = globalRows.filter(r => r.f.length)
  const cell = (o: Outcome) => `${o.status}${o.code ? ` ${o.code}` : ''}`
  L.push('## Anomalias', '', '| Ator | Relação | Ação | Resultado | Sinal | Detalhe |', '|---|---|---|---|---|---|')
  for (const r of anomalies) L.push(`| ${r.actor.label} | ${REL_LABEL[r.rel]} | ${r.action.label} | ${cell(r.o)} | ${r.f.join('; ')} | ${(r.o.effect ?? r.o.msg ?? '').replace(/\|/g, '/').slice(0, 160)} |`)
  for (const r of globalAnomalies) L.push(`| ${r.actor.label} | sem chamado | ${r.action.label} | ${cell(r.o)} | ${r.f.join('; ')} | ${(r.o.msg ?? '').replace(/\|/g, '/').slice(0, 160)} |`)
  const prep = rows.filter(r => r.o.status === 'preparo')
  if (prep.length) {
    L.push('', '## Preparos que falharam (o cenário não pôde ser montado)', '', '| Ator | Relação | Ação | Erro |', '|---|---|---|---|')
    for (const r of prep) L.push(`| ${r.actor.label} | ${REL_LABEL[r.rel]} | ${r.action.label} | ${(r.o.msg ?? '').replace(/\|/g, '/').slice(0, 200)} |`)
  }
  L.push('', '## Matriz completa', '')
  for (const a of ACTORS) {
    const rels = relsFor(a)
    L.push(`### ${a.label}`, '', `| Ação | ${rels.map(r => REL_LABEL[r]).join(' | ')} |`, `|---|${rels.map(() => '---').join('|')}|`)
    for (const act of ACTIONS) {
      const cells = rels.map(rel => {
        const r = rows.find(x => x.actor === a && x.rel === rel && x.action === act)!
        const txt = r.o.status === 'preparo' ? 'preparo falhou' : `${cell(r.o)}${r.o.effect ? ` (${r.o.effect})` : ''}`
        return `${r.f.length ? '⚠ ' : ''}${txt}`.replace(/\|/g, '/')
      })
      L.push(`| ${act.label} | ${cells.join(' | ')} |`)
    }
    L.push('')
  }
  L.push('## Base de conhecimento e Skadi', '', `| Ação | ${ACTORS.map(a => a.label).join(' | ')} |`, `|---|${ACTORS.map(() => '---').join('|')}|`)
  for (const act of GLOBAL_ACTIONS) {
    const cells = ACTORS.map(a => {
      const r = globalRows.find(x => x.actor === a && x.action === act)!
      return `${r.f.length ? '⚠ ' : ''}${cell(r.o)}`.replace(/\|/g, '/')
    })
    L.push(`| ${act.label} | ${cells.join(' | ')} |`)
  }
  L.push('')
  writeFileSync(file, L.join('\n'))
  const crashes = [...rows, ...globalRows].filter(r => typeof r.o.status === 'number' && r.o.status >= 500).length
  console.log(`relatório: ${file} — ${anomalies.length + globalAnomalies.length} anomalias, ${prep.length} preparos falhos, ${crashes} respostas 5xx`)
}

main().catch(e => { console.error(e); process.exit(1) })
