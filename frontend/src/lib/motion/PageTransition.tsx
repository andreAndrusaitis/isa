import { useLayoutEffect, useRef, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { animate } from 'animejs'
import { prefersReducedMotion } from './reducedMotion'

interface PageTransitionProps {
  children: ReactNode
  /**
   * Chave que dispara a transição. Default: pathname da rota.
   * Passe um valor próprio para animar trocas de aba/etapa.
   */
  trigger?: string
  className?: string
}

/**
 * Envolve o conteúdo de uma rota e faz um fade + slide suave a cada troca.
 * No-op sob prefers-reduced-motion.
 */
export function PageTransition({ children, trigger, className }: PageTransitionProps) {
  const location = useLocation()
  const key = trigger ?? location.pathname
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    const anim = animate(el, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 320,
      ease: 'outCubic',
    })
    return () => {
      anim.revert?.()
    }
  }, [key])

  return (
    <div ref={ref} className={className} style={{ height: '100%' }}>
      {children}
    </div>
  )
}
