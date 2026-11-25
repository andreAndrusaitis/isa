import { Avatar } from '@/components/ui'

type Person = { userId: string; user: { name: string; avatar: string | null } }

/** Fotos dos responsáveis lado a lado (principal primeiro), até `max` e depois "+N". */
export function AssigneeStack({ assignees, primaryId, size = 20, max = 3 }: {
  assignees: Person[]
  primaryId?: string | null
  size?: number
  max?: number
}) {
  const ordered = [...assignees].sort((a, b) => Number(b.userId === primaryId) - Number(a.userId === primaryId))
  const extra = ordered.length - max
  return (
    <span
      role="img"
      aria-label={`Responsáveis: ${ordered.map((a) => a.user.name).join(', ')}`}
      title={ordered.map((a) => a.user.name).join(', ')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}
    >
      {ordered.slice(0, max).map((a) => (
        <Avatar key={a.userId} name={a.user.name} src={a.user.avatar} size={size} rounded />
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>+{extra}</span>
      )}
    </span>
  )
}
