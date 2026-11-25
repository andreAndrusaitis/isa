const ANIMATION_CSS = `
@keyframes dash-fade-in {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
`

let cssInjected = false
function injectCss() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = ANIMATION_CSS
  document.head.appendChild(style)
}

/** Wrapper that fades in children after mount */
export function FadeIn({ children, delay = 0, style = {} }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  injectCss()
  return (
    <div style={{
      animation: `dash-fade-in 0.4s cubic-bezier(0.16,1,0.3,1) ${delay}ms both`,
      ...style
    }}>
      {children}
    </div>
  )
}
