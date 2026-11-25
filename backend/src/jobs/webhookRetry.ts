import cron from 'node-cron'
import prisma from '../config/prisma'
import { logger } from '../utils/logger'
import { processDueDeliveries } from '../services/webhookDelivery'
import { processDueProjectDeliveries } from '../services/projectWebhooks'

const RETENTION_DAYS = 30

// Reprocessa entregas de webhook pendentes (backoff vencido) a cada minuto e
// limpa o histórico de entregas/requisições com mais de 30 dias à meia-noite.
export function startWebhookRetryJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const [processed, projectProcessed] = await Promise.all([
        processDueDeliveries(50),
        processDueProjectDeliveries(50),
      ])
      if (processed > 0) logger.debug(`[Webhooks Job] ${processed} entrega(s) processada(s)`)
      if (projectProcessed > 0) logger.debug(`[Webhooks Job] ${projectProcessed} entrega(s) de Projetos processada(s)`)
    } catch (err) {
      logger.error('[Webhooks Job] Erro ao processar entregas pendentes:', { err })
    }
  })

  cron.schedule('0 0 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const [deliveries, requests] = await Promise.all([
        prisma.webhookDelivery.deleteMany({ where: { created_at: { lt: cutoff } } }),
        prisma.apiRequestLog.deleteMany({ where: { created_at: { lt: cutoff } } }),
      ])
      await prisma.projectWebhookDelivery.deleteMany({ where: { created_at: { lt: cutoff } } })
      if (deliveries.count > 0 || requests.count > 0) {
        logger.info(`[Webhooks Cleanup] Removidos ${deliveries.count} delivery(ies) e ${requests.count} requisição(ões) com mais de ${RETENTION_DAYS} dias`)
      }
    } catch (err) {
      logger.error('[Webhooks Cleanup] Erro na limpeza de histórico:', { err })
    }
  })

  logger.info('[ISA] Job de entrega de webhooks iniciado (intervalo: 1 minuto)')
}
