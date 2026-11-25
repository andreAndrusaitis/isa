/**
 * Avaliação da qualidade das respostas do assistente de chamados em pt-BR.
 *
 * Roda cada caso de assistente-casos.json pelo runAssistant de verdade (mesmo
 * prompt, mesmas descrições e schemas das ferramentas), com o modelo do Foundry,
 * mas com as ferramentas trocadas por um ESPIÃO: leitura devolve as fixtures do
 * dataset (sem banco), escrita nunca executa (se o handler for chamado, é falha
 * crítica). Notas em assistente-scorer.ts; juiz com LLM opcional em assistente-juiz.ts.
 *
 * Como rodar (na pasta backend, com AZURE_AI_ENDPOINT e AZURE_AI_KEY no .env):
 *   npm run eval:assistente                         # gate com nota mínima 0.8
 *   npm run eval:assistente -- --minimo 0.9         # ou AVAL_ASSISTENTE_MINIMO=0.9
 *   npm run eval:assistente -- --juiz               # + juiz com LLM (nota 1–5, mínimo 3.5 ou --juiz-minimo)
 *   npm run eval:assistente -- --categoria tom --caso tom-saudacao --out resultado.json
 *   npm run eval:assistente -- --dry                # só valida o dataset, sem chamar o modelo
 * Sem a IA configurada roda em modo dry (valida o dataset, avisa e sai 0).
 * Não lê nem escreve no banco; consome tokens do Foundry (~35 casos × até 4 voltas).
 *
 * Saída: 0 = aprovado (ou dry); 1 = reprovado (nota abaixo do mínimo, falha crítica
 * ou juiz abaixo do mínimo); 2 = dataset ou argumentos inválidos.
 *
 * Checklist de release (antes de subir versão que mexe no assistente — prompt,
 * ferramentas, modelo/deployment ou orquestrador):
 *   1. npm run eval:assistente -- --juiz --out eval-assistente.json  (contra o Foundry de dev)
 *   2. Saída 0 é obrigatória: nota ≥ mínimo, zero falha crítica (escrita sem
 *      confirmação, nota interna, prompt vazado, passo de administrador).
 *   3. Anexar a tabela por categoria ao PR; queda de categoria em relação à versão
 *      anterior precisa de justificativa mesmo com o gate verde.
 *   4. Caso novo de bug real entra no dataset antes da correção (mascarado).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiConfigured, chat, chatWithTools, type ChatFn, type ToolChatFn } from '../core/llm'
import { runAssistant } from '../assistant/orchestrator'
import type { AssistantChannel, AssistantTool } from '../assistant/types'
import { criarJuiz, type JuizFn } from './assistente-juiz'
import {
  avaliarGate, checarCaso, falhasCriticas, passou, resumir, validarDataset,
  type CasoAssistente, type DatasetAssistente, type Execucao, type Fixtures, type ResultadoCaso,
} from './assistente-scorer'

export const MINIMO_PADRAO = 0.8
export const JUIZ_MINIMO_PADRAO = 3.5

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O que o espião viu num caso. */
export interface Registro {
  executadas: Array<{ tool: string; write: boolean; input: unknown }>
  urls: string[]
}

/** Fixture de leitura por ferramenta. Ferramenta de leitura sem fixture responde erro (o modelo segue). */
function lerFixture(nome: string, input: any, fx: Fixtures): unknown {
  switch (nome) {
    case 'buscar_learn': {
      const q = semAcento(String(input?.consulta ?? input?.query ?? ''))
      const docs = fx.learn.filter(d => d.palavras.some(p => q.includes(semAcento(p)))).slice(0, 2)
      return {
        itens: docs.map(d => ({ title: d.title, url: d.url, trecho: d.trecho })),
        sources: docs.map(d => ({ title: d.title, url: d.url })),
      }
    }
    case 'meus_chamados': {
      const ativos = ['Aberto', 'Em atendimento', 'Pendente']
      const lista = input?.somenteAbertos ? fx.meusChamados.filter(c => ativos.includes(String(c.status))) : fx.meusChamados
      return lista.slice(0, Number(input?.limite) || 5)
    }
    case 'ver_chamado': {
      const ref = String(input?.chamado ?? '').trim().toUpperCase()
      const c = fx.chamados[ref]
      // Mesmo comportamento da ferramenta real: chamado de outra pessoa = não encontrado.
      if (!c) throw new Error('Chamado não encontrado entre os seus chamados.')
      return c
    }
    default:
      return { error: `sem fixture de avaliação para ${nome}` }
  }
}

