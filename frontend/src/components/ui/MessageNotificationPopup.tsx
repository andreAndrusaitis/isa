import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MessageNotification } from '@/store/notifications'
import '../pops.css'

const AUTO_DISMISS_MS = 5000

let _audioCtx: AudioContext | null = null
let _lastPlayedTime = 0
const PLAY_COOLDOWN_MS = 2000

// Inicializa o AudioContext na primeira interação do usuário para atender à política do browser
if (typeof window !== 'undefined') {
  document.addEventListener('click', () => {
    if (!_audioCtx) {
      try { _audioCtx = new AudioContext() } catch { /* ignore */ }
    } else if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {})
    }
  }, { once: false, capture: true, passive: true })
}

export function playNotificationSound() {
  const now = Date.now()
  if (now - _lastPlayedTime < PLAY_COOLDOWN_MS) return
  _lastPlayedTime = now

  try {
    const ctx = _audioCtx
    if (!ctx || ctx.state === 'suspended') return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
  } catch { /* ignore */ }
}

interface NotificationCardProps {
  notification: MessageNotification
  onDismiss: (id: string) => void
  onOpen: (ticketId: string) => void
}

function NotificationCard({ notification, onDismiss, onOpen }: NotificationCardProps) {
  const [progress, setProgress] = useState(100)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    playNotificationSound()

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100)
      setProgress(remaining)
      if (remaining === 0) {
        onDismiss(notification.id)
      }
    }, 50)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [notification.id, onDismiss])

  function handleMouseEnter() {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function handleMouseLeave() {
    startRef.current = Date.now() - ((100 - progress) / 100) * AUTO_DISMISS_MS
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100)
      setProgress(remaining)
      if (remaining === 0) {
        onDismiss(notification.id)
      }
    }, 50)
  }

  return (
    <div
      className="pop toast-pop"
      style={{ cursor: 'pointer' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onOpen(notification.ticketId)}
      role="alert"
      aria-live="polite"
    >
      <div className="toast-head">
        <span>Nova mensagem · #{notification.ticketNumber}</span>
        <button
          type="button"
          className="icon-act"
          onClick={(e) => { e.stopPropagation(); onDismiss(notification.id) }}
          aria-label="Fechar notificação"
        >
          <X size={15} />
        </button>
      </div>
      <strong>{notification.title}</strong>
      <p>{notification.senderName}: {notification.text}</p>
      <i className="toast-time" style={{ width: `${progress}%` }} />
    </div>
  )
}

interface Props {
  notifications: MessageNotification[]
  onDismiss: (id: string) => void
  onOpen: (ticketId: string) => void
}

export function MessageNotificationPopup({ notifications, onDismiss, onOpen }: Props) {
  if (notifications.length === 0) return null

  return (
    <div className="toast-stack" style={{ top: 20 }} aria-label="Notificações de mensagens">
      {notifications.map((n) => (
        <NotificationCard
          key={n.id}
          notification={n}
          onDismiss={onDismiss}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
