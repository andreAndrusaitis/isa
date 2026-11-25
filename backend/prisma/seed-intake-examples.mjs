// Grava no banco LOCAL os casos de src/ai/eval/intake-casos.json (agente de
// completude na abertura) como chamados abertos, com anexos fictícios.
// Rode antes o seed-test-rbac.mjs. Cada execução ACRESCENTA os casos de novo.
// Uso: node --env-file=.env prisma/seed-intake-examples.mjs
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL ?? ''
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('Só roda em banco local (DATABASE_URL não é 127.0.0.1/localhost)')

const prisma = new PrismaClient()
const { casos } = JSON.parse(readFileSync(new URL('../src/ai/eval/intake-casos.json', import.meta.url), 'utf8'))
const PREFIX = { incident: 'INC', request: 'REQ' }
const HOUR = 3600_000

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { name: { in: ['ACME Teste', 'Globex Teste', 'Initech Teste'] }, deleted_at: null },
    include: { users: { where: { role: 'user', deleted_at: null } } },
  })
  if (orgs.length !== 3) throw new Error('Rode antes: node --env-file=.env prisma/seed-test-rbac.mjs')
  const staff = await prisma.user.findFirst({ where: { role: 'agent', deleted_at: null } })
  if (!staff) throw new Error('Nenhum analista no banco local')

  const [{ last }] = await prisma.$queryRaw`
    SELECT MAX(CAST(SUBSTRING(id FROM '^ISA-([0-9]+)$') AS INTEGER)) AS last FROM tickets`
  let next = (last ?? 1000) + 1
  const now = Date.now()
  const created = []

  for (const [i, c] of casos.entries()) {
    const org = orgs[i % orgs.length]
    const requester = c.solicitante === 'agent' ? staff : org.users[i % org.users.length]
    const num = next++
    const id = `ISA-${String(num).padStart(4, '0')}`
    const at = new Date(now - (casos.length - i) * HOUR)
    await prisma.ticket.create({
      data: {
        id,
        display_number: `${PREFIX[c.type]}-${String(num).padStart(4, '0')}`,
        title: c.title,
        description: c.description,
        type: c.type,
        // E-mail chega sempre na mesma categoria (a padrão do e-mail); portal escolhe.
        category_id: c.canal === 'email' ? 'cat-email' : 'cat-equipamentos',
        user_id: requester.id,
        created_by_id: c.canal === 'portal' ? requester.id : null,
        org_id: org.id,
        sla_deadline: new Date(at.getTime() + 96 * HOUR),
        first_response_deadline: new Date(at.getTime() + 24 * HOUR),
        created_at: at,
        events: { create: [{ user_id: requester.id, to_status: 'open', created_at: at }] },
        attachments: { create: c.anexos.map(a => ({ name: a.name, type: a.type, size: '10 KB', url: `intake-exemplo/${a.name}` })) },
      },
    })
    created.push({ id, caso: c.key, canal: c.canal, esperado: c.esperado.acao, faltam: (c.esperado.faltam ?? []).join(',') })
  }
  console.table(created)
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
