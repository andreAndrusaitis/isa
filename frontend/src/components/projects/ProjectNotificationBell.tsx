import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { notificationService, refreshUnreadNotifications, ProjectBellItem } from '@/services/notificationService'
import { useTaskDrawer } from './taskDrawerContext'

/** Sino da área de Projetos: menções, atualizações e automações de tarefas. */
export function ProjectNotificationBell() {
  const { openTask } = useTaskDrawer() // abre sobre a tela atual, sem sair dela
  const { pathname } = useLocation()
  const [items, setItems] = useState<ProjectBellItem[]>([])

  // shortcut: notificação de tarefa não é emitida por socket; recarrega a cada navegação e a cada minuto.
  useEffect(() => {
    const load = () => refreshUnreadNotifications(notificationService.getUnreadTasks, setItems)
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [pathname])

  const removeTask = (taskId: string) => setItems((prev) => prev.filter((i) => i.ticketId !== taskId))

  return (
    <NotificationBell
      bellItems={items}
      onMarkRead={removeTask}
      onMarkAllRead={() => setItems([])}
      // Uma tarefa pode ter várias notificações: marca todas as dela.
      markReadRemote={async (taskId) => {
        await Promise.all(items.filter((i) => i.ticketId === taskId).map((i) => notificationService.markRead(i.id)))
      }}
      markAllReadRemote={notificationService.markAllTasksRead}
      onOpenTicket={(taskId) => {
        const item = items.find((i) => i.ticketId === taskId)
        if (item) openTask(item.projectId, taskId)
      }}
    />
  )
}
