import { ReactNode } from 'react'

import { Inbox } from 'lucide-react'

export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty" style={{ maxWidth: 560, color: 'var(--text-3)' }}>
      <div className="empty-art" aria-hidden>{icon && icon !== '—' ? icon : <Inbox size={38} strokeWidth={1.6} />}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)' }}>{title}</div>
      {desc && <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>{desc}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}
