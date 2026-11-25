import { TARGET_URL } from './seedTarget'
import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedDocsGuide } from './seedDocs'

const prisma = new PrismaClient()

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

function isLocalDatabase(url: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.includes(new URL(url ?? '').hostname)
  } catch {
    return false
  }
}

// O seed grava contas com senha conhecida e reativa as que já existem.
function assertSeedTargetAllowed() {
  if (isLocalDatabase(TARGET_URL) && process.env.NODE_ENV !== 'production') return
  if (process.env.SEED_ALLOW_NON_LOCAL === 'true') {
    console.warn('SEED_ALLOW_NON_LOCAL=true: rodando fora do banco local, com contas de senha conhecida.')
    return
  }
  throw new Error('SEED_TARGET_BLOCKED: o seed só roda em banco local fora de produção. Para liberar de propósito, defina SEED_ALLOW_NON_LOCAL=true.')
}

async function main() {
  assertSeedTargetAllowed()
  console.log('Seeding database...')

  const hash = (pw: string) => bcrypt.hashSync(pw, 10)

  // ── Filas ────────────────────────────────────────────────────────────────
  await prisma.queue.createMany({
    skipDuplicates: true,
    data: [
      { id: 'geral',         name: 'Fila Geral',        color: '#0f73ac', description: 'Atendimento padrão' },
      { id: 'vip',           name: 'Fila VIP',           color: '#a8761b', description: 'Clientes Gold e Platinum' },
      { id: 'especializada', name: 'Mesa Especializada', color: '#5a6d9c', description: 'Casos complexos e N2/N3' },
      { id: 'sistemas',      name: 'Sistemas',           color: '#3a7f6b', description: 'Infra crítica e sistemas' },
    ],
  })

  // ── SLA configs ──────────────────────────────────────────────────────────
  await prisma.slaConfig.createMany({
    skipDuplicates: true,
    data: [
      { tier: 'bronze',   incident_first_response_hours: 24, incident_resolution_hours: 96, default_queue: 'geral', escalation_queue: 'especializada' },
      { tier: 'silver',   incident_first_response_hours: 8,  incident_resolution_hours: 32, default_queue: 'geral', escalation_queue: 'especializada' },
      { tier: 'gold',     incident_first_response_hours: 4,  incident_resolution_hours: 16, default_queue: 'vip',   escalation_queue: 'especializada' },
      { tier: 'platinum', incident_first_response_hours: 2,  incident_resolution_hours: 8,  default_queue: 'vip',   escalation_queue: 'especializada' },
    ],
  })

  // ── Pacotes adicionais (catálogo) ──────────────────────────────────────────
  // O catálogo base é provisionado pela migration de dados
  // 20260602140000_seed_additional_packages_catalog (aplicada em todos os
  // ambientes via `prisma migrate deploy`), então não é semeado aqui.

  // ── Categorias ───────────────────────────────────────────────────────────
  const categories = [
    { id: 'cat-acessos', name: 'Acessos e contas', icon: '🔑', subs: ['Senha e login', 'Verificação em duas etapas', 'Criar ou desativar usuário', 'Permissão de pasta'] },
    { id: 'cat-email', name: 'E-mail e colaboração', icon: '✉', subs: ['E-mail não envia ou não recebe', 'Caixa compartilhada', 'Reuniões e chat', 'Arquivos na nuvem', 'Licenças'] },
    { id: 'cat-rede', name: 'Rede e VPN', icon: '🌐', subs: ['Wi-Fi', 'VPN', 'Internet lenta', 'Liberação de acesso'] },
    { id: 'cat-equipamentos', name: 'Equipamentos', icon: '💻', subs: ['Notebook ou desktop', 'Impressora', 'Monitor e periféricos', 'Celular', 'Instalação de programa'] },
    { id: 'cat-sistemas', name: 'Sistemas', icon: '🧩', subs: ['Erro no sistema', 'Lentidão', 'Relatório', 'Novo acesso'] },
    { id: 'cat-seguranca', name: 'Segurança', icon: '🛡', subs: ['E-mail suspeito', 'Antivírus', 'Perda ou roubo', 'Liberar site ou arquivo'] },
  ]
  for (const { subs, ...category } of categories) {
    await prisma.category.upsert({
      where: { id: category.id },
      update: {},
      create: { ...category, subcategories: { create: subs.map(name => ({ name })) } },
    })
  }

  // ── Usuário sistema (necessário para audit logs internos) ─────────────────
  await prisma.user.upsert({
    where: { email: 'system@isa.local' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Sistema',
      email: 'system@isa.local',
      // Conta interna: sem senha e fora do login.
      password: null,
      is_service_account: true,
      role: Role.admin,
      avatar: '⚙',
      queues: [],
    },
  })

  // ── Organizações e Usuários de teste ───────────────────────────────────────
  console.log('Seeding organizations...')
  async function upsertOrg(name: string) {
    const found = await prisma.organization.findFirst({ where: { name, deleted_at: null } })
    if (found) return found
    return prisma.organization.create({ data: { name } })
  }

  const orgCliente = await upsertOrg('Cafeteria Fiorde')
  const orgInterna = await upsertOrg('ISA Interna')

  console.log('Seeding test users...')
  async function upsertUser({
    name,
    email,
    passwordPlain,
    role,
    orgId = null,
    managerId = null,
    queues = [],
    avatar = null,
    documents = null,
  }: {
    name: string
    email: string
    passwordPlain: string
    role: Role
    orgId?: string | null
    managerId?: string | null
    queues?: string[]
    avatar?: string | null
    documents?: boolean | null
  }) {
    const existing = await prisma.user.findUnique({ where: { email } })
    const data = {
      name,
      password: hash(passwordPlain),
      role,
      org_id: orgId,
      manager_id: managerId,
      queues,
      avatar,
      active: true,
      deleted_at: null,
      ...(documents === null ? {} : { module_documents: documents }),
    }
    if (existing) {
      return prisma.user.update({
        where: { email },
        data,
      })
    }
    return prisma.user.create({
      data: {
        email,
        ...data,
      },
    })
  }

  // 1. Admin Padrão
  const admin = await upsertUser({
    name: 'Admin Padrão',
    email: 'admin@admin.com',
    passwordPlain: 'admin',
    role: Role.admin,
    avatar: 'AD',
    queues: [],
  })

  // 2. Gerente Padrão (Role: manager)
  const gerente = await upsertUser({
    name: 'Gerente Padrão',
    email: 'gerente@gerente.com',
    passwordPlain: 'gerente',
    role: Role.manager,
    avatar: 'GE',
    documents: true,
    orgId: orgInterna.id,
    queues: [],
  })

  // 3. Ticket Master Padrão (Role: supervisor)
  const ticketmaster = await upsertUser({
    name: 'Ticket Master Padrão',
    email: 'ticketmaster@ticketmaster.com',
    passwordPlain: 'ticketmaster',
    role: Role.supervisor,
    avatar: 'TM',
    documents: true,
    orgId: orgInterna.id,
    managerId: gerente.id,
    queues: ['geral'],
  })

  // 4. Analista Padrão (Role: agent)
  const agente = await upsertUser({
    name: 'Analista Padrão',
    email: 'agente@agente.com',
    passwordPlain: 'agente',
    role: Role.agent,
    avatar: 'AN',
    documents: true,
    orgId: orgInterna.id,
    managerId: ticketmaster.id,
    queues: ['geral'],
  })

  // 5. Usuário Padrão (Role: user)
  await upsertUser({
    name: 'Usuário Padrão',
    email: 'user@user.com',
    passwordPlain: 'user#2user',
    role: Role.user,
    avatar: 'US',
    orgId: orgCliente.id,
    queues: [],
  })

  // Links de Gerente (OrgManagerLink)
  await prisma.orgManagerLink.upsert({
    where: {
      org_id_manager_id: {
        org_id: orgInterna.id,
        manager_id: gerente.id
      }
    },
    update: {},
    create: {
      org_id: orgInterna.id,
      manager_id: gerente.id
    }
  })

  // Scopes de Supervisor/Analista (UserOrgScope)
  await prisma.userOrgScope.upsert({
    where: {
      user_id_org_id: {
        user_id: ticketmaster.id,
        org_id: orgInterna.id
      }
    },
    update: {},
    create: {
      user_id: ticketmaster.id,
      org_id: orgInterna.id
    }
  })

  await prisma.userOrgScope.upsert({
    where: {
      user_id_org_id: {
        user_id: agente.id,
        org_id: orgInterna.id
      }
    },
    update: {},
    create: {
      user_id: agente.id,
      org_id: orgInterna.id
    }
  })

  // ── Regras de roteamento ─────────────────────────────────────────────────
  if (await prisma.routingRule.count() === 0) await prisma.routingRule.createMany({
    data: [
      { name: 'Platinum → Fila VIP',       enabled: true,  priority: 1, conditions: [{ field: 'org_tier', operator: 'equals', value: 'platinum' }], match_type: 'all', actions: [{ type: 'set_queue', value: 'vip' }, { type: 'set_priority', value: 'high' }] },
      { name: 'Gold → Fila VIP',           enabled: true,  priority: 2, conditions: [{ field: 'org_tier', operator: 'equals', value: 'gold' }],     match_type: 'all', actions: [{ type: 'set_queue', value: 'vip' }] },
      { name: 'Sistemas → Fila Sistemas',  enabled: true,  priority: 3, conditions: [{ field: 'category', operator: 'equals', value: 'cat-sistemas' }], match_type: 'all', actions: [{ type: 'set_queue', value: 'sistemas' }] },
      { name: 'Segurança → Especializada', enabled: false, priority: 4, conditions: [{ field: 'category', operator: 'equals', value: 'cat-seguranca' }], match_type: 'all', actions: [{ type: 'set_queue', value: 'especializada' }] },
    ],
  })

  // ── Survey Template & Questions ──────────────────────────────────────────
  console.log('Seeding survey template and questions...')
  
  const activeTemplate = await prisma.surveyTemplate.findFirst({
    where: { ativo: true }
  })

  if (!activeTemplate) {
    const template = await prisma.surveyTemplate.create({
      data: {
        nome: 'Pesquisa Padrão',
        assunto_email: 'Como foi o seu atendimento? — Chamado #{numero_chamado}',
        corpo_convite_auto: `Olá, {nome_cliente}!

Seu chamado #{numero_chamado} – {titulo_chamado} foi concluído pelo nosso time. Sua opinião é rápida (menos de 1 minuto) e nos ajuda a melhorar continuamente o atendimento.

👉 Responder pesquisa de satisfação:
{link_pesquisa}

O link é exclusivo deste chamado e pode ser respondido uma única vez.`,
        corpo_convite_macro: `Foi um prazer atender você! 😊 Para finalizarmos, você poderia avaliar este atendimento? Leva menos de 1 minuto:

👉 Avaliar atendimento:
{link_pesquisa}`,
        ativo: true
      }
    })

    // Q1 — resolução do chamado (escolha única com ação de reabertura)
    await prisma.surveyQuestion.create({
      data: {
        template_id: template.id,
        ordem: 1,
        enunciado: 'Seu chamado foi resolvido?',
        tipo: 'escolha_unica',
        obrigatoria: true,
        opcoes: {
          create: [
            { ordem: 1, rotulo: 'Sim, totalmente', valor: 'total' },
            { ordem: 2, rotulo: 'Parcialmente',    valor: 'parcial' },
            { ordem: 3, rotulo: 'Não',             valor: 'nao', acao: 'reabrir_chamado' },
          ]
        }
      }
    })

    // Q2 — satisfação geral (escala emoji 1–5)
    await prisma.surveyQuestion.create({
      data: {
        template_id: template.id,
        ordem: 2,
        enunciado: 'De forma geral, qual o seu nível de satisfação com o atendimento deste chamado?',
        tipo: 'escala',
        estilo: 'emoji',
        obrigatoria: true,
        opcoes: {
          create: [
            { ordem: 1, rotulo: 'Muito Insatisfeito', valor: '1', pontuacao: 1, emoji: '😠' },
            { ordem: 2, rotulo: 'Insatisfeito',        valor: '2', pontuacao: 2, emoji: '🙁' },
            { ordem: 3, rotulo: 'Neutro',              valor: '3', pontuacao: 3, emoji: '😐' },
            { ordem: 4, rotulo: 'Satisfeito',          valor: '4', pontuacao: 4, emoji: '🙂' },
            { ordem: 5, rotulo: 'Muito Satisfeito',    valor: '5', pontuacao: 5, emoji: '😄' },
          ]
        }
      }
    })

    // Q3 — avaliação do tempo de atendimento (escolha única)
    await prisma.surveyQuestion.create({
      data: {
        template_id: template.id,
        ordem: 3,
        enunciado: 'Como você avalia o tempo até a conclusão do chamado?',
        tipo: 'escolha_unica',
        obrigatoria: false,
        opcoes: {
          create: [
            { ordem: 1, rotulo: 'Muito rápido', valor: 'muito_rapido' },
            { ordem: 2, rotulo: 'Adequado',      valor: 'adequado' },
            { ordem: 3, rotulo: 'Lento',         valor: 'lento' },
            { ordem: 4, rotulo: 'Muito lento',   valor: 'muito_lento' },
          ]
        }
      }
    })

    // Q4 — clareza e cordialidade (escala estrela 1–5)
    await prisma.surveyQuestion.create({
      data: {
        template_id: template.id,
        ordem: 4,
        enunciado: 'Como você avalia a clareza e a cordialidade no atendimento?',
        tipo: 'escala',
        estilo: 'estrela',
        obrigatoria: false,
        opcoes: {
          create: [
            { ordem: 1, rotulo: 'Ruim',      valor: '1', pontuacao: 1 },
            { ordem: 2, rotulo: 'Regular',   valor: '2', pontuacao: 2 },
            { ordem: 3, rotulo: 'Bom',       valor: '3', pontuacao: 3 },
            { ordem: 4, rotulo: 'Muito Bom', valor: '4', pontuacao: 4 },
            { ordem: 5, rotulo: 'Excelente', valor: '5', pontuacao: 5 },
          ]
        }
      }
    })

    // Q5 — comentário livre (sem opções)
    await prisma.surveyQuestion.create({
      data: {
        template_id: template.id,
        ordem: 5,
        enunciado: 'Deseja deixar algum comentário ou sugestão?',
        tipo: 'texto_livre',
        obrigatoria: false,
      }
    })
    console.log('Template de pesquisa e perguntas criados com sucesso.')
  } else {
    console.log('Template de pesquisa ativo já existente. Seed pulado.')
  }

  // ── Documentos ───────────────────────────────────────────────────────────
  await seedDocsGuide(prisma, { owners: [admin.id, gerente.id], editors: [ticketmaster.id] })

  console.log('\nSeed concluído.')
  console.log('Usuários de teste:')
  console.log('  admin@admin.com               (senha: admin)            → Admin (Sem Organização)')
  console.log('  gerente@gerente.com           (senha: gerente)          → Gerente (Organização: ISA Interna)')
  console.log('  ticketmaster@ticketmaster.com (senha: ticketmaster)     → Ticket Manager (Organização: ISA Interna)')
  console.log('  agente@agente.com             (senha: agente)           → Analista (Organização: ISA Interna)')
  console.log('  user@user.com                 (senha: user#2user)       → Usuário Final (Organização: Cafeteria Fiorde)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
