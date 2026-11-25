import type { ReactNode } from 'react'
import { Card } from '@/components/ui'
import './projects.css'

/** Seção da área de Projetos: fio em cima, título, explicação e ação à direita. */
export function Section({ title, sub, action, footer, small, children }: {
  title: ReactNode; sub?: ReactNode; action?: ReactNode; footer?: ReactNode; small?: boolean; children: ReactNode
}) {
  return (
    <Card className={small ? 'prj-section small' : 'prj-section'}>
      <header>
        <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        {action}
      </header>
      {children}
      {footer && <footer>{footer}</footer>}
    </Card>
  )
}
