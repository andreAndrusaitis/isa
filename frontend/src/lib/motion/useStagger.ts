import { useLayoutEffect, useRef, DependencyList } from 'react'
import { animate, stagger } from 'animejs'
import { prefersReducedMotion } from './reducedMotion'

interface StaggerOptions {
  /** Seletor dos filhos a animar (default: filhos diretos) */
  selector?: string
  /** Deslocamento vertical inicial em px */
  y?: number
  /** Atraso base antes do primeiro item (ms) */
  delay?: number
  /** Intervalo entre cada item (ms) */
  gap?: number
  /** Duração de cada item (ms) */
  duration?: number
  /** Reexecuta quando estas dependências mudarem */
  deps?: DependencyList
}

/**
 * Anima a entrada escalonada (fade + slide up) dos filhos de um container.
 * Use o ref retornado no elemento pai. No-op sob prefers-reduced-motion.
 *
 * @example
 * const ref = useStagger<HTMLDivElement>({ deps: [items.length] })
 * return <div ref={ref}>{items.map(...)}</div>
 */
export function useStagger<T extends HTMLElement = HTMLElement>(options: StaggerOptions = {}) {
  const {
    selector = ':scope > *',
    y = 16,
    delay = 0,
    gap = 70,
    duration = 500,
    deps = [],
  } = options
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector))
    if (targets.length === 0) return
    if (prefersReducedMotion()) return

    const anim = animate(targets, {
      opacity: [0, 1],
      translateY: [y, 0],
      delay: stagger(gap, { start: delay }),
      duration,
      ease: 'outCubic',
    })
    return () => {
      anim.revert?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
