import cron from 'node-cron'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { isGraphConfigured } from '../services/email/graph'
import { processInboundMailbox } from '../services/email/inbound'

// Roda a cada minuto — lê a caixa de atendimento: e-mail novo vira chamado e
// resposta a e-mail de chamado entra no próprio chamado. Só liga com
// MAIL_INBOUND_ENABLED.
export function startInboundMailJob() {
  if (!env.MAIL_INBOUND_ENABLED || !isGraphConfigured() || env.NODE_ENV === 'test') {
    logger.info('[ISA] Leitura da caixa de atendimento desligada (MAIL_INBOUND_ENABLED/Graph).')
    return
  }
  // Sem a data de corte, o histórico da caixa viraria chamado: não liga.
  if (!env.MAIL_INBOUND_SINCE) {
    logger.error('[ISA] MAIL_INBOUND_ENABLED ligado sem MAIL_INBOUND_SINCE — leitura da caixa NÃO iniciada.')
    return
  }
  const since = new Date(env.MAIL_INBOUND_SINCE)

  cron.schedule('* * * * *', async () => {
    try {
      await processInboundMailbox(since)
    } catch (err) {
      logger.error('[InboundMail Job] Erro ao ler a caixa de atendimento:', { error: err instanceof Error ? err.message : String(err) })
    }
  })

  logger.info(`[ISA] Leitura da caixa de atendimento iniciada (${env.MAIL_GRAPH_MAILBOX}, e-mails desde ${since.toISOString()}, intervalo: 1 minuto)`)
}
