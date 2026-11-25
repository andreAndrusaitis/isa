import { useEffect, useRef, ReactNode, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'
import { animate } from 'animejs'
import { prefersReducedMotion } from '@/lib/motion'

/**
 * Props de fechamento por backdrop. Só fecha quando o clique COMEÇA e TERMINA no
 * backdrop — sem isso, arrastar a seleção de dentro de um campo (ex.: marcar a
 * senha digitada) e soltar o mouse fora dispara `click` no backdrop e o modal
 * some, perdendo tudo que foi preenchido.
 */
export function useBackdropClose(onClose: () => void) {
  const startedOnBackdrop = useRef(false)
  return {
    onMouseDown: (e: ReactMouseEvent) => { startedOnBackdrop.current = e.target === e.currentTarget },
    onClick: (e: ReactMouseEvent) => {
      if (e.target !== e.currentTarget || !startedOnBackdrop.current) return
      startedOnBackdrop.current = false
      onClose()
    },
  }
}

/** Acima desta largura o diálogo é um formulário: abre como folha, encostado à direita. */
const SHEET_FROM = 460

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** aria-modal promete que a página atrás está inerte: o Tab dá a volta dentro do diálogo. */
function keepTabInside(e: ReactKeyboardEvent, panel: HTMLElement) {
  const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (!items.length) return e.preventDefault()
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

export function Modal({ isOpen, onClose, title, children, footer, width = 440, hideCloseButton = false, preventBackdropClose = false }: {
  isOpen: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number; hideCloseButton?: boolean; preventBackdropClose?: boolean
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropClose = useBackdropClose(onClose)

  // Lido no render: quando o efeito roda, o autoFocus do conteúdo já tirou o foco de quem abriu.
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (isOpen && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null
  wasOpen.current = isOpen

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'auto'
    return () => { document.body.style.overflow = 'auto' }
  }, [isOpen])

  // Entrada animada (backdrop fade + painel com spring). No-op em reduced-motion.
  useEffect(() => {
    if (!isOpen || prefersReducedMotion()) return
    const sheet = width > SHEET_FROM
    if (backdropRef.current) {
      animate(backdropRef.current, { opacity: [0, 1], duration: 200, ease: 'outQuad' })
    }
    if (panelRef.current) {
      animate(panelRef.current, { opacity: [0, 1], translateX: [sheet ? 28 : 0, 0], duration: 180, ease: 'outQuad' })
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps -- a largura não muda com o diálogo aberto

  // Foco entra no diálogo ao abrir (leitor de tela e Esc atuam no modal de cima), sem
  // tirar do campo com autoFocus, e volta a quem abriu ao fechar. A volta espera a
  // microtask: o StrictMode desmonta de mentira (o painel segue na tela), e outro
  // modal abrindo no lugar já terá pegado o foco.
  useEffect(() => {
    if (!isOpen) return
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
    return () => queueMicrotask(() => {
      const focusLost = !document.activeElement || document.activeElement === document.body
      // eslint-disable-next-line react-hooks/exhaustive-deps -- o valor atual é a resposta: null = o painel saiu mesmo da tela
      if (!panelRef.current && focusLost) opener.current?.focus()
    })
  }, [isOpen])

  if (!isOpen) return null
  const sheet = width > SHEET_FROM

  return (
    <div ref={backdropRef} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--scrim)', display: 'flex', alignItems: sheet ? 'stretch' : 'flex-start', justifyContent: sheet ? 'flex-end' : 'center', zIndex: 1000, padding: sheet ? 0 : '14vh 12px 12px', boxSizing: 'border-box' }} {...(preventBackdropClose ? {} : backdropClose)}>
      <div ref={panelRef} style={{ background: 'var(--bg-card)', borderRadius: sheet ? 'var(--r-lg) 0 0 var(--r-lg)' : 'var(--r-lg)', width, maxWidth: sheet ? '100vw' : 'calc(100vw - 24px)', height: sheet ? '100%' : undefined, maxHeight: sheet ? '100%' : '80vh', boxSizing: 'border-box', boxShadow: 'var(--pop-shadow)', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none' }} onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Tab') keepTabInside(e, e.currentTarget)
          if (e.key === 'Escape' && !hideCloseButton && !preventBackdropClose) { e.stopPropagation(); onClose() }
        }}>
        <div style={{ padding: '24px clamp(16px, 3vw, 32px) 4px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ fontSize: sheet ? 24 : 19, fontWeight: 500, lineHeight: 1.25, color: 'var(--text-1)', margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</h3>
          {!hideCloseButton && (
            <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', padding: '4px', flexShrink: 0 }}><X size={18}/></button>
          )}
        </div>
        <div style={{ padding: '16px clamp(16px, 3vw, 32px) 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '14px clamp(16px, 3vw, 32px)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
