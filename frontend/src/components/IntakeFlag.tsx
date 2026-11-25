import type { MouseEvent } from 'react'
import { X } from 'lucide-react'
import { aiService } from '@/services/aiService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SKADI_NAME } from '@/utils/skadi'

/** Marca do agente intake: a Skadi pediu complementos ao solicitante, que ainda não respondeu. */
export function IntakeFlag({ ticketId, status, ticketStatus, canDismiss = false, compact = false, onDismissed }: {
  ticketId: string
  status?: string | null
  /** Status do chamado: resolvido ou fechado não espera mais complemento. */
  ticketStatus?: string | null
  canDismiss?: boolean
  compact?: boolean
  onDismissed?: () => void
}) {
  if (status !== 'incomplete' || ticketStatus === 'resolved' || ticketStatus === 'closed') return null
  const dismiss = async (e: MouseEvent) => {
    e.stopPropagation()
    try {
      await aiService.dismissIntake(ticketId)
      onDismissed?.()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível dispensar a marca.'))
    }
  }
  return (
    <span title={`A ${SKADI_NAME} pediu complementos ao solicitante, que ainda não respondeu`}
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontSize: compact ? 12 : 13, color: 'var(--warning)', whiteSpace: 'nowrap' }}>
      {compact ? 'Incompleto' : 'Informações incompletas'}
      {canDismiss && (
        <button type="button" aria-label="Dispensar marca" onClick={dismiss}
          style={{ marginLeft: 2, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  )
}
