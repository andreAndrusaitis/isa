import { useCallback } from 'react'

const STORAGE_KEY = 'isa-ticket-last-opened'

export function getLastOpened(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function setLastOpened(ticketId: string) {
  const map = getLastOpened()
  map[ticketId] = Date.now()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

/**
 * Computa quais tickets têm mensagens não lidas com base em:
 * 1. latestMessage retornado pelo backend no GET /tickets
 * 2. Timestamp de quando o usuário abriu o ticket pela última vez (localStorage)
 */
export function computeUnreadFromTickets(
  tickets: Array<{ id: string; latestMessage?: { userId: string; createdAt: string } | null }>,
  currentUserId: string,
): Record<string, number> {
  const lastOpened = getLastOpened()
  const unread: Record<string, number> = {}

  for (const t of tickets) {
    if (!t.latestMessage) continue
    const msgTime = new Date(t.latestMessage.createdAt).getTime()
    const openedAt = lastOpened[t.id] ?? 0
    // Só conta como não lido se a mensagem é de outra pessoa e é mais nova que a última abertura
    if (t.latestMessage.userId !== currentUserId && msgTime > openedAt) {
      unread[t.id] = 1
    }
  }

  return unread
}

export function useUnreadCounts() {
  const markRead = useCallback((ticketId: string) => {
    setLastOpened(ticketId)
  }, [])

  return { markRead }
}
