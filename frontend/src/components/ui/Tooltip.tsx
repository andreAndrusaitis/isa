import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ActiveTooltip {
  text: string
  anchor: { top: number; bottom: number; left: number; right: number }
  forcedPlacement: 'top' | 'bottom' | null
}

const GAP = 6
const MARGIN = 8

/**
 * GlobalTooltip — Intercepta atributos `title` e `data-tooltip` em qualquer elemento
 * do sistema, substituindo o tooltip nativo e rústico do navegador pelo design system do ISA.
 *
 * Características:
 * - Tema consistente (Dark & Light mode usando as CSS variables do sistema)
 * - Largura máxima de 320px com quebra de linha; mede o balão e o mantém dentro da tela
 *   (flip para cima se não couber abaixo; clamp nas bordas laterais, inclusive em 360px)
 * - Supressão do popup nativo do navegador (remove `title` durante o hover)
 * - Evita hints redundantes (quando o texto do elemento já está visível e não truncado)
 * - Toque: um tap mostra a hint; tocar em outro lugar ou rolar a tela fecha
 */
export function GlobalTooltip() {
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null)

  const tipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<any>(null)
  const currentTargetRef = useRef<HTMLElement | null>(null)
  const lastActiveTimestampRef = useRef<number>(0)
  const lastTouchRef = useRef<number>(0)

  useEffect(() => {
    function handlePointerOver(e: PointerEvent | MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest?.('[data-tooltip], [title]') as HTMLElement | null
      if (!target || target.tagName.toLowerCase() === 'title') return

      // Converte title nativo para data-tooltip para suprimir a caixa nativa preta do navegador
      let text = target.getAttribute('data-tooltip')
      if (!text && target.hasAttribute('title')) {
        const raw = target.getAttribute('title')?.trim()
        if (raw) {
          text = raw
          target.setAttribute('data-tooltip', raw)
          target.removeAttribute('title')
        }
      }

      if (!text || !text.trim()) return

      // Se o texto da hint for idêntico ao innerText visível e NÃO estiver truncado, não polui a tela com hint redundante
      const isSameText = target.innerText?.trim() === text.trim()
      const isTargetTruncated = target.scrollWidth > target.clientWidth
      const hasTruncatedChild = Array.from(target.children).some(
        c => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth
      )
      const isTruncated = isTargetTruncated || hasTruncatedChild

      if (isSameText && !isTruncated && target.getAttribute('data-tooltip-always') !== 'true') {
        return
      }

      currentTargetRef.current = target

      const isWarm = Date.now() - lastActiveTimestampRef.current < 250
      const delay = isWarm ? 0 : 120

      if (timerRef.current) clearTimeout(timerRef.current)

      timerRef.current = setTimeout(() => {
        if (currentTargetRef.current !== target || !target.isConnected) return
        const { top, bottom, left, right } = target.getBoundingClientRect()
        setActiveTooltip({
          text: text!,
          anchor: { top, bottom, left, right },
          forcedPlacement: target.getAttribute('data-tooltip-placement') as 'top' | 'bottom' | null,
        })
      }, delay)
    }

    function handlePointerOut(e: PointerEvent | MouseEvent) {
      const target = currentTargetRef.current
      if (!target) return

      // Se o ponteiro ainda estiver dentro do elemento atual
      const related = (e.relatedTarget as HTMLElement | null)
      if (related && target.contains(related)) return

      if (timerRef.current) clearTimeout(timerRef.current)
      currentTargetRef.current = null
      setActiveTooltip(null)
      lastActiveTimestampRef.current = Date.now()
    }

    function handleDismiss() {
      if (timerRef.current) clearTimeout(timerRef.current)
      currentTargetRef.current = null
      setActiveTooltip(null)
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === 'touch') lastTouchRef.current = Date.now()
      handleDismiss()
    }

    // No toque o navegador emite mouseover → mousedown logo após o tap; ignora esse
    // mousedown sintético para a hint chegar a aparecer no celular.
    function handleMouseDown() {
      if (Date.now() - lastTouchRef.current < 1000) return
      handleDismiss()
    }

    document.addEventListener('mouseover', handlePointerOver, { passive: true })
    document.addEventListener('mouseout', handlePointerOut, { passive: true })
    document.addEventListener('pointerdown', handlePointerDown, { passive: true })
    document.addEventListener('mousedown', handleMouseDown, { passive: true })
    window.addEventListener('scroll', handleDismiss, { passive: true, capture: true })
    window.addEventListener('resize', handleDismiss)
    window.addEventListener('blur', handleDismiss)

    return () => {
      document.removeEventListener('mouseover', handlePointerOver)
      document.removeEventListener('mouseout', handlePointerOut)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('scroll', handleDismiss, { capture: true })
      window.removeEventListener('resize', handleDismiss)
      window.removeEventListener('blur', handleDismiss)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Posiciona pelo tamanho real do balão (antes do paint): centraliza no alvo,
  // vira para cima se não couber abaixo e prende nas bordas da viewport.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!activeTooltip || !el) { setPos(null); return }
    const { anchor, forcedPlacement } = activeTooltip
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

    const fitsBelow = anchor.bottom + GAP + height <= vh - MARGIN
    const fitsAbove = anchor.top - GAP - height >= MARGIN
    const placement = forcedPlacement || (!fitsBelow && fitsAbove ? 'top' : 'bottom')
    const top = placement === 'top' ? anchor.top - GAP - height : anchor.bottom + GAP

    setPos({
      left: clamp((anchor.left + anchor.right) / 2 - width / 2, MARGIN, vw - width - MARGIN),
      top: clamp(top, MARGIN, vh - height - MARGIN),
      placement,
    })
  }, [activeTooltip])

  if (!activeTooltip) return null

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 100000,
        // max-content evita o shrink-to-fit do position:fixed (que espremia o balão
        // perto da borda direita, quebrando letra a letra); quebra só ao atingir o máximo.
        width: 'max-content',
        maxWidth: `min(320px, calc(100vw - ${MARGIN * 2}px))`,
        padding: '7px 11px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--text-1)',
        color: 'var(--bg-card)',
        fontFamily: 'var(--font)',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.45,
        whiteSpace: 'normal',
        overflowWrap: 'break-word',
        pointerEvents: 'none',
        animation: pos ? `globalTooltipIn-${pos.placement} 0.12s ease-out` : undefined,
      }}
    >
      <style>{`
        @keyframes globalTooltipIn-top { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @keyframes globalTooltipIn-bottom { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
      `}</style>
      {activeTooltip.text}
    </div>,
    document.body
  )
}

/**
 * Componente declarativo `<Tooltip content="...">` para envolver qualquer elemento diretamente.
 */
export function Tooltip({
  content,
  children,
  placement,
  always = false,
}: {
  content?: string | null
  children: React.ReactNode
  placement?: 'top' | 'bottom'
  always?: boolean
}) {
  if (!content) return <>{children}</>
  return (
    <span
      data-tooltip={content}
      data-tooltip-placement={placement}
      data-tooltip-always={always ? 'true' : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', minWidth: 0 }}
    >
      {children}
    </span>
  )
}
