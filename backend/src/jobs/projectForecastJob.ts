import cron from 'node-cron'
import { alertOverdueForecasts } from '../services/ticketTaskLink'
import { logger } from '../utils/logger'

// A cada 15 min — chamado em projeto com a previsão da task vencida volta a ser risco de SLA.
export function startProjectForecastJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { alerted } = await alertOverdueForecasts()
      if (alerted) logger.info(`[Projetos] ${alerted} chamado(s) com previsão de projeto vencida avisados.`)
    } catch (err) {
      logger.error('[Projetos] Erro ao avisar previsões vencidas:', { err })
    }
  })

  logger.info('[ISA] Job de previsão vencida de projeto iniciado (intervalo: 15 min)')
}
