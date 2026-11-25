/**
 * Rodada integrada: os 3 agentes (triagem, intake, guidance) junto com regras de roteamento,
 * no ambiente que estiver no ar (API) e no banco do DATABASE_URL (leitura da linha do tempo).
 * Cria/recria as regras "[Teste IA]" limitadas à empresa ACME Teste, abre os chamados dos
 * cenários como o cliente, faz o papel do cliente (complemento, "Resolveu", vincular) e grava
 * um relatório JSON com a linha do tempo de cada chamado e o consumo dos agentes.
 *
 *   API=http://localhost:3001/api [REQUESTER=usuario2.acme@isa.local] npx tsx src/ai/eval/runIntegratedRound.ts [--out arquivo.json] [--keep-rules]
 *
 * Usuários do seed-test-rbac (banco local): usuario1.acme@isa.local, tm.teste@isa.local, admin@admin.com.
 * Sem --keep-rules as regras "[Teste IA]" são desativadas no fim (ficam para consulta, sem efeito).
 */
import { writeFileSync } from 'node:fs'
import prisma from '../../config/prisma'
import { SYSTEM_USER_ID } from '../../utils/constants'
import { PRICE_PER_M } from '../routes'

const API = process.env.API ?? 'http://localhost:3001/api'
const TAG = '[Teste IA]'
const ORG = 'ACME Teste'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function login(email: string, password: string) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return ((await r.json()) as any).data.accessToken as string
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, data: json?.data ?? json ?? text }
}

interface Scenario {
  key: string
  title: string
  description: string
  /** O que se espera ver (vai para o relatório). */
  expect: string
  /** Ação do cliente depois da IA: responder a orientação ou o duplicado. */
  answer?: 'resolved' | 'declined' | 'link'
  /** Só abre depois deste (duplicidade). */
  after?: string
  /** Resposta do cliente se o intake pedir complemento. */
  complement?: string
}

const SCENARIOS: Scenario[] = [
  { key: 'T1-urgente-outlook', title: 'URGENTE: Outlook não abre', description: 'O Outlook não abre no meu notebook desde hoje cedo, fica travado na tela de carregamento.',
    expect: 'Regra R1 põe prioridade Alta; a triagem (apply) pode rebaixar; R4 (piso) impede Baixa. Guidance orienta.' },
  { key: 'T2-teams-macro', title: 'Teams sem áudio nas reuniões', description: 'Nas reuniões do Teams ninguém me escuta. O fone funciona em outros aplicativos.',
    expect: 'Regra R3 manda macro de recebimento; guidance também fala: o cliente recebe 2 mensagens automáticas.', answer: 'declined' },
  { key: 'T3-impressora-status', title: 'Impressora do andar aparece offline', description: 'A impressora do andar aparece offline no meu computador, para os colegas funciona.',
    expect: 'Regra R5 põe Em andamento na abertura: intake e guidance não falam com o cliente (chamado já em atendimento).' },
  { key: 'T4-senha-tipo', title: 'Esqueci a senha do e-mail', description: 'Esqueci minha senha do e-mail e não consigo entrar no Outlook pela web.',
    expect: 'Regra R2 muda o tipo para Requisição; a triagem pode devolver para Incidente; guidance decide entre orientar e não orientar.' },
  { key: 'T5-licenca-equipe', title: 'Licença do Project', description: 'Preciso de uma licença do Microsoft Project para planejar o cronograma do time.',
    expect: 'Pedido de equipe: guidance não orienta, deixa dicas internas.' },
  { key: 'T6-vago-complemento', title: 'Problema no sistema', description: 'Não está funcionando.',
    expect: 'Intake pede complemento; a resposta do cliente dispara R6 (mensagem do cliente) e o guidance roda depois.',
    complement: 'É o Excel do meu notebook: fecha sozinho quando abro planilhas grandes, desde ontem. Não aparece mensagem de erro.' },
  { key: 'T7-ruido-excluido', title: 'RE: Chamado resolvido', description: 'Obrigado, pode encerrar.',
    expect: 'Regra R8 manda o chamado para a Lixeira na abertura: os agentes não devem atuar.' },
  { key: 'T8-duplicado', title: 'Outlook continua sem abrir', description: 'O Outlook segue travando na abertura, igual reportei hoje cedo.',
    expect: 'Guidance oferece vincular ao T1; o cliente vincula e o chamado fecha.', answer: 'link', after: 'T1-urgente-outlook',
    complement: 'Quando abro o Outlook ele fica travado na tela de carregamento, igual ao chamado de hoje cedo.' },
  { key: 'T9-deflexao', title: 'Apaguei uma planilha do OneDrive', description: 'Excluí sem querer uma planilha da minha pasta do OneDrive ontem e preciso recuperar.',
    expect: 'Guidance orienta pela lixeira; o cliente clica Resolveu; R7 (resolvido) avisa o Ticket Manager.', answer: 'resolved',
    complement: 'Não tenho print: a planilha simplesmente sumiu da pasta Documentos do OneDrive.' },
]

