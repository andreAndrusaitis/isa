/**
 * Aparência da organização: três cores escolhidas pelo admin viram todos os tokens
 * de cor do sistema (claro e escuro). Os textos são ajustados até passar o contraste
 * AA (4.5:1), então qualquer cor escolhida continua legível.
 *
 * O resultado entra num <style id="brand-theme">: estilos inline no <html> seriam
 * apagados pela animação de troca de tema (components/ui/theme.ts).
 */
export interface BrandSeeds {
  /** Botões, links, seleção e foco. */
  primary: string
  /** Destaques: item ativo do menu, partes da logo, login. */
  accent: string
  /** Menu lateral e fundo do login. */
  sidebar: string
}

export const DEFAULT_SEEDS: BrandSeeds = { primary: '#0f73ac', accent: '#38bdf8', sidebar: '#0b1b27' }

export type TokenMap = Record<string, string>
type Rgb = [number, number, number]

const HEX = /^#[0-9a-f]{6}$/i
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

const toRgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const toHex = (rgb: Rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** Mistura `amount` (0–1) de `b` em `a`. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a), y = toRgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * amount) as Rgb)
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const isDark = (hex: string) => luminance(hex) < 0.18

/** Aproxima `color` de preto ou branco só o necessário para atingir `ratio` sobre todos os fundos. */
export function readable(color: string, backgrounds: string[], ratio = 4.5): string {
  const toward = isDark(backgrounds[0]) ? '#ffffff' : '#000000'
  for (let t = 0; t < 1; t += 0.04) {
    const candidate = mix(color, toward, t)
    if (backgrounds.every(bg => contrast(candidate, bg) >= ratio)) return candidate
  }
  return toward
}

/** Texto sobre um fundo colorido: branco ou um escuro da mesma família, o que ler melhor. */
export function onColor(bg: string): string {
  const dark = mix(bg, '#000000', 0.86)
  return contrast('#ffffff', bg) >= 4.5 || contrast('#ffffff', bg) >= contrast(dark, bg) ? '#ffffff' : dark
}

const alpha = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

function accentTokens(accent: string, fg: string): TokenMap {
  return {
    '--accent': accent,
    '--accent-fg': fg,
    '--on-accent': onColor(accent),
    '--accent-soft': alpha(accent, 9),
    '--accent-border': alpha(accent, 45),
    '--accent-ring': alpha(accent, 28),
    '--active-overlay': alpha(accent, 9),
    '--blue-700': accent,
    '--blue-600': accent,
    '--blue-fg': fg,
    '--blue-border': alpha(accent, 45),
  }
}

/** Menu lateral e login não mudam com o tema claro/escuro: saem da cor `sidebar`. */
function chromeTokens(sidebar: string, accent: string): TokenMap {
  const dark = isDark(sidebar)
  const ink = dark ? '#ffffff' : '#000000'
  return {
    '--bg-sidebar': sidebar,
    '--sidebar-text': readable(mix(sidebar, ink, 0.8), [sidebar], 7),
    '--sidebar-muted': readable(mix(sidebar, ink, 0.58), [sidebar]),
    '--sidebar-strong': dark ? '#ffffff' : '#000000',
    '--sidebar-accent': readable(accent, [mix(sidebar, accent, 0.16), sidebar]),
    '--sidebar-active': alpha(accent, 16),
    '--sidebar-hover': alpha(ink, 7),
    '--sidebar-border': alpha(ink, 12),
    '--login-bg': sidebar,
    '--login-glow': mix(sidebar, accent, 0.34),
    '--login-deep': mix(sidebar, '#000000', dark ? 0.35 : 0.06),
    '--login-title': ink,
    '--login-accent': readable(accent, [sidebar, mix(sidebar, accent, 0.34)], 3),
    '--login-text': readable(mix(sidebar, ink, 0.66), [sidebar]),
    '--login-card': alpha(ink, 6),
    '--login-card-border': alpha(ink, 13),
  }
}

