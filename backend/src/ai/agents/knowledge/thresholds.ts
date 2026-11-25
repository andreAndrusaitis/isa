/**
 * Limiares do agente knowledge, reunidos aqui para calibrar com dados reais.
 * Valores iniciais, sem curva de calibração; na dúvida não responde.
 */
import { withRigor, type Rigor, type Thresholds } from '../../core/choice'

/**
 * Cosseno mínimo entre a pergunta e o trecho. Mesmo ponto de partida de
 * core/examples (MIN_SCORE), que usa o mesmo modelo de embedding.
 */
export const MIN_SIMILARITY = 0.45

/**
 * Confiança de que os trechos resolvem, no rigor Equilibrado; Conservador e Ousado
 * saem de withRigor (0,90 e 0,75). Com duas opções a margem é 2p - 1: quem decide é a confiança.
 */
export const CONFIDENCE: Thresholds = { minConfidence: 0.85, minMargin: 0 }

export const confidenceFor = (rigor: Rigor): Thresholds => withRigor(CONFIDENCE, rigor)

/** Orçamento do conjunto (busca e chat): quem espera é o usuário no Wizard. */
export const SUGGEST_BUDGET_MS = 8000
