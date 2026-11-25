import { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react'

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'dark'
type BtnSize    = 'xs' | 'sm' | 'md' | 'lg'

export function Btn({ children, variant = 'primary', size = 'md', style, icon, ...props }: {
  children?: ReactNode; variant?: BtnVariant; size?: BtnSize; style?: CSSProperties; icon?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`btn btn-${variant} btn-${size}${props.className ? ` ${props.className}` : ''}`} style={style}>
      {icon && <span className="btn-icon">{icon}</span>}
      {children}
    </button>
  )
}
