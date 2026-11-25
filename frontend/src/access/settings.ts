/**
 * Ajustes do sistema por intenção ("como atendemos", "para onde vai"…). Fonte
 * única da seção Configurações do menu e da busca da tela Saúde.
 */
import {
  ArrowUpCircle, BookOpen, BrainCircuit, ClipboardList, Clock, FolderTree, GitBranch, KeyRound, Layers, ListChecks, Lock, Mail,
  MessageSquareText, Package, Palette, PlugZap, Ticket, TimerReset, Trash2, Webhook,
} from 'lucide-react'

export interface Setting {
  view: string
  label: string
  icon: any
  /** Área liberável na ficha; ausente = só administrador. */
  area?: string
  /** Outras palavras que a pessoa digitaria para achar. */
  words: string
}
export interface SettingGroup { label: string; hint: string; items: Setting[] }

export const SETTING_GROUPS: SettingGroup[] = [
  { label: 'Como atendemos', hint: 'Horários, prazos e encerramento', items: [
    { view: 'admin_business_hours', label: 'Expediente', icon: Clock, area: 'business_hours', words: 'horario comercial feriado dias uteis' },
    { view: 'admin_sla', label: 'Planos', icon: ClipboardList, area: 'sla', words: 'sla prazo gold silver resposta solucao contrato' },
    { view: 'admin_packages', label: 'Pacotes', icon: Package, area: 'packages', words: 'adicional horas' },
    { view: 'admin_reopen_sla', label: 'Reabertura', icon: TimerReset, area: 'reopen_sla', words: 'reabrir voltar prazo' },
    { view: 'admin_auto_close', label: 'Fechamento automático', icon: Lock, area: 'auto_close', words: 'fechar encerrar sozinho' },
  ] },
  { label: 'Para onde vai', hint: 'Filas, categorias e regras', items: [
    { view: 'admin_queues', label: 'Filas', icon: Layers, area: 'queues', words: 'equipe grupo atendimento' },
    { view: 'admin_categories', label: 'Categorias', icon: FolderTree, area: 'categories', words: 'assunto subcategoria formulario' },
    { view: 'admin_ticket_types', label: 'Tipos de chamado', icon: Ticket, area: 'ticket_types', words: 'incidente requisicao problema mudanca' },
    { view: 'admin_routing', label: 'Roteamento', icon: GitBranch, area: 'routing', words: 'regra automacao direcionar' },
    { view: 'admin_escalation', label: 'Escalonamento', icon: ArrowUpCircle, area: 'escalation', words: 'transferir nivel' },
    { view: 'admin_inactivity', label: 'Inatividade', icon: TimerReset, area: 'inactivity', words: 'parado redistribuir' },
  ] },
  { label: 'Como falamos', hint: 'Textos, pesquisas, e-mail e marca', items: [
    { view: 'admin_macros', label: 'Respostas prontas', icon: MessageSquareText, area: 'macros', words: 'macro modelo texto' },
    { view: 'admin_survey', label: 'Pesquisas', icon: ClipboardList, area: 'survey', words: 'satisfacao nota nps csat' },
    { view: 'admin_email_logs', label: 'E-mail', icon: Mail, area: 'email_logs', words: 'caixa envio recebido bloqueio' },
    { view: 'admin_appearance', label: 'Aparência', icon: Palette, words: 'cor marca tema botao logo' },
  ] },
  { label: 'Inteligência', hint: 'Provedor, agentes e conhecimento', items: [
    { view: 'admin_ai_provider', label: 'Provedor de IA', icon: PlugZap, words: 'chave modelo endereco openai azure' },
    { view: 'admin_ai', label: 'Agentes de IA', icon: BrainCircuit, words: 'skadi triagem assistente' },
    { view: 'admin_intake', label: 'Checklist de abertura', icon: ListChecks, words: 'informacoes minimas pergunta' },
    { view: 'admin_knowledge', label: 'Base de conhecimento', icon: BookOpen, words: 'artigo manual' },
  ] },
  { label: 'Acesso e integrações', hint: 'Login, ligações com outros sistemas e lixeira', items: [
    { view: 'admin_sso', label: 'Login Microsoft', icon: KeyRound, words: 'sso entra azure senha' },
    { view: 'admin_webhooks', label: 'Integrações', icon: Webhook, area: 'webhooks', words: 'api webhook chave' },
    { view: 'admin_trash', label: 'Lixeira', icon: Trash2, area: 'trash', words: 'excluido recuperar apagar' },
  ] },
]

export function settingsOf({ isAdmin, can }: { isAdmin: boolean; can: (area: string) => boolean }) {
  return SETTING_GROUPS.flatMap(g => g.items
    .filter(i => (i.area ? can(i.area) : isAdmin))
    .map(i => ({ icon: i.icon, label: i.label, view: i.view, group: g.label })))
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Busca por nome, grupo ou palavra parecida; cada termo digitado precisa aparecer. */
export function searchSettings(query: string, groups: SettingGroup[] = SETTING_GROUPS): (Setting & { group: string })[] {
  const terms = plain(query).split(/\s+/).filter(t => t.length > 1)
  if (!terms.length) return []
  return groups
    .flatMap(g => g.items.map(i => ({ ...i, group: g.label })))
    .map(i => {
      const label = plain(i.label)
      const hay = `${label} ${plain(i.group)} ${i.words}`
      const score = terms.filter(t => hay.includes(t)).length * 10 + (terms.some(t => label.startsWith(t)) ? 5 : 0)
      return { i, score }
    })
    .filter(x => x.score >= 10)
    .sort((a, b) => b.score - a.score)
    .map(x => x.i)
}
