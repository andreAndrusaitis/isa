/** Cores da organização: três cores, de onde a interface deriva todos os tons. */
import { z } from 'zod'
import { clearSetting, readSetting, writeSetting } from './systemSettings'
import { logger } from '../utils/logger'
import type { AuditInfo } from '../utils/audit'

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #rrggbb').transform(v => v.toLowerCase())
export const appearanceSchema = z.object({ primary: hex, accent: hex, sidebar: hex }).strict()
export type Appearance = z.infer<typeof appearanceSchema>

export const DEFAULT_APPEARANCE: Appearance = { primary: '#0f73ac', accent: '#38bdf8', sidebar: '#0b1b27' }

let current: Appearance = DEFAULT_APPEARANCE
let loadedAt = 0

export async function getAppearance(): Promise<Appearance> {
  const row = await readSetting('appearance')
  const parsed = appearanceSchema.safeParse(row?.value)
  current = parsed.success ? parsed.data : DEFAULT_APPEARANCE
  loadedAt = Date.now()
  return current
}

export async function updateAppearance(input: unknown, audit: AuditInfo): Promise<Appearance> {
  const data = appearanceSchema.parse(input)
  await writeSetting('appearance', data, {}, audit)
  return getAppearance()
}

export async function resetAppearance(audit: AuditInfo): Promise<Appearance> {
  await clearSetting('appearance', audit)
  return getAppearance()
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// 0.183 é onde preto e branco dão o mesmo contraste.
const on = (bg: string) => (luminance(bg) > 0.183 ? '#0b1b27' : '#ffffff')

/** Cores para e-mails (sem variáveis CSS lá). Síncrono: usa o último valor lido e se renova em segundo plano. */
export function emailColors() {
  if (Date.now() - loadedAt > 60_000 && !process.env.VITEST) {
    loadedAt = Date.now()
    getAppearance().catch(err => logger.warn(`[Aparência] leitura falhou: ${err?.message ?? err}`))
  }
  return { header: current.sidebar, onHeader: on(current.sidebar), accent: current.accent, button: current.primary, onButton: on(current.primary) }
}
