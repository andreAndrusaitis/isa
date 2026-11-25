import { beforeEach, describe, expect, it } from 'vitest'
import tokens from '../styles/tokens.css?raw'
import { DEFAULT_SEEDS, applySeeds, contrast, deriveTheme, parseSeeds, themeCss, type BrandSeeds } from './brandTheme'

const SEEDS: Record<string, BrandSeeds> = {
  gelo: DEFAULT_SEEDS,
  'amarelo claro': { primary: '#ffe14d', accent: '#fff3a0', sidebar: '#fffbe6' },
  preto: { primary: '#000000', accent: '#000000', sidebar: '#000000' },
  branco: { primary: '#ffffff', accent: '#ffffff', sidebar: '#ffffff' },
  'cinza médio': { primary: '#808080', accent: '#777777', sidebar: '#7f7f7f' },
  vinho: { primary: '#8b1538', accent: '#f2a65a', sidebar: '#2a0a14' },
}

describe('deriveTheme', () => {
  it.each(Object.entries(SEEDS))('mantém o contraste AA com a cor %s', (_name, seeds) => {
    const { light, dark } = deriveTheme(seeds)
    for (const t of [light, dark]) {
      for (const text of ['--text-1', '--text-2', '--text-3', '--accent-fg']) {
        expect(contrast(t[text], t['--bg-card']), `${text} no cartão`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(t['--on-accent'], t['--accent']), 'texto do botão').toBeGreaterThanOrEqual(4.5)
      for (const text of ['--sidebar-text', '--sidebar-muted', '--sidebar-accent']) {
        expect(contrast(t[text], t['--bg-sidebar']), `${text} no menu`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(t['--login-title'], t['--login-bg'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['--login-text'], t['--login-bg'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('tokens.css traz exatamente a paleta padrão', () => {
    const css = tokens.replace(/\r\n/g, '\n')
    const [lightCss, rest] = css.split('[data-theme="dark"] {')
    const { light, dark } = deriveTheme(DEFAULT_SEEDS)
    for (const [k, v] of Object.entries(light)) expect(lightCss).toContain(`  ${k}: ${v};`)
    const darkCss = rest.split('/* Alto contraste')[0]
    for (const [k, v] of Object.entries(dark)) expect(darkCss).toContain(`  ${k}: ${v};`)
  })
})

describe('aplicação', () => {
  beforeEach(() => document.getElementById('brand-theme')?.remove())

  it('injeta um <style> e o remove ao voltar ao padrão', () => {
    applySeeds(SEEDS.vinho)
    expect(document.getElementById('brand-theme')?.textContent).toContain('--accent:#8b1538')
    applySeeds(DEFAULT_SEEDS)
    expect(document.getElementById('brand-theme')).toBeNull()
  })

  it('não sobrepõe o alto contraste', () => {
    expect(themeCss(SEEDS.vinho)).toContain('[data-theme="dark"]:not([data-contrast="more"])')
  })

  it('recusa valores que não são cor (nada de CSS injetado)', () => {
    expect(parseSeeds({ primary: 'red;}body{display:none', accent: '#ffffff', sidebar: '#000000' })).toBeNull()
    expect(parseSeeds({ primary: '#FFFFFF', accent: '#ffffff', sidebar: '#000000' })?.primary).toBe('#ffffff')
    expect(parseSeeds(null)).toBeNull()
  })
})
