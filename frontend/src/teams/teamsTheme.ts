/**
 * Tema do Teams → tema do ISA. O Teams tem `default` (claro), `dark` e
 * `contrast` (alto contraste): o último usa o escuro com data-contrast="more"
 * (bordas e foco reforçados em tokens.css).
 */
import { setHostTheme } from '@/components/ui/theme'

export interface HostTheme {
  theme: 'light' | 'dark'
  highContrast: boolean
}

export function mapTeamsTheme(teamsTheme?: string | null): HostTheme {
  switch (teamsTheme) {
    case 'dark': return { theme: 'dark', highContrast: false }
    case 'contrast': return { theme: 'dark', highContrast: true }
    default: return { theme: 'light', highContrast: false }
  }
}

export function applyTeamsTheme(teamsTheme?: string | null, animated = false) {
  const { theme, highContrast } = mapTeamsTheme(teamsTheme)
  const root = document.documentElement
  if (highContrast) root.setAttribute('data-contrast', 'more')
  else root.removeAttribute('data-contrast')
  setHostTheme(theme, animated && !highContrast)
}
