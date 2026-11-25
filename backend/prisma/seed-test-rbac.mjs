// Script idempotente para criar a árvore de teste do modelo RBAC (5 papéis + escopo).
// NÃO é o seed completo — cria apenas usuários/empresas de teste (@isa.local).
// Uso (usa a DATABASE_URL do .env — hoje o banco local 127.0.0.1:5435):
//   node prisma/seed-test-rbac.mjs
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const PASS = 'Teste@123'

async function upsertOrg(name, tier = 'bronze') {
  const found = await prisma.organization.findFirst({ where: { name, deleted_at: null } })
  if (found) return prisma.organization.update({ where: { id: found.id }, data: { tier } })
  return prisma.organization.create({ data: { name, tier } })
}

async function upsertUser({ email, name, role, manager_id = null, queues = [], org_id = null }) {
  const password = await bcrypt.hash(PASS, 10)
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return prisma.user.update({ where: { email }, data: { name, role, manager_id, queues, org_id, active: true, deleted_at: null, password } })
  }
  return prisma.user.create({ data: { email, name, role, manager_id, queues, org_id, password } })
}

async function setScope(userId, orgIds) {
  await prisma.userOrgScope.deleteMany({ where: { user_id: userId } })
  if (orgIds.length) await prisma.userOrgScope.createMany({ data: orgIds.map((org_id) => ({ user_id: userId, org_id })), skipDuplicates: true })
}

// Cliente só vê no wizard as categorias vinculadas ao plano de SLA da empresa.
async function linkAllCategoriesToPlans() {
  const [cats, plans] = await Promise.all([prisma.category.findMany({ select: { id: true } }), prisma.slaConfig.findMany({ select: { id: true } })])
  await prisma.planCategory.createMany({
    data: plans.flatMap((p) => cats.map((c) => ({ sla_config_id: p.id, category_id: c.id }))),
    skipDuplicates: true,
  })
}

async function main() {
  const acme = await upsertOrg('ACME Teste', 'gold')
  const globex = await upsertOrg('Globex Teste', 'silver')
  const initech = await upsertOrg('Initech Teste', 'bronze')
  // Empresa interna da equipe: chamado aberto por analista/TM/gerente para si cai aqui
  // (sem empresa ele nascia órfão — sem fila e invisível para todos menos o solicitante).
  const isa = await upsertOrg('ISA Interna')

  await upsertUser({ email: 'admin.teste@isa.local', name: 'Admin Teste', role: 'admin', org_id: isa.id })

  const gerente = await upsertUser({ email: 'gerente.teste@isa.local', name: 'Gerente Teste', role: 'manager', queues: ['geral'], org_id: isa.id })
  // Carteira pela via que o escopo lê (user_org_scopes); OrgManagerLink não vale mais.
  await setScope(gerente.id, [acme.id, globex.id, initech.id, isa.id])
  await linkAllCategoriesToPlans()

  const tm = await upsertUser({ email: 'tm.teste@isa.local', name: 'Ticket Manager Teste', role: 'supervisor', manager_id: gerente.id, queues: ['geral', 'vip'], org_id: isa.id })
  await setScope(tm.id, [acme.id, globex.id, isa.id])

  const tm2 = await upsertUser({ email: 'tm2.teste@isa.local', name: 'Ticket Manager Dois (só Initech)', role: 'supervisor', manager_id: gerente.id, queues: ['geral', 'sistemas'], org_id: isa.id })
  await setScope(tm2.id, [initech.id])

  const a1 = await upsertUser({ email: 'analista1.teste@isa.local', name: 'Analista Um (só ACME)', role: 'agent', manager_id: tm.id, queues: ['geral', 'vip'], org_id: isa.id })
  await setScope(a1.id, [acme.id]) // restrito: perdeu a Globex

  const a2 = await upsertUser({ email: 'analista2.teste@isa.local', name: 'Analista Dois (ACME+Globex)', role: 'agent', manager_id: tm.id, queues: ['geral'], org_id: isa.id })
  await setScope(a2.id, [acme.id, globex.id, isa.id]) // carteira completa + chamados internos

  const a3 = await upsertUser({ email: 'analista3.teste@isa.local', name: 'Analista Três (Initech)', role: 'agent', manager_id: tm2.id, queues: ['geral', 'sistemas', 'especializada'], org_id: isa.id })
  await setScope(a3.id, [initech.id])

  const endUsers = [
    ['usuario1.acme@isa.local', 'Usuário 1 ACME', acme],
    ['usuario2.acme@isa.local', 'Usuário 2 ACME', acme],
    ['usuario1.globex@isa.local', 'Usuário 1 Globex', globex],
    ['usuario2.globex@isa.local', 'Usuário 2 Globex', globex],
    ['usuario1.initech@isa.local', 'Usuário 1 Initech', initech],
    ['usuario2.initech@isa.local', 'Usuário 2 Initech', initech],
  ]
  for (const [email, name, org] of endUsers) await upsertUser({ email, name, role: 'user', org_id: org.id })

  console.log('Árvore de teste criada/atualizada:')
  console.log('  Empresas: ACME Teste (gold), Globex Teste (silver), Initech Teste (bronze); equipe na ISA Interna')
  console.log('  Senha de todos:', PASS)
  console.table([
    { papel: 'Admin', email: 'admin.teste@isa.local', carteira: 'tudo' },
    { papel: 'Gerente', email: 'gerente.teste@isa.local', carteira: 'ACME+Globex+Initech+ISA Interna' },
    { papel: 'Ticket Manager', email: 'tm.teste@isa.local', carteira: 'ACME+Globex+ISA Interna' },
    { papel: 'Ticket Manager 2', email: 'tm2.teste@isa.local', carteira: 'Initech' },
    { papel: 'Analista 1', email: 'analista1.teste@isa.local', carteira: 'só ACME' },
    { papel: 'Analista 2', email: 'analista2.teste@isa.local', carteira: 'ACME+Globex+ISA Interna' },
    { papel: 'Analista 3', email: 'analista3.teste@isa.local', carteira: 'Initech' },
    ...endUsers.map(([email, , org]) => ({ papel: 'Usuário final', email, carteira: org.name })),
  ])
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
