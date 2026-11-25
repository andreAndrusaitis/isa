import cron from 'node-cron'
import { purgeExpiredTickets } from '../services/trash'
import { purgeExpiredDocPages } from '../services/docTrash'
import { logger } from '../utils/logger'

// Roda todo dia às 02:00 — apaga de vez chamados e páginas de Documentos que passaram da retenção da Lixeira
export function startTrashPurgeJob() {
  cron.schedule('0 2 * * *', async () => {
    try {
      await purgeExpiredTickets()
    } catch (err) {
      logger.error('[Trash Job] Erro ao executar limpeza da Lixeira:', { err })
    }
    try {
      await purgeExpiredDocPages()
    } catch (err) {
      logger.error('[Trash Job] Erro ao limpar a lixeira de Documentos:', { err })
    }
  })

  logger.info('[ISA] Job de limpeza da Lixeira iniciado (intervalo: diário às 02:00)')
}
