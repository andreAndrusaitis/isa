import { useEffect, useRef, useState, useCallback, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ScrollFadeIndicatorProps {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  minWidth?: number
}

/**
 * Lista com rolagem lateral: um esmaecido na borda e um botão avisam que há mais
 * conteúdo. Com a classe `stack-list` no celular as linhas viram blocos e não há o que rolar.
 */
export function ScrollFadeIndicator({ children, className = '', style, minWidth }: ScrollFadeIndicatorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const check = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const canScroll = el.scrollWidth > el.clientWidth + 2
    const left = canScroll && el.scrollLeft > 4
    const right = canScroll && el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setMore(m => (m.left === left && m.right === right ? m : { left, right }))
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    check()
    window.addEventListener('resize', check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      window.removeEventListener('resize', check)
      ro.disconnect()
    }
  }, [check])

  const edge = (side: 'left' | 'right') => more[side] && (
    <div className={`scroll-edge scroll-edge-${side}`}>
      <button type="button" aria-label={side === 'left' ? 'Ver colunas à esquerda' : 'Ver colunas à direita'}
        onClick={() => containerRef.current?.scrollBy({ left: side === 'left' ? -300 : 300, behavior: 'smooth' })}>
        {side === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
  )

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
      <div ref={containerRef} className={`ticket-table-container ${className}`} style={{ flex: 1 }} onScroll={check}>
        {minWidth != null ? (
          <div className="scroll-min" style={{ minWidth, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {children}
          </div>
        ) : children}
      </div>
      {edge('left')}
      {edge('right')}
    </div>
  )
}
