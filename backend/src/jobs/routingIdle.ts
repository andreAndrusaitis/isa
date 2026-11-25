import cron from 'node-cron'
import { runIdleRoutingRules } from '../services/routing'
import { logger } from '../utils/logger'

// A cada 15 min — gatilho "chamado parado há X horas" das regras de automação
export function startRoutingIdleJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runIdleRoutingRules()
    } catch (err) {
      logger.error('[Routing Idle Job] Erro ao avaliar regras de inatividade:', { err })
    }
  })

  logger.info('[ISA] Job de regras de inatividade iniciado (intervalo: 15 min)')
}