async function setupRules(admin: string, orgId: string, tmId: string, macroId: string) {
  const existing = (await call(admin, 'GET', '/routing')).data as any[]
  for (const r of existing.filter(r => r.name.startsWith(TAG))) await call(admin, 'DELETE', `/routing/${r.id}`)
  const org = { field: 'organization', operator: 'equals', value: orgId }
  // Prioridade negativa: rodam antes de "Gold → Fila VIP" (prioridade 2, que para a avaliação).
  const rules = [
    { name: `${TAG} R1 URGENTE no assunto → prioridade Alta`, trigger: 'ticket_created', priority: -10, conditions: [org, { field: 'subject_contains', operator: 'contains', value: 'URGENTE' }], actions: [{ type: 'set_priority', value: 'high' }] },
    { name: `${TAG} R2 "senha" na descrição → Requisição`, trigger: 'ticket_created', priority: -9, conditions: [org, { field: 'description', operator: 'contains', value: 'senha' }], actions: [{ type: 'set_type', value: 'request' }] },
    { name: `${TAG} R3 Teams → macro de recebimento`, trigger: 'ticket_created', priority: -8, conditions: [org, { field: 'subject_contains', operator: 'contains', value: 'Teams' }], actions: [{ type: 'send_macro', value: macroId }] },
    { name: `${TAG} R5 Impressora → Em andamento`, trigger: 'ticket_created', priority: -7, conditions: [org, { field: 'subject_contains', operator: 'contains', value: 'Impressora' }], actions: [{ type: 'set_status', value: 'in_progress' }] },
    { name: `${TAG} R8 "RE:" no assunto → Lixeira`, trigger: 'ticket_created', priority: -6, conditions: [org, { field: 'subject_contains', operator: 'starts_with', value: 'RE:' }], actions: [{ type: 'delete_ticket', value: '' }] },
    { name: `${TAG} R4 piso VIP: Baixa → Média`, trigger: 'ticket_updated', priority: -5, conditions: [org, { field: 'priority', operator: 'equals', value: 'low' }], actions: [{ type: 'set_priority', value: 'medium' }] },
    { name: `${TAG} R6 mensagem do cliente → avisa o TM`, trigger: 'client_message', priority: -4, conditions: [org], actions: [{ type: 'notify_user', value: tmId }] },
    { name: `${TAG} R7 resolvido → avisa o TM`, trigger: 'ticket_updated', priority: -3, conditions: [org, { field: 'status', operator: 'equals', value: 'resolved' }], actions: [{ type: 'notify_user', value: tmId }] },
  ]
  const created: { id: string; name: string }[] = []
  for (const r of rules) {
    const res = await call(admin, 'POST', '/routing', { ...r, matchType: 'all', stopProcessing: false, enabled: true })
    if (res.status >= 300) throw new Error(`regra ${r.name}: ${res.status} ${JSON.stringify(res.data)}`)
    created.push({ id: res.data.id, name: r.name })
  }
  return created
}

