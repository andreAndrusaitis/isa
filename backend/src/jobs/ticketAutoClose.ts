import cron from 'node-cron'
import { runAutoCloseJob } from '../services/autoClose'
import { logger } from '../utils/logger'

// Roda todo dia às 01:00 AM — regra configurável em /api/auto-close/config
export function startAutoCloseJob() {
  cron.schedule('0 1 * * *', async () => {
    try {
      await runAutoCloseJob()
    } catch (err) {
      logger.error('[AutoClose Job] Erro ao executar job de auto-fechamento:', { err })
    }
  })

  logger.info('[ISA] Job de auto-fechamento de chamados iniciado (intervalo: diário às 01:00)')
}
