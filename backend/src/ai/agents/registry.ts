/**
 * Catálogo dos agentes de IA. Todo agente novo se registra aqui para aparecer
 * no painel "Motor IA" do Admin; `key` é o valor gravado em ai_agent_runs.agent.
 * O modo e as configurações de cada agente são escolhidos pelo admin no Motor IA
 * (ai_agent_settings: mode + config); sem escolha, vale o padrão (env/código).
 * As configurações são declaradas aqui (`settings`): a tela monta o formulário a
 * partir delas, e o agente lê os valores a cada execução (vale na hora, sem deploy).
 */
import type { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { AppError } from '../../middlewares/errorHandler'
import { RIGORS, type Rigor } from '../core/choice'

export const AGENT_MODES = ['off', 'shadow', 'apply'] as const
export type AgentMode = typeof AGENT_MODES[number]

export type SettingKind = 'rigor' | 'bool' | 'int' | 'multi'
export interface SettingOption { value: string; label: string }
export interface SettingField {
  key: string
  label: string
  help?: string
  kind: SettingKind
  options?: SettingOption[]
  min?: number
  max?: number
  /** Opções que vêm do banco (empresas, categorias): `options` fica vazio e a tela as recebe de describeSettings. */
  loadOptions?: () => Promise<SettingOption[]>
  default: () => unknown
}

export interface AgentInfo {
  key: string
  name: string
  description: string
  /** Modo padrão (env), usado enquanto o admin não escolheu um no Motor IA. */
  defaultMode: () => AgentMode
  settings: SettingField[]
}

const RIGOR_OPTIONS: SettingOption[] = [
  { value: 'conservative', label: 'Conservador' },
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'bold', label: 'Ousado' },
]
const rigor = (help: string): SettingField => ({ key: 'rigor', label: 'Rigor', help, kind: 'rigor', options: RIGOR_OPTIONS, default: () => 'balanced' })
const bool = (key: string, label: string, help?: string, def = true): SettingField => ({ key, label, help, kind: 'bool', default: () => def })
const int = (key: string, label: string, min: number, max: number, def: number, help?: string): SettingField => ({ key, label, help, kind: 'int', min, max, default: () => def })
const dbMulti = (key: string, label: string, help: string, loadOptions: () => Promise<SettingOption[]>): SettingField => ({ key, label, help, kind: 'multi', loadOptions, default: () => [] })

const toOptions = (rows: { id: string; name: string }[]): SettingOption[] => rows.map(r => ({ value: r.id, label: r.name }))
const orgOptions = async () => toOptions(await prisma.organization.findMany({ where: { active: true, deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }))
const categoryOptions = async () => toOptions(await prisma.category.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }))

const TRIAGE_FIELDS: SettingOption[] = [
  { value: 'type', label: 'Tipo' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'category', label: 'Categoria' },
  { value: 'subcategory', label: 'Subcategoria' },
]

export interface TriageConfig { rigor: Rigor; applyFields: string[]; useExamples: boolean }
export interface IntakeConfig { rigor: Rigor; maxAsks: number; personalize: boolean }
export interface GuidanceConfig {
  rigor: Rigor; useInternalBase: boolean; useLearn: boolean; detectDuplicates: boolean
  duplicateWindowDays: number; maxSteps: number; howTo: boolean; learnFromClosed: boolean
}
export interface KnowledgeConfig { rigor: Rigor; pilotOrgIds: string[]; pilotCategoryIds: string[] }

