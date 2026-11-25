import api from './api'
import { BellItem } from '@/store/notifications'

interface ApiNotification {
  id: string
  ticket_id: string
  type: BellItem['type']
  title: string
  body: string
  sender_name: string | null
  created_at: string
}

interface ApiTaskNotification extends Omit<ApiNotification, 'ticket_id'> {
  task_id: string
  task: { project_id: string; seq: number; key: string | null }
}

export type ProjectBellItem = BellItem & { projectId: string }

function mapNotification(n: ApiNotification): BellItem {
  return {
    id: n.id,
    ticketId: n.ticket_id,
    ticketNumber: n.ticket_id,
    type: n.type,
    title: n.title,
    body: n.body,
    senderName: n.sender_name,
    createdAt: n.created_at,
  }
}

/**
 * Executa uma atualização secundária sem impedir a renderização dos dados
 * principais da página. Falhas de notificação não devem bloquear a tela.
 */
export async function refreshUnreadNotifications<T>(
  load: () => Promise<T>,
  onLoaded: (items: T) => void,
): Promise<void> {
  try {
    onLoaded(await load())
  } catch {
    // Notificações são complementares; a próxima atualização tentará novamente.
  }
}

export const notificationService = {
  async getUnread(): Promise<BellItem[]> {
    const { data } = await api.get('/notifications')
    return (data.data as ApiNotification[]).map(mapNotification)
  },

  /**
   * Carrega notificações do banco e completa com itens sintéticos para
   * tickets que têm mensagens não lidas mas sem registro de notificação.
   * Retorna a lista mesclada e o total para o banner de login.
   */
  async getUnreadMerged(
    tickets: Array<{ id: string; title: string; latestMessage?: { userId: string; createdAt: string } | null }>,
    currentUserId: string,
    lastOpened: Record<string, number>,
  ): Promise<BellItem[]> {
    const dbItems = await this.getUnread().catch(() => [] as BellItem[])
    const dbTicketIds = new Set(dbItems.map((b) => b.ticketId))

    const synthetic: BellItem[] = []
    for (const t of tickets) {
      if (dbTicketIds.has(t.id)) continue
      const lm = t.latestMessage
      if (!lm) continue
      if (lm.userId === currentUserId) continue
      const msgTime = new Date(lm.createdAt).getTime()
      const openedAt = lastOpened[t.id] ?? 0
      if (msgTime <= openedAt) continue
      synthetic.push({
        id: `local-${t.id}`,
        ticketId: t.id,
        ticketNumber: t.id,
        type: 'new_message',
        title: t.title,
        body: 'Há mensagens não lidas neste chamado',
        senderName: null,
        createdAt: lm.createdAt,
      })
    }

    return [...dbItems, ...synthetic]
  },

  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`)
  },

  async markTicketRead(ticketId: string): Promise<void> {
    await api.patch(`/notifications/ticket/${ticketId}/read`)
  },

  async markAllRead(): Promise<void> {
    await api.patch('/notifications/read-all')
  },

  /** Notificações de tarefa (sino da área de Projetos); ticketId carrega o id da tarefa. */
  async getUnreadTasks(): Promise<ProjectBellItem[]> {
    const { data } = await api.get('/notifications/tasks')
    return (data.data as ApiTaskNotification[]).map((n) => ({
      id: n.id,
      ticketId: n.task_id,
      ticketNumber: n.task.key ?? String(n.task.seq),
      projectId: n.task.project_id,
      type: n.type,
      title: n.title,
      body: n.body,
      senderName: n.sender_name,
      createdAt: n.created_at,
    }))
  },

  async markAllTasksRead(): Promise<void> {
    await api.patch('/notifications/tasks/read-all')
  },
}
