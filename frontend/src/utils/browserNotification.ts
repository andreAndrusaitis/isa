let permissionRequested = false

export function requestNotificationPermission(): void {
  if (permissionRequested || !('Notification' in window)) return
  permissionRequested = true
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function showBrowserNotification(title: string, body: string, ticketId?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.hasFocus()) return

  const tag = ticketId ? `${ticketId}-${Date.now()}` : undefined
  const n = new Notification(title, {
    body,
    icon: '/favicon.svg',
    tag,
  } as NotificationOptions)

  n.onclick = () => {
    window.focus()
    n.close()
  }
}
