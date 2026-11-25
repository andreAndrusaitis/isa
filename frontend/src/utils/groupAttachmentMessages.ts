/**
 * Cada mensagem guarda um anexo só: quem envia vários arquivos gera, além da
 * mensagem principal, uma mensagem "Anexo adicional: <nome>" por arquivo extra.
 * Na exibição esses extras voltam para a mensagem de origem (mesmo autor, mesmo
 * tipo, enviados em seguida), em vez de virar uma bolha por arquivo.
 */
export interface MessageAttachment {
  id: string
  url: string
  name: string
}

interface GroupableMessage {
  id: string
  userId: string
  type: string
  text?: string | null
  attachmentUrl?: string | null
  createdAt: string
  isRealtime?: boolean
}

const EXTRA_RE = /^Anexo adicional: (.+)$/
/** Os extras saem logo depois da principal, um por requisição. */
const GROUP_WINDOW_MS = 2 * 60_000

export function extraAttachmentName(m: Pick<GroupableMessage, 'text' | 'attachmentUrl'>): string | null {
  if (!m.attachmentUrl) return null
  return m.text?.trim().match(EXTRA_RE)?.[1] ?? null
}

export function groupAttachmentMessages<T extends GroupableMessage>(
  messages: T[],
  opening?: { userId: string; createdAt: string },
): { messages: Array<T & { extraAttachments: MessageAttachment[] }>; openingExtras: MessageAttachment[] } {
  const sorted = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const kept: Array<T & { extraAttachments: MessageAttachment[] }> = []
  const lastAt = new Map<string, number>() // id da mensagem → hora do último anexo agrupado nela
  const openingExtras: MessageAttachment[] = []
  let openingLastAt = opening ? new Date(opening.createdAt).getTime() : 0

  for (const m of sorted) {
    const name = extraAttachmentName(m)
    const at = new Date(m.createdAt).getTime()
    if (name) {
      const extra = { id: m.id, url: m.attachmentUrl!, name }
      const host = [...kept].reverse().find((k) => k.userId === m.userId && k.type === m.type && !!k.isRealtime === !!m.isRealtime)
      if (host && at - (lastAt.get(host.id) ?? 0) <= GROUP_WINDOW_MS) {
        host.extraAttachments.push(extra)
        lastAt.set(host.id, at)
        continue
      }
      if (!host && opening && m.userId === opening.userId && at - openingLastAt <= GROUP_WINDOW_MS) {
        openingExtras.push(extra)
        openingLastAt = at
        continue
      }
    }
    kept.push({ ...m, extraAttachments: [] })
    lastAt.set(m.id, at)
  }

  return { messages: kept, openingExtras }
}
