/**
 * Catálogo de capacidades: o que cada pessoa pode fazer, com nome claro.
 *
 * Cada capacidade diz:
 * - `roles`: cargos que já a recebem (o admin recebe todas);
 * - `area`: a área de `users.permissions` que a libera para quem não tem pelo cargo
 *   (o valor gravado no banco continua o mesmo; não há migração);
 * - `module`: módulo que precisa estar ligado para a pessoa (Chamados/Projetos/Documentos),
 *   além do cargo ou da área. Chamados desligado bloqueia o atendimento.
 *
 * Os padrões reproduzem exatamente as travas antigas (authorize/authorizeArea),
 * comprovado rota por rota em access/equivalence.test.ts. Mudar um padrão aqui é
 * mudar quem acessa o quê: o teste de equivalência precisa ser atualizado junto.
 */
export type Role = 'admin' | 'manager' | 'supervisor' | 'agent' | 'user'
export type Module = 'tickets' | 'projects' | 'documents'
export type CapabilityGroup = 'chamados' | 'gestao' | 'cadastros' | 'configuracoes' | 'sistema' | 'projetos' | 'documentos'

export interface Capability {
  label: string
  group: CapabilityGroup
  roles: readonly Exclude<Role, 'admin'>[]
  area?: string
  module?: Module
  /**
   * Opção da ficha: decide `users.permissions` com o padrão do cargo (DEFAULT_ROLE_PERMISSIONS)
   * enquanto a pessoa não tiver lista própria — dá para desligar de um TM, por exemplo.
   */
  perPerson?: boolean
  /** O admin não recebe (olha os chamados, não atende). */
  notAdmin?: boolean
}

const MGMT = ['supervisor', 'manager'] as const
const STAFF = ['agent', 'supervisor', 'manager'] as const

