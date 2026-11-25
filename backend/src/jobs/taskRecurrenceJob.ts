import cron from 'node-cron'
import { spawnDueOccurrences } from '../services/taskCollab'
import { logger } from '../utils/logger'

// A cada 15 min — task recorrente no modo on_due ganha a próxima ocorrência na data prevista.
export function startTaskRecurrenceJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { spawned } = await spawnDueOccurrences()
      if (spawned) logger.info(`[Projetos] ${spawned} ocorrência(s) de task recorrente gerada(s) pela data prevista.`)
    } catch (err) {
      logger.error('[Projetos] Erro ao gerar ocorrências de tasks recorrentes:', { err })
    }
  })

  logger.info('[ISA] Job de recorrência de tasks (on_due) iniciado (intervalo: 15 min)')
}
