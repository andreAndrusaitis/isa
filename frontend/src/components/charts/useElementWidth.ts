import { useLayoutEffect, useRef, useState } from 'react'

/** Largura do elemento, atualizada no resize (gráficos responsivos sem largura fixa). */
export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width || fallback)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return { ref, width }
}
