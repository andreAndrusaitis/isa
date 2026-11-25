// Cria chamados de teste para as empresas do seed-test-rbac.mjs (rode-o antes).
// Cada execução ACRESCENTA mais N chamados (padrão 60), com status, tipo,
// prioridade, categoria e datas (últimos 30 dias) variados.
// Uso (usa a DATABASE_URL do .env — banco local 127.0.0.1:5435):
//   node --env-file=.env prisma/seed-test-tickets.mjs [quantidade]
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const TOTAL = Number(process.argv[2] ?? 60)
const PREFIX = { incident: 'INC', request: 'REQ', problem: 'PRB', change: 'CHG' }
const SLA_HOURS = { gold: 16, silver: 32, bronze: 96, platinum: 8 }
const HOUR = 3600_000

// Pseudoaleatório com semente fixa: a mesma rodada gera sempre a mesma massa.
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const TITLES = [
  ['E-mail não chega na caixa de entrada', 'cat-email'],
  ['Reunião online sem áudio', 'cat-email'],
  ['Acesso negado à pasta do financeiro', 'cat-acessos'],
  ['Licença do editor de planilhas', 'cat-email'],
  ['Antivírus bloqueando aplicativo interno', 'cat-seguranca'],
  ['Atualização do antivírus falhando', 'cat-seguranca'],
  ['Sistema de pedidos sem resposta', 'cat-sistemas'],
  ['Troca de celular e verificação em duas etapas', 'cat-acessos'],
  ['Notebook novo para colaborador', 'cat-equipamentos'],
  ['VPN cai a cada dez minutos', 'cat-rede'],
  ['Arquivo em quarentena indevidamente', 'cat-seguranca'],
  ['Impressora do segundo andar não imprime', 'cat-equipamentos'],
  ['Relatório de vendas com erro', 'cat-sistemas'],
  ['Wi-Fi lento na sala de reunião', 'cat-rede'],
  ['Esqueci a senha do portal', 'cat-acessos'],
]
const STATUSES = ['open', 'open', 'open', 'in_progress', 'in_progress', 'in_progress', 'pending', 'resolved', 'resolved', 'closed']
const TYPES = ['incident', 'incident', 'incident', 'request', 'request', 'problem', 'change']
const PRIORITIES = ['low', 'medium', 'medium', 'high']

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { name: { in: ['ACME Teste', 'Globex Teste', 'Initech Teste'] }, deleted_at: null },
    include: { users: { where: { role: 'user', deleted_at: null } } },
  })
  if (orgs.length !== 3) throw new Error('Rode antes: node --env-file=.env prisma/seed-test-rbac.mjs')

  // Analistas que enxergam cada empresa (pela carteira UserOrgScope).
  const scopes = await prisma.userOrgScope.findMany({
    where: { org_id: { in: orgs.map((o) => o.id) }, user: { role: 'agent', deleted_at: null } },
    select: { org_id: true, user_id: true },
  })
  const agentsByOrg = Object.fromEntries(orgs.map((o) => [o.id, scopes.filter((s) => s.org_id === o.id).map((s) => s.user_id)]))
  const subcats = await prisma.subcategory.findMany({ select: { id: true, category_id: true } })

  const [{ last }] = await prisma.$queryRaw`
    SELECT MAX(CAST(SUBSTRING(id FROM '^ISA-([0-9]+)$') AS INTEGER)) AS last FROM tickets`
  let next = (last ?? 1000) + 1
  const now = Date.now()
  const summary = {}

  for (let i = 0; i < TOTAL; i++) {
    const org = orgs[i % orgs.length]
    const requester = pick(org.users)
    const [title, category_id] = pick(TITLES)
    const status = pick(STATUSES)
    const type = pick(TYPES)
    const priority = pick(PRIORITIES)
    const created = new Date(now - rnd() * 30 * 24 * HOUR)
    const slaHours = SLA_HOURS[org.tier] ?? 24
    const agent = status === 'open' && rnd() < 0.6 ? null : pick(agentsByOrg[org.id])
    const resolvedAt = ['resolved', 'closed'].includes(status)
      ? new Date(Math.min(now, created.getTime() + (2 + rnd() * slaHours * 1.5) * HOUR))
      : null
    const subcat = pick(subcats.filter((s) => s.category_id === category_id))
    const num = next++
    const id = `ISA-${String(num).padStart(4, '0')}`

    await prisma.ticket.create({
      data: {
        id,
        display_number: `${PREFIX[type]}-${String(num).padStart(4, '0')}`,
        title,
        description: `${title}. Chamado de teste gerado pelo seed (${org.name}).`,
        status,
        type,
        priority,
        queue: category_id === 'cat-sistemas' ? 'sistemas' : org.tier === 'gold' ? 'vip' : 'geral',
        category_id,
        subcategory_id: subcat?.id ?? null,
        user_id: requester.id,
        org_id: org.id,
        assigned_to_id: agent,
        sla_deadline: new Date(created.getTime() + slaHours * HOUR),
        first_response_deadline: new Date(created.getTime() + (slaHours / 4) * HOUR),
        pending_reason: status === 'pending' ? pick(['pending_user', 'pending_vendor']) : null,
        resolution_details: resolvedAt ? 'Resolvido no teste: procedimento padrão aplicado.' : null,
        resolved_at: resolvedAt,
        closed_at: status === 'closed' ? resolvedAt : null,
        created_at: created,
        events: { create: [{ user_id: requester.id, to_status: 'open', created_at: created }] },
        messages: agent
          ? { create: [{ user_id: agent, type: 'agent', text: 'Olá! Já estou analisando seu chamado.', created_at: new Date(created.getTime() + HOUR) }] }
          : undefined,
      },
    })

    if (status !== 'open' && agent) {
      const path = { in_progress: ['in_progress'], pending: ['in_progress', 'pending'], resolved: ['in_progress', 'resolved'], closed: ['in_progress', 'resolved', 'closed'] }[status]
      let from = 'open'
      for (const [k, to] of path.entries()) {
        const at = resolvedAt && to !== 'in_progress' ? resolvedAt : new Date(created.getTime() + (k + 1) * HOUR)
        await prisma.ticketEvent.create({ data: { ticket_id: id, user_id: agent, from_status: from, to_status: to, created_at: at } })
        from = to
      }
    }
    const key = `${org.name} / ${status}`
    summary[key] = (summary[key] ?? 0) + 1
  }

  console.log(`${TOTAL} chamados criados (ISA-${last ?? 1000} +).`)
  console.table(summary)
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
