import type { ReactNode } from 'react'
import { Card } from '@/components/ui'

/** Moldura padrão dos gráficos: título, subtítulo, ação à direita e rodapé curto. */
export function ChartCard({ title, subtitle, action, footer, children, minHeight }: {
  title: string
  subtitle?: string
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
  minHeight?: number
}) {
  return (
    <Card style={{ padding: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, minHeight }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: 'var(--text-1)' }}>{title}</h3>
          {subtitle && <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.45 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
      {footer && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{footer}</div>}
    </Card>
  )
}
