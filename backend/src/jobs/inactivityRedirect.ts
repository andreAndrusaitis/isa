import cron from 'node-cron'
import { logger } from '../utils/logger'
import { runInactivityRedirectJob } from '../services/inactivityRedirect'

// Roda a cada 15 minutos — detecta chamados inativos e redireciona automaticamente
// A execução efetiva só ocorre dentro do horário comercial configurado
export function startInactivityRedirectJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runInactivityRedirectJob()
    } catch (err) {
      logger.error('[InactivityRedirect Job] Erro inesperado:', { err })
    }
  })

  logger.info('[ISA] Job de redirecionamento por inatividade iniciado (intervalo: 15 minutos)')
}