export const AGENTS: AgentInfo[] = [
  {
    key: 'triage',
    name: 'Triagem de chamados',
    description: 'Sugere tipo, categoria, subcategoria, urgência e impacto na abertura do chamado, com confiança e evidência por campo.',
    defaultMode: () => env.AI_TRIAGE_MODE,
    settings: [
      rigor('Conservador: só altera o chamado com mais certeza. Ousado: altera mais, com mais risco de errar.'),
      {
        key: 'applyFields', label: 'Campos que pode gravar', kind: 'multi', options: TRIAGE_FIELDS,
        help: 'No modo Aplicar, a IA só altera estes campos; os demais ficam como sugestão na nota. Regras de roteamento sempre prevalecem.',
        // O padrão inicial vem do env (AI_TRIAGE_APPLY_FIELDS); subcategoria só acompanha a categoria.
        default: () => env.AI_TRIAGE_APPLY_FIELDS.split(',').map(s => s.trim()).filter(f => TRIAGE_FIELDS.some(o => o.value === f)),
      },
      bool('useExamples', 'Usar chamados parecidos já classificados', 'Mostra à IA exemplos da base classificada (RAG) para tipo, urgência e impacto.'),
    ],
  },
  {
    key: 'intake',
    name: 'Completude na abertura',
    description: 'Confere o checklist de informações mínimas do tipo do chamado; no modo apply pergunta ao solicitante o que falta e marca o chamado.',
    defaultMode: () => env.AI_INTAKE_MODE,
    settings: [
      rigor('Conservador: só pergunta quando tem muita certeza de que a informação falta. Ousado: pergunta mais.'),
      int('maxAsks', 'Máximo de perguntas ao solicitante', 1, 3, 3),
      bool('personalize', 'Personalizar as perguntas com IA', 'Reescreve a pergunta do checklist com as palavras que o solicitante usou.'),
    ],
  },
  {
    key: 'guidance',
    name: 'Orientação na abertura',
    description: 'Busca soluções de autoatendimento na base de resoluções e no Microsoft Learn e avisa sobre chamado aberto parecido do mesmo solicitante; no modo apply orienta o solicitante e oferece vincular.',
    defaultMode: () => env.AI_GUIDANCE_MODE,
    settings: [
      rigor('Conservador: orienta e aponta duplicados só com muita certeza. Ousado: faz isso com mais frequência.'),
      bool('useInternalBase', 'Usar a base de resoluções', 'Soluções já aplicadas pelo suporte, destiladas dos chamados fechados.'),
      bool('useLearn', 'Buscar no Microsoft Learn', 'Documentação oficial da Microsoft para assuntos Microsoft.'),
      bool('detectDuplicates', 'Avisar sobre chamado aberto parecido', 'Oferece ao solicitante vincular ao chamado que ele já tem aberto.'),
      int('duplicateWindowDays', 'Janela de duplicidade (dias)', 1, 90, 30, 'Só compara com chamados abertos nestes últimos dias.'),
      int('maxSteps', 'Máximo de passos na orientação', 1, 5, 5),
      bool('howTo', 'Explicar como fazer cada passo', 'Inclui o caminho de menus e cliques abaixo de cada passo.'),
      bool('learnFromClosed', 'Alimentar a base com chamados fechados', 'Cada chamado fechado vira um cartão da base de resoluções.'),
    ],
  },
  {
    key: 'knowledge',
    name: 'Sugestão na abertura',
    description: 'Sugere a solução no Wizard, antes de o chamado existir, usando só os artigos da base de conhecimento que o usuário pode ver.',
    defaultMode: () => 'off',
    settings: [
      rigor('Conservador: só sugere com muita certeza de que o artigo resolve. Ousado: sugere mais, com mais risco de errar.'),
      dbMulti('pilotOrgIds', 'Empresas do piloto', 'Só usuários destas empresas recebem sugestão. Nenhuma marcada = todas.', orgOptions),
      dbMulti('pilotCategoryIds', 'Categorias do piloto', 'A sugestão só usa artigos destas categorias. Nenhuma marcada = todas.', categoryOptions),
    ],
  },
]

const agentInfo = (key: string) => AGENTS.find(a => a.key === key)

/** Valor válido para o campo, ou undefined. */
function validValue(f: SettingField, v: unknown): unknown {
  switch (f.kind) {
    case 'rigor': return typeof v === 'string' && (RIGORS as readonly string[]).includes(v) ? v : undefined
    case 'bool': return typeof v === 'boolean' ? v : undefined
    case 'int': return Number.isInteger(v) && (v as number) >= f.min! && (v as number) <= f.max! ? v : undefined
    case 'multi': {
      if (!Array.isArray(v)) return undefined
      // Lista do banco: id que sumiu fica gravado e só não casa com ninguém. Se fosse
      // descartado (ou a lista voltasse ao padrão), o piloto esvaziaria, e vazio é "todas".
      const ok = f.loadOptions ? v.every(x => typeof x === 'string' && x) : v.every(x => f.options!.some(o => o.value === x))
      return ok ? [...new Set(v as string[])] : undefined
    }
  }
}