async function timeline(ticketId: string) {
  const [events, messages] = await Promise.all([
    prisma.ticketEvent.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' }, include: { user: { select: { email: true } } } }),
    prisma.ticketMessage.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' }, include: { user: { select: { email: true } } } }),
  ])
  const who = (id: string, email?: string) => (id === SYSTEM_USER_ID ? 'Sistema/IA' : email ?? id)
  return [
    ...events.map(e => ({ at: e.created_at, kind: 'evento', who: e.routing_rule_id ? 'Regra' : who(e.user_id, e.user?.email),
      text: `${e.from_status ?? '∅'}→${e.to_status}${e.note ? ` · ${e.note}` : ''}` })),
    ...messages.map(m => ({ at: m.created_at, kind: m.type === 'internal' ? 'nota interna' : 'mensagem pública', who: who(m.user_id, m.user?.email),
      text: m.text })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())
}

async function main() {
  const outIdx = process.argv.indexOf('--out')
  const out = outIdx > 0 ? process.argv[outIdx + 1] : null
  const keepRules = process.argv.includes('--keep-rules')
  const started = new Date()

  const admin = await login('admin@admin.com', 'admin')
  const user = await login(process.env.REQUESTER ?? 'usuario1.acme@isa.local', 'Teste@123')
  const acme = await prisma.organization.findFirstOrThrow({ where: { name: ORG }, select: { id: true } })
  const tm = await prisma.user.findFirstOrThrow({ where: { email: 'tm.teste@isa.local' }, select: { id: true } })
  const macro = await prisma.macro.findFirst({ where: { title: `${TAG} Recebimento Teams`, active: true } })
    ?? (await call(admin, 'POST', '/macros', { title: `${TAG} Recebimento Teams`, content: 'Recebemos seu chamado sobre o Teams e ele já está na fila do time de Colaboração. Em breve um analista entra em contato.' })).data
  const rules = await setupRules(admin, acme.id, tm.id, macro.id)
  const modes = await prisma.aiAgentSetting.findMany()
  console.log(`regras criadas: ${rules.length} · modos: ${modes.map(m => `${m.agent}=${m.mode}`).join(', ')}`)

  // Abre os chamados como o cliente (duplicados depois do original).
  const created: Record<string, { id: string; display: string }> = {}
  for (const s of SCENARIOS) {
    if (s.after) await sleep(4000)
    const r = await call(user, 'POST', '/tickets', { title: s.title, description: s.description })
    if (r.status >= 300) throw new Error(`${s.key}: ${r.status} ${JSON.stringify(r.data)}`)
    created[s.key] = { id: r.data.id, display: r.data.displayNumber ?? r.data.display_number }
    console.log(`aberto ${s.key} → ${created[s.key].display}`)
    await sleep(800)
  }

  // Espera a cadeia; responde ao intake quando ele pedir complemento.
  const answered = new Set<string>()
  const t0 = Date.now()
  while (Date.now() - t0 < 300_000) {
    const tickets = await prisma.ticket.findMany({ where: { id: { in: Object.values(created).map(c => c.id) } }, select: { id: true, intake_status: true, guidance_status: true, deleted_at: true, status: true } })
    for (const t of tickets) {
      if (t.intake_status === 'incomplete' && !answered.has(t.id)) {
        answered.add(t.id)
        const s = SCENARIOS.find(x => created[x.key]?.id === t.id)
        await call(user, 'POST', `/tickets/${t.id}/messages`, { text: s?.complement ?? 'Acontece no meu notebook, comigo mesmo. Não aparece mensagem de erro.', type: 'user' })
        console.log(`  intake pediu complemento em ${t.id}: cliente respondeu`)
      }
    }
    const runs = await prisma.aiAgentRun.groupBy({ by: ['ticket_id'], where: { agent: 'guidance', ticket_id: { in: tickets.map(t => t.id) } }, _count: true })
    const done = new Set(runs.map(r => r.ticket_id))
    // Terminado: guidance rodou, ou o chamado foi excluído/saiu de "aberto" e o intake já decidiu.
    const pending = tickets.filter(t => !done.has(t.id) && !t.deleted_at && t.intake_status !== 'incomplete' && !(t.status !== 'open' && t.intake_status))
    if (!pending.length && tickets.every(t => t.intake_status !== 'incomplete' || answered.has(t.id)) && Date.now() - t0 > 30_000) {
      const waitingComplement = tickets.filter(t => answered.has(t.id) && !done.has(t.id))
      if (!waitingComplement.length) break
    }
    await sleep(5000)
  }
  console.log(`cadeia concluída em ${Math.round((Date.now() - t0) / 1000)}s`)

  // Respostas do cliente à IA.
  const answers: Record<string, string> = {}
  for (const s of SCENARIOS.filter(s => s.answer)) {
    const res = await call(user, 'POST', `/ai/guidance/tickets/${created[s.key].id}/${s.answer}`)
    answers[s.key] = `${s.answer} → HTTP ${res.status}${res.status >= 300 ? ` (${res.data?.error ?? ''})` : ''}`
    console.log(`  ${s.key}: ${answers[s.key]}`)
  }
  await sleep(4000)

  // Relatório.
  const ids = Object.values(created).map(c => c.id)
  const tickets = await prisma.ticket.findMany({ where: { id: { in: ids } }, include: { org: { select: { name: true } } } })
  const runs = await prisma.aiAgentRun.findMany({ where: { ticket_id: { in: ids } }, orderBy: { created_at: 'asc' } })
  const report = {
    api: API, started, finished: new Date(), modes: modes.map(m => ({ agent: m.agent, mode: m.mode })),
    rules: rules.map(r => r.name),
    scenarios: await Promise.all(SCENARIOS.map(async s => {
      const t = tickets.find(x => x.id === created[s.key].id)!
      return {
        key: s.key, display: t.display_number, title: s.title, expect: s.expect, answer: answers[s.key] ?? null,
        final: { type: t.type, priority: t.priority, queue: t.queue, status: t.status, intake_status: t.intake_status, guidance_status: t.guidance_status, deleted: !!t.deleted_at },
        runs: runs.filter(r => r.ticket_id === t.id).map(r => ({ agent: r.agent, mode: r.mode, status: r.status, ms: r.latency_ms, tokens: r.input_tokens + r.output_tokens, error: r.error?.slice(0, 120) ?? null })),
        timeline: (await timeline(t.id)).map(e => ({ ...e, at: e.at.toISOString().slice(11, 19), text: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text })),
      }
    })),
    usage: Object.values(runs.reduce((acc, r) => {
      const a = acc[r.agent] ??= { agent: r.agent, runs: 0, errors: 0, inputTokens: 0, outputTokens: 0, latencyMs: [] as number[] }
      a.runs++; if (r.status === 'error') a.errors++
      a.inputTokens += r.input_tokens; a.outputTokens += r.output_tokens; a.latencyMs.push(r.latency_ms)
      return acc
    }, {} as Record<string, any>)).map((a: any) => {
      const sorted = [...a.latencyMs].sort((x: number, y: number) => x - y)
      return { agent: a.agent, runs: a.runs, errors: a.errors, inputTokens: a.inputTokens, outputTokens: a.outputTokens,
        latencyP50: sorted[Math.floor(sorted.length / 2)], latencyMax: sorted.at(-1),
        costUsd: +((a.inputTokens * PRICE_PER_M.input + a.outputTokens * PRICE_PER_M.output) / 1e6).toFixed(4) }
    }),
  }
  if (!keepRules) for (const r of rules) await call(admin, 'PATCH', `/routing/${r.id}`, { enabled: false })
  const file = out ?? `integrated-round-${Date.now()}.json`
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`relatório: ${file}${keepRules ? '' : ' · regras [Teste IA] desativadas'}`)
}

main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