/**
 * Troca o handler de cada ferramenta por um espião, mantendo nome, descrição,
 * schema, write e describe (o modelo vê exatamente as ferramentas reais).
 */
export function espiarFerramentas(tools: AssistantTool[], fx: Fixtures, reg: Registro): AssistantTool[] {
  return tools.map(t => ({
    ...t,
    handler: async (input: unknown) => {
      reg.executadas.push({ tool: t.name, write: t.write, input })
      if (t.write) throw new Error('escrita bloqueada na avaliação')
      const result = lerFixture(t.name, input, fx)
      for (const s of (result as any)?.sources ?? []) if (typeof s?.url === 'string') reg.urls.push(s.url)
      for (const i of (result as any)?.itens ?? []) if (typeof i?.url === 'string') reg.urls.push(i.url)
      return result
    },
  }))
}

export interface ResultadoExecucao extends ResultadoCaso {
  resposta: string
  pendente: string | null
  chamadas: string[]
  tokens: number
}

export interface OpcoesRodada {
  chatFn: ToolChatFn
  tools: AssistantTool[]
  juiz?: JuizFn | null
  via?: AssistantChannel
  log?: (linha: string) => void
}

/** Roda um caso pelo orquestrador real, com o espião e a contagem de chamadas do modelo. */
export async function rodarCaso(caso: CasoAssistente, fx: Fixtures, opts: OpcoesRodada): Promise<ResultadoExecucao> {
  const reg: Registro = { executadas: [], urls: [] }
  const chamadas: string[] = []
  let tokens = 0
  const chatFn: ToolChatFn = async (messages, specs, o) => {
    const res = await opts.chatFn(messages, specs, o)
    tokens += res.inputTokens + res.outputTokens
    chamadas.push(...res.toolCalls.map(c => c.function.name))
    return res
  }
  // Usuário e conversa por caso: o limite de mensagens e o teto de tokens não vazam entre casos.
  const userId = `aval-assistente:${caso.id}`
  const reply = await runAssistant({
    userId, conversationId: userId, via: opts.via ?? 'teams',
    history: caso.historico ?? [], message: caso.mensagem,
    tools: espiarFerramentas(opts.tools, fx, reg), chatFn,
  })
  const exec: Execucao = {
    texto: reply.text,
    pendente: reply.pending ? { tool: reply.pending.tool, summary: reply.pending.summary } : null,
    chamadas,
    executadas: reg.executadas.map(({ tool, write }) => ({ tool, write })),
    urlsPermitidas: [...reg.urls, ...(reply.sources ?? []).map(s => s.url)],
  }
  const checagens = checarCaso(caso, exec, fx)
  const juiz = opts.juiz
    ? await opts.juiz({ caso, resposta: reply.text, chamadas, pendente: reply.pending?.tool ?? null })
    : undefined
  return {
    id: caso.id, categoria: caso.categoria, checagens, ...(juiz !== undefined ? { juiz } : {}),
    resposta: reply.text, pendente: reply.pending?.tool ?? null, chamadas, tokens,
  }
}

const pad = (s: string | number, n: number, direita = false) => (direita ? String(s).padStart(n) : String(s).padEnd(n))

export function tabela(resultados: ResultadoCaso[]): string {
  const { categorias, total } = resumir(resultados)
  const linhas = [`${pad('categoria', 20)} ${pad('casos', 5, true)} ${pad('passaram', 8, true)} ${pad('nota', 6, true)} ${pad('juiz', 5, true)}`]
  for (const l of [...categorias, total]) {
    linhas.push(`${pad(l.categoria, 20)} ${pad(l.casos, 5, true)} ${pad(l.passaram, 8, true)} ${pad(l.nota.toFixed(2), 6, true)} ${pad(l.juiz == null ? '-' : l.juiz.toFixed(1), 5, true)}`)
  }
  return linhas.join('\n')
}

// ── CLI ──

export interface Argumentos {
  minimo: number
  juiz: boolean
  juizMinimo: number
  dry: boolean
  caso: string | null
  categoria: string | null
  out: string | null
}

