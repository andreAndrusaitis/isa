import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { prefersReducedMotion } from './reducedMotion'

interface ScrollRevealOptions {
  y?: number
  duration?: number
  /** Fração visível para disparar (0–1) */
  threshold?: number
}

/**
 * Revela um elemento (fade + slide up) na primeira vez que ele entra no viewport.
 * No-op sob prefers-reduced-motion. Use o ref retornado no elemento alvo.
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  options: ScrollRevealOptions = {},
) {
  const { y = 24, duration = 600, threshold = 0.15 } = options
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    if (typeof IntersectionObserver === 'undefined') return

    el.style.opacity = '0'
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          obs.unobserve(entry.target)
          animate(entry.target, {
            opacity: [0, 1],
            translateY: [y, 0],
            duration,
            ease: 'outCubic',
          })
        })
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [y, duration, threshold])

  return ref
}
