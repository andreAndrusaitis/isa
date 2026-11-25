import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { Modal, Btn } from '@/components/ui'

export function QueueExpirationPopup() {
  const user = useAuthStore(s => s.user)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const warnings = user?.queueAccessWarnings || []

  useEffect(() => {
    if (warnings.length > 0 && !dismissed) {
      setOpen(true)
    }
  }, [warnings, dismissed])

  if (!open || warnings.length === 0) return null

  const handleClose = () => {
    setOpen(false)
    setDismissed(true)
  }

  // Check if there's any actually expired queue
  const hasExpired = warnings.some(w => w.daysRemaining <= 0)

  return (
    <Modal 
      isOpen={open} 
      title={hasExpired ? "Alerta de contrato expirado" : "Aviso de vencimento de contrato"} 
      onClose={handleClose} 
      width={550}
      footer={<Btn onClick={handleClose}>{hasExpired ? "Entendido, fechar" : "OK, ciente"}</Btn>}
    >
      <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
        {hasExpired
          ? "O suporte técnico para os planos de SLA abaixo foi suspenso temporariamente."
          : "Seu contrato de suporte técnico está próximo do vencimento."}
      </p>
      <div className="panel">
        {warnings.map((w, i) => {
          const isExpired = w.daysRemaining <= 0
          return (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)', overflowWrap: 'anywhere' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 15, color: 'var(--text-1)' }}>
                <span>{w.queueName}</span>
                <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: isExpired ? 'var(--danger)' : 'var(--warning)' }}>
                  {isExpired ? "Expirado" : `${w.daysRemaining} dias restantes`}
                </span>
              </div>
              <div style={{ marginTop: 2, fontSize: 13, color: 'var(--text-3)' }}>
                Vencimento: {new Date(w.expiresAt).toLocaleDateString('pt-BR')}{w.orgName && ` · Empresa: ${w.orgName}`}
              </div>
              {w.message && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>{w.message}</p>}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