export function lerArgumentos(argv: string[], envVars: NodeJS.ProcessEnv = process.env): Argumentos | { erro: string } {
  const valor = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] ?? '' : null
  }
  const minimo = Number(valor('--minimo') ?? envVars.AVAL_ASSISTENTE_MINIMO ?? MINIMO_PADRAO)
  const juizMinimo = Number(valor('--juiz-minimo') ?? envVars.AVAL_ASSISTENTE_JUIZ_MINIMO ?? JUIZ_MINIMO_PADRAO)
  if (!Number.isFinite(minimo) || minimo < 0 || minimo > 1) return { erro: '--minimo precisa ser um número entre 0 e 1' }
  if (!Number.isFinite(juizMinimo) || juizMinimo < 1 || juizMinimo > 5) return { erro: '--juiz-minimo precisa ser um número entre 1 e 5' }
  return {
    minimo, juizMinimo,
    juiz: argv.includes('--juiz') || envVars.AVAL_ASSISTENTE_JUIZ === '1',
    dry: argv.includes('--dry'),
    caso: valor('--caso'), categoria: valor('--categoria'), out: valor('--out'),
  }
}

/** Dependências trocáveis nos testes; sem elas, Foundry, ferramentas reais e o dataset do disco. */
export interface Dependencias {
  dados?: unknown
  tools?: AssistantTool[]
  chatFn?: ToolChatFn
  juizChat?: ChatFn
  configurado?: boolean
  log?: (linha: string) => void
}

/** Executa a avaliação e devolve o código de saída (0 aprovado/dry, 1 reprovado, 2 inválido). */
export async function main(argv: string[], deps: Dependencias = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l))
  const args = lerArgumentos(argv)
  if ('erro' in args) { log(`✗ ${args.erro}`); return 2 }

  // Import tardio: as ferramentas reais puxam o Prisma e os serviços de chamado (só os
  // nomes, descrições e schemas são usados — o espião troca todos os handlers).
  const tools = deps.tools ?? (await import('../assistant/tools')).assistantTools
  const raw = deps.dados ?? JSON.parse(readFileSync(join(__dirname, 'assistente-casos.json'), 'utf8'))
  const validacao = validarDataset(raw, tools.map(t => t.name))
  if (!validacao.ok) {
    log('✗ assistente-casos.json inválido:')
    for (const e of validacao.erros) log(`  - ${e}`)
    return 2
  }
  const dados: DatasetAssistente = validacao.dados
  const casos = dados.casos.filter(c => (!args.caso || c.id === args.caso) && (!args.categoria || c.categoria === args.categoria))
  if (!casos.length) { log('✗ nenhum caso com esse filtro'); return 2 }

  const configurado = deps.configurado ?? aiConfigured()
  if (args.dry || !configurado) {
    if (!configurado && !args.dry) log('IA não configurada (AZURE_AI_ENDPOINT/AZURE_AI_KEY): avaliação NÃO rodou — modo dry, só o dataset foi validado.')
    const porCategoria = new Map<string, number>()
    for (const c of casos) porCategoria.set(c.categoria, (porCategoria.get(c.categoria) ?? 0) + 1)
    log(`Dataset ok: ${casos.length} casos — ${[...porCategoria].map(([k, n]) => `${k}=${n}`).join(', ')}`)
    return 0
  }

  const juiz = args.juiz ? criarJuiz(deps.juizChat ?? chat) : null
  const resultados: ResultadoExecucao[] = []
  for (const caso of casos) {
    const r = await rodarCaso(caso, dados.fixtures, { chatFn: deps.chatFn ?? chatWithTools, tools, juiz })
    resultados.push(r)
    const falhas = r.checagens.filter(c => !c.ok)
    const critica = falhasCriticas(r).length ? ' CRÍTICA!' : ''
    log(`${passou(r) ? '✓' : '✗'} ${r.id.padEnd(32)} ferramentas=${r.chamadas.join(',') || '-'} pendente=${r.pendente ?? '-'}${r.juiz ? ` juiz=${r.juiz.nota}` : ''}${critica}`)
    for (const f of falhas) log(`    ${f.nome}${f.detalhe ? `: ${f.detalhe}` : ''}`)
  }

  const gate = avaliarGate(resultados, { minimo: args.minimo, ...(args.juiz ? { juizMinimo: args.juizMinimo } : {}) })
  const tokens = resultados.reduce((n, r) => n + r.tokens, 0)
  log('')
  log(tabela(resultados))
  log('')
  log(`Mínimo ${args.minimo.toFixed(2)}${args.juiz ? `, juiz ≥ ${args.juizMinimo.toFixed(1)}` : ''} · ${tokens} tokens`)
  log(gate.ok ? '✓ APROVADO' : `✗ REPROVADO — versão bloqueada:\n${gate.motivos.map(m => `  - ${m}`).join('\n')}`)
  if (args.out) writeFileSync(args.out, JSON.stringify({ gate, resumo: resumir(resultados), minimo: args.minimo, tokens, resultados }, null, 2))
  return gate.ok ? 0 : 1
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => { console.error(err); process.exit(2) })
}