/** Config gravada completada com os padrões; valor inválido (ex.: opção removida) volta ao padrão. */
export function normalizeConfig(agent: AgentInfo, raw: unknown): Record<string, unknown> {
  const stored = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return Object.fromEntries(agent.settings.map(f => [f.key, validValue(f, stored[f.key]) ?? f.default()]))
}

/** Valida uma alteração (parcial) vinda do admin; campo desconhecido ou inválido = 400. */
export function validateConfigInput(agent: AgentInfo, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Configuração inválida', 'INVALID_CONFIG')
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    const f = agent.settings.find(s => s.key === k)
    if (!f) throw new AppError(400, `Configuração desconhecida: ${k}`, 'INVALID_CONFIG')
    const ok = validValue(f, v)
    if (ok === undefined) throw new AppError(400, `Valor inválido para "${f.label}"`, 'INVALID_CONFIG')
    out[k] = ok
  }
  return out
}

/**
 * Opções do banco ficam fora de validateConfigInput, que é síncrona. O que já estava
 * gravado segue aceito: a tela reenvia a lista inteira, com a empresa que saiu de cena.
 */
export async function checkLoadedOptions(agent: AgentInfo, changes: Record<string, unknown>): Promise<void> {
  const { config } = await agentRuntime<Record<string, string[]>>(agent.key)
  for (const f of agent.settings) {
    if (!f.loadOptions || changes[f.key] === undefined) continue
    const known = new Set([...(await f.loadOptions()).map(o => o.value), ...config[f.key]])
    if ((changes[f.key] as string[]).some(v => !known.has(v))) throw new AppError(400, `Valor inválido para "${f.label}"`, 'INVALID_CONFIG')
  }
}

/** Declaração para a tela. Marcada que saiu do banco continua na lista, senão o admin não consegue desmarcar. */
export async function describeSettings(agent: AgentInfo, config: Record<string, unknown>) {
  return Promise.all(agent.settings.map(async ({ default: _d, loadOptions, ...f }) => {
    if (!loadOptions) return f
    const options = await loadOptions()
    const gone = (config[f.key] as string[]).filter(v => !options.some(o => o.value === v))
    return { ...f, options: [...options, ...gone.map(value => ({ value, label: 'Removida ou inativa' }))] }
  }))
}

/**
 * Modo e configuração vigentes do agente, lidos a cada execução: a troca no Admin vale
 * na hora, em todas as instâncias. Agente desconhecido fica desligado.
 */
export async function agentRuntime<C = Record<string, unknown>>(key: string): Promise<{ mode: AgentMode; config: C }> {
  const agent = agentInfo(key)
  if (!agent) return { mode: 'off', config: {} as C }
  const row = await prisma.aiAgentSetting.findUnique({ where: { agent: key } })
  return {
    mode: (row?.mode as AgentMode | undefined) ?? agent.defaultMode(),
    config: normalizeConfig(agent, row?.config) as C,
  }
}

export async function agentMode(key: string): Promise<AgentMode> {
  return (await agentRuntime(key)).mode
}

export async function setAgentMode(key: string, mode: AgentMode): Promise<void> {
  await prisma.aiAgentSetting.upsert({ where: { agent: key }, create: { agent: key, mode }, update: { mode } })
}

/** Grava a configuração completa (atual + alteração); devolve antes e depois para a auditoria. */
export async function setAgentConfig(key: string, changes: Record<string, unknown>) {
  const agent = agentInfo(key)!
  const { mode, config: before } = await agentRuntime(key)
  const after = { ...before, ...changes }
  const config = after as Prisma.InputJsonValue
  await prisma.aiAgentSetting.upsert({ where: { agent: key }, create: { agent: key, mode, config }, update: { config } })
  return { before, after: normalizeConfig(agent, after) }
}
