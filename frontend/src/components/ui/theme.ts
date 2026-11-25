import { useEffect, useState } from 'react'
import { animate } from 'animejs'
import { prefersReducedMotion } from '@/lib/motion'

const STORAGE_KEY = 'isa-theme'

// Variáveis de tokens.css que mudam entre light/dark e valem a pena animar
const ANIMATED_VARS = [
  '--bg-app', '--bg-sidebar', '--bg-card', '--bg-card-hover', '--bg-topbar',
  '--bg-elevated', '--bg-input', '--bg-table-head', '--border', '--border-strong',
  '--text-1', '--text-2', '--text-3',
]

// Tema imposto pelo anfitrião (Teams): vence a preferência salva e não é gravado.
let hostTheme: 'light' | 'dark' | null = null
const hostListeners = new Set<(theme: 'light' | 'dark') => void>()

export function setHostTheme(theme: 'light' | 'dark', animated = false) {
  const changed = hostTheme !== null && hostTheme !== theme
  hostTheme = theme
  if (animated && changed) animateThemeSwitch(theme)
  else document.documentElement.setAttribute('data-theme', theme)
  hostListeners.forEach(l => l(theme))
}

function getInitialTheme(): 'light' | 'dark' {
  if (hostTheme) {
    document.documentElement.setAttribute('data-theme', hostTheme)
    return hostTheme
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  const theme = stored === 'dark' || stored === 'light' ? stored : 'light'
  document.documentElement.setAttribute('data-theme', theme)
  return theme
}

function animateThemeSwitch(next: 'light' | 'dark') {
  const root = document.documentElement
  if (prefersReducedMotion()) {
    root.setAttribute('data-theme', next)
    return
  }

  const from = ANIMATED_VARS.map((v) => getComputedStyle(root).getPropertyValue(v).trim())
  root.setAttribute('data-theme', next)
  const to = ANIMATED_VARS.map((v) => getComputedStyle(root).getPropertyValue(v).trim())

  // Fixa os valores antigos inline para poder animar até os novos (anime.js interpola --custom-properties)
  ANIMATED_VARS.forEach((v, i) => root.style.setProperty(v, from[i]))
  animate(root, {
    ...Object.fromEntries(ANIMATED_VARS.map((v, i) => [v, to[i]])),
    duration: 450,
    ease: 'inOutQuad',
    onComplete: () => ANIMATED_VARS.forEach((v) => root.style.removeProperty(v)),
  })
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)
  useEffect(() => {
    hostListeners.add(setTheme)
    return () => { hostListeners.delete(setTheme) }
  }, [])
  const toggle = () => {
    if (hostTheme) return
    const next = theme === 'light' ? 'dark' : 'light'
    animateThemeSwitch(next)
    localStorage.setItem(STORAGE_KEY, next)
    setTheme(next)
  }
  return { theme, toggle }
}
