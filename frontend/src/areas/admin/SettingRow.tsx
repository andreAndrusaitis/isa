import type { ReactNode } from 'react'
import './admin.css'

/** Linha de ajuste: rótulo e explicação à esquerda, controle à direita. */
export function SettingRow({ label, help, htmlFor, children }: { label: ReactNode; help?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div>{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}{help && <small>{help}</small>}</div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
