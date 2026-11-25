/**
 * Embeddings compartilhados pelos agentes (Azure OpenAI no Foundry, mesmo
 * endpoint e chave do chat). Lotes de até 100 textos.
 */
import { aiProvider, embeddingsUrl, modelField } from './provider'
import { postFoundry, type FoundryOptions } from './llm'

export type EmbedFn = (texts: string[], opts?: FoundryOptions) => Promise<number[][]>

const BATCH = 100
// Limite do modelo é 8192 tokens por texto; 1 token ≥ 1 caractere, então 8000 caracteres sempre cabem.
const MAX_CHARS = 8000

export const embed: EmbedFn = async (texts, opts = {}) => {
  const url = embeddingsUrl()
  const out: number[][] = []
  // O orçamento é do conjunto: cada lote só pode gastar o que os anteriores deixaram.
  const deadline = opts.timeoutMs === undefined ? undefined : Date.now() + opts.timeoutMs
  for (let i = 0; i < texts.length; i += BATCH) {
    // Mesma fila de concorrência e retry (429/5xx/rede) do chat.
    const data: any = await postFoundry(
      url,
      JSON.stringify({ ...modelField(aiProvider().embeddingModel), input: texts.slice(i, i + BATCH).map(t => t.slice(0, MAX_CHARS)) }),
      { timeoutMs: deadline === undefined ? undefined : deadline - Date.now() },
    )
    out.push(...[...data.data].sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding as number[]))
  }
  return out
}
