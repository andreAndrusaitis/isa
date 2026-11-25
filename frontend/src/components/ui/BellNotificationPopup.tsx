import { useEffect, useState } from 'react'
import { BellPopup, BellPopupType } from '@/store/notifications'
import { X } from 'lucide-react'
import '../pops.css'

const TYPE_LABEL: Record<BellPopupType, string> = {
  new_ticket: 'Novo chamado na fila',
  ticket_assigned: 'Atribuído a você',
  ticket_queue_moved: 'Chamado na sua fila',
  routing_alert: 'Alerta de regra',
}

const DURATION = 8000

interface SingleProps {
  item: BellPopup
  onOpen: (ticketId: string) => void
  onDismiss: (id: string) => void
}

function BellPopupCard({ item, onOpen, onDismiss }: SingleProps) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const pct = Math.max(0, 100 - ((Date.now() - start) / DURATION) * 100)
      setProgress(pct)
      if (pct === 0) { clearInterval(iv); onDismiss(item.id) }
    }, 50)
    return () => clearInterval(iv)
  }, [item.id])

  return (
    <div className="pop toast-pop">
      <div className="toast-head">
        <span>{TYPE_LABEL[item.type]}</span>
        <button type="button" className="icon-act" onClick={() => onDismiss(item.id)} aria-label="Fechar notificação"><X size={15} /></button>
      </div>
      <strong>{item.ticketNumber} — {item.title}</strong>
      <p>{item.body}</p>
      <button type="button" className="toast-open" onClick={() => { onOpen(item.ticketId); onDismiss(item.id) }}>Abrir chamado</button>
      <i className="toast-time" style={{ width: `${progress}%` }} />
    </div>
  )
}

interface Props {
  items: BellPopup[]
  onOpen: (ticketId: string) => void
  onDismiss: (id: string) => void
}

export function BellNotificationPopup({ items, onOpen, onDismiss }: Props) {
  if (items.length === 0) return null
  return (
    <div className="toast-stack" style={{ bottom: 72, flexDirection: 'column-reverse' }}>
      {items.map((item) => (
        <BellPopupCard key={item.id} item={item} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
