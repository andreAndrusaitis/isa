import { useEffect, useState, type CSSProperties } from 'react'
import { LogoMark } from './Logo'

export type LoadingSize = 'page' | 'compact'

interface LoadingProps {
  /** Texto da tela; fica no DOM desde o início para leitor de tela e testes. */
  label?: string
  /** `page`: centrado na área (tela e aba). `compact`: painéis, modais e abas internas. */
  size?: LoadingSize
  /** Tempo até aparecer, em ms: carga rápida não pisca. O espaço fica reservado antes disso. */
  delay?: number
  className?: string
  style?: CSSProperties
}

/** Carregamento padrão do sistema: a marca do ISA com o texto da tela. */
export function Loading({ label = 'Carregando…', size = 'page', delay = 200, className, style }: LoadingProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <div
      className={className ? `app-loading ${className}` : 'app-loading'}
      data-size={size}
      data-visible={visible}
      role="status"
      aria-live="polite"
      style={style}
    >
      <span className="app-loading-mark" aria-hidden="true">
        <LogoMark size={size === 'page' ? 44 : 26} />
      </span>
      {size === 'page' && <div className="loading-bar-track"><div className="loading-bar-fill" /></div>}
      <span>{label}</span>
    </div>
  )
}
