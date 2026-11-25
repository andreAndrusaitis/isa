/**
 * Detecção de `prefers-reduced-motion`.
 * Toda animação da camada de motion deve consultar isto e degradar para
 * o estado final imediato quando o usuário pede menos movimento.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