export const CAPABILITIES = {
  // ── Chamados ──
  'tickets.create': { label: 'Abrir chamados', group: 'chamados', roles: ['user', ...STAFF] },
  // Uma trava só hoje cobre atender, respostas prontas, prazos e regras de escalonamento
  // (mesma assinatura); separar quando cada rota declarar a sua capacidade.
  'tickets.work': { label: 'Atender chamados (com respostas prontas, prazos e escalonamento)', group: 'chamados', roles: STAFF, module: 'tickets' },
  'tickets.join': { label: 'Entrar como acompanhante no chamado', group: 'chamados', roles: ['agent'], module: 'tickets' },
  'tickets.delete': { label: 'Excluir chamados', group: 'chamados', roles: [], area: 'delete_tickets' },
  // TM já vem com a opção ligada (padrão do cargo); qualquer pessoa da equipe pode ganhá-la na ficha.
  'tickets.messages.moderate': { label: 'Editar e apagar mensagens de outras pessoas nos chamados', group: 'chamados', roles: [], area: 'edit_messages', perPerson: true, notAdmin: true },

  // ── Gestão ──
  'dashboard.view': { label: 'Painéis gerenciais e insights da IA', group: 'gestao', roles: MGMT, area: 'dash_main', module: 'tickets' },
  'knowledge.metrics': { label: 'Métricas da base de conhecimento', group: 'gestao', roles: ['manager'], module: 'tickets' },
  'survey.dashboard': { label: 'Resultado das pesquisas', group: 'gestao', roles: MGMT, area: 'survey_dashboard', module: 'tickets' },
  'audit.view': { label: 'Auditoria', group: 'gestao', roles: MGMT, area: 'audit' },
  'scope.view_own': { label: 'Ver a própria carteira e equipe', group: 'gestao', roles: MGMT },
  'org_chart.links.view': { label: 'Ver vínculos gerente ↔ empresa', group: 'gestao', roles: ['manager'], area: 'organograma' },
  'inactivity.logs.view': { label: 'Histórico de redirecionamento por inatividade', group: 'gestao', roles: ['supervisor'], area: 'inactivity' },

  // ── Cadastros ──
  'orgs.view': { label: 'Ver uma empresa', group: 'cadastros', roles: ['user', ...STAFF], area: 'orgs' },
  'orgs.edit': { label: 'Listar e editar empresas da carteira, domínios de login', group: 'cadastros', roles: STAFF, area: 'orgs' },
  'orgs.manage': { label: 'Criar e excluir empresas, filas da empresa', group: 'cadastros', roles: MGMT, area: 'orgs' },
  'users.edit': { label: 'Ver, criar e editar pessoas', group: 'cadastros', roles: STAFF, area: 'users' },
  'users.delete': { label: 'Excluir pessoas e ver a carteira delas', group: 'cadastros', roles: MGMT, area: 'users' },

  // ── Configurações ──
  'queues.manage': { label: 'Filas', group: 'configuracoes', roles: MGMT, area: 'queues' },
  'categories.manage': { label: 'Categorias', group: 'configuracoes', roles: MGMT, area: 'categories' },
  'macros.manage': { label: 'Respostas prontas', group: 'configuracoes', roles: MGMT, area: 'macros' },
  'sla.manage': { label: 'Planos e prazos (SLA)', group: 'configuracoes', roles: MGMT, area: 'sla' },
  'routing.manage': { label: 'Roteamento', group: 'configuracoes', roles: MGMT, area: 'routing' },
  'escalation.manage': { label: 'Escalonamento', group: 'configuracoes', roles: MGMT, area: 'escalation' },
  'survey.templates.view': { label: 'Ver modelos de pesquisa', group: 'configuracoes', roles: MGMT, area: 'survey' },
  'survey.manage': { label: 'Modelos de pesquisa', group: 'configuracoes', roles: [], area: 'survey' },
  'packages.manage': { label: 'Pacotes adicionais', group: 'configuracoes', roles: [], area: 'packages' },
  'business_hours.manage': { label: 'Horário comercial', group: 'configuracoes', roles: [], area: 'business_hours' },
  'inactivity.manage': { label: 'Redirecionamento por inatividade', group: 'configuracoes', roles: [], area: 'inactivity' },
  'reopen_sla.manage': { label: 'Prazo de reabertura', group: 'configuracoes', roles: [], area: 'reopen_sla' },
  'auto_close.manage': { label: 'Fechamento automático', group: 'configuracoes', roles: [], area: 'auto_close' },
  'ticket_types.manage': { label: 'Tipos de chamado', group: 'configuracoes', roles: [], area: 'ticket_types' },

  // ── Sistema (só o admin libera) ──
  'integrations.manage': { label: 'Webhooks e chaves de API', group: 'sistema', roles: [], area: 'webhooks' },
  // A tela de webhooks filtra por qualquer empresa: quem tem "webhooks" lista todas.
  'orgs.read_all': { label: 'Listar todas as empresas (filtro de integrações)', group: 'sistema', roles: [], area: 'webhooks' },
  'email_logs.view': { label: 'E-mails enviados', group: 'sistema', roles: [], area: 'email_logs' },
  'trash.manage': { label: 'Lixeira de chamados', group: 'sistema', roles: [], area: 'trash' },
  'system.admin': { label: 'Administração do sistema (IA, vínculos, carteira de gerentes)', group: 'sistema', roles: [] },

  // ── Projetos ──
  // Vale o módulo efetivo da pessoa (ficha + herança do gerente); cliente final nunca tem Projetos.
  'projects.use': { label: 'Usar o módulo Projetos', group: 'projetos', roles: ['user', ...STAFF], module: 'projects' },
  // Liberações próprias de Projetos (separadas das áreas de chamados): o cargo dá; a área libera para os demais.
  'projects.reports': { label: 'Relatórios de Projetos (painéis, equipe, horas, dossiê)', group: 'projetos', roles: MGMT, area: 'projects_reports', module: 'projects' },
  'projects.integrations': { label: 'Webhooks e chaves de API de Projetos', group: 'projetos', roles: ['manager'], area: 'projects_integrations', module: 'projects' },
  'projects.global.manage': { label: 'Sprints globais e pastas', group: 'projetos', roles: ['manager'], area: 'projects_sprints' },

  // ── Documentos ──
  // Só o módulo decide; o que cada um vê e edita vem do papel no espaço (services/docAccess).
  'documents.use': { label: 'Usar o módulo Documentos', group: 'documentos', roles: ['user', ...STAFF], module: 'documents' },
} as const satisfies Record<string, Capability>

export type CapabilityKey = keyof typeof CAPABILITIES

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[]
