import cron from 'node-cron'
import { logger } from '../utils/logger'
import { runPendingScheduleReopenJob } from '../services/pendingScheduleReopen'

// Roda a cada 5 minutos — reabre chamados em "Pendente Agendamento" cujo
// horário combinado com o usuário (pending_schedule_at) já chegou
export function startPendingScheduleReopenJob() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runPendingScheduleReopenJob()
    } catch (err) {
      logger.error('[PendingScheduleReopen Job] Erro inesperado:', { err })
    }
  })

  logger.info('[ISA] Job de reabertura por agendamento iniciado (intervalo: 5 minutos)')
}
