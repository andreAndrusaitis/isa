import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { prefersReducedMotion } from './reducedMotion'

interface CountUpOptions {
  duration?: number
  /** Casas decimais no resultado */
  decimals?: number
  /** Formatação final do número (ex.: adicionar "%", separador de milhar) */
  format?: (value: number) => string
}

/**
 * Anima um número de 0 até `value` e escreve no elemento referenciado.
 * Ideal para KPIs de dashboard. No-op (escreve o valor final) sob reduced-motion.
 *
 * @example
 * const ref = useCountUp(total, { format: (n) => n.toLocaleString('pt-BR') })
 * return <span ref={ref} />
 */
export function useCountUp(value: number, options: CountUpOptions = {}) {
  const { duration = 800, decimals = 0, format } = options
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const factor = Math.pow(10, decimals)
    const render = (n: number) => {
      const rounded = Math.round(n * factor) / factor
      el.textContent = format ? format(rounded) : String(rounded)
    }

    if (prefersReducedMotion()) {
      render(value)
      return
    }

    const counter = { val: 0 }
    const anim = animate(counter, {
      val: value,
      duration,
      ease: 'outExpo',
      onUpdate: () => render(counter.val),
    })

    return () => {
      anim.revert?.()
    }
  }, [value, duration, decimals, format])

  return ref
}