export function deriveTheme(seeds: BrandSeeds): { light: TokenMap; dark: TokenMap } {
  const { primary, accent, sidebar } = seeds
  const chrome = chromeTokens(sidebar, accent)
  const ink = mix('#0b1a24', primary, 0.1)

  const lightCard = '#ffffff'
  // Página branca: quem separa é o fio, não o cartão. O tom da marca fica nas faixas (topo, campos, seleção).
  const lightApp = '#ffffff'
  const lightTint = mix('#ffffff', primary, 0.06)
  const light: TokenMap = {
    '--bg-app': lightApp,
    '--bg-card': lightCard,
    '--bg-card-hover': lightTint,
    '--bg-topbar': lightTint,
    '--bg-elevated': lightTint,
    '--bg-input': lightTint,
    '--bg-table-head': lightApp,
    '--bg-panel': lightTint,
    '--tint': lightTint,
    '--rule': ink,
    '--border': mix(mix('#ffffff', '#5b7383', 0.2), primary, 0.05),
    '--border-strong': mix(mix('#ffffff', '#5b7383', 0.36), primary, 0.06),
    '--text-1': readable(ink, [lightCard], 12),
    '--text-2': readable(mix(ink, '#ffffff', 0.28), [lightCard, lightTint], 5.5),
    '--text-3': readable(mix(ink, '#ffffff', 0.42), [lightCard, lightTint]),
    '--hover-overlay': alpha(ink, 4),
    '--navy-900': ink,
    '--navy-800': mix(ink, primary, 0.12),
    '--navy-700': mix(ink, primary, 0.26),
    '--navy-600': mix(ink, primary, 0.5),
    ...accentTokens(primary, readable(primary, [lightCard, lightTint])),
    '--accent-light': accent,
    '--blue-500': primary,
    '--blue-400': mix(primary, '#ffffff', 0.3),
    '--blue-100': mix('#ffffff', primary, 0.13),
    '--blue-50': mix('#ffffff', primary, 0.07),
    '--logo-base': readable(mix(primary, '#000000', 0.44), [lightCard], 7),
    '--logo-accent': accent,
    '--scrim': alpha(ink, 55),
    '--shadow-color': alpha(ink, 14),
    ...chrome,
  }

  const darkCard = mix('#0f1a22', primary, 0.06)
  const darkApp = darkCard
  const darkTint = mix(darkCard, '#ffffff', 0.055)
  const darkDeep = mix('#090f14', primary, 0.04)
  const darkAccent = readable(primary, [darkCard], 4.6)
  const dark: TokenMap = {
    '--bg-app': darkApp,
    '--bg-card': darkCard,
    '--bg-card-hover': darkTint,
    '--bg-topbar': darkDeep,
    '--bg-elevated': darkTint,
    '--bg-input': darkTint,
    '--bg-table-head': darkApp,
    '--bg-panel': darkDeep,
    '--tint': darkTint,
    '--rule': mix(darkCard, '#ffffff', 0.55),
    '--border': alpha(mix('#ffffff', primary, 0.2), 11),
    '--border-strong': alpha(mix('#ffffff', primary, 0.2), 19),
    '--text-1': mix('#ffffff', primary, 0.08),
    '--text-2': readable(mix(darkCard, '#ffffff', 0.62), [darkCard, darkTint], 6),
    '--text-3': readable(mix(darkCard, '#ffffff', 0.5), [darkCard, darkTint]),
    '--hover-overlay': 'rgba(255, 255, 255, 0.035)',
    '--navy-900': mix(darkDeep, '#000000', 0.2),
    '--navy-800': mix(darkCard, '#ffffff', 0.04),
    '--navy-700': mix(darkCard, '#ffffff', 0.09),
    '--navy-600': mix(darkCard, '#ffffff', 0.16),
    ...accentTokens(darkAccent, readable(primary, [darkCard, darkTint], 5.5)),
    '--accent-light': accent,
    '--blue-500': darkAccent,
    '--blue-400': mix(darkAccent, '#ffffff', 0.2),
    '--blue-100': alpha(darkAccent, 16),
    '--blue-50': alpha(darkAccent, 12),
    '--logo-base': '#ffffff',
    '--logo-accent': accent,
    '--scrim': 'rgba(0, 0, 0, 0.62)',
    '--shadow-color': 'rgba(0, 0, 0, 0.4)',
    ...chrome,
  }
  return { light, dark }
}

const block = (selector: string, tokens: TokenMap) => `${selector}{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')}}`

export function themeCss(seeds: BrandSeeds): string {
  const { light, dark } = deriveTheme(seeds)
  // O alto contraste (data-contrast) fica fora: seus valores fixos precisam vencer.
  return block(':root,[data-theme="light"]', light) + block('[data-theme="dark"]:not([data-contrast="more"])', dark)
}

const STYLE_ID = 'brand-theme'
const CACHE_KEY = 'isa-brand'

export function parseSeeds(value: unknown): BrandSeeds | null {
  const v = value as Partial<BrandSeeds> | null
  if (!v || !isHexColor(v.primary) || !isHexColor(v.accent) || !isHexColor(v.sidebar)) return null
  return { primary: v.primary.toLowerCase(), accent: v.accent.toLowerCase(), sidebar: v.sidebar.toLowerCase() }
}

const isDefault = (s: BrandSeeds) => s.primary === DEFAULT_SEEDS.primary && s.accent === DEFAULT_SEEDS.accent && s.sidebar === DEFAULT_SEEDS.sidebar

/** Aplica as cores na página, sem gravar (também serve à prévia do painel). */
export function applySeeds(seeds: BrandSeeds) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (isDefault(seeds)) { el?.remove(); return }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = themeCss(seeds)
}

/** Cores guardadas do último acesso: evitam piscar a paleta padrão antes da resposta da API. */
export function applyCachedSeeds() {
  try {
    const seeds = parseSeeds(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'))
    if (seeds) applySeeds(seeds)
  } catch { /* sem armazenamento: fica a paleta padrão */ }
}

export function storeSeeds(seeds: BrandSeeds) {
  applySeeds(seeds)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(seeds)) } catch { /* idem */ }
}
