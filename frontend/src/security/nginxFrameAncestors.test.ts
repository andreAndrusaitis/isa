import { describe, expect, it } from 'vitest'
import conf from '../../nginx.conf?raw'

// O nginx de produção precisa dizer quem pode embutir o portal.
// Sem frame-ancestors qualquer site abre o ISA num iframe (clickjacking);
// com uma lista curta demais a aba do Teams para de funcionar.

function locationBlock(path: string): string {
  const start = conf.indexOf(`location ${path} {`)
  expect(start, `location ${path} existe`).toBeGreaterThanOrEqual(0)
  // Conta as chaves: um if dentro da location não pode cortar o bloco no meio.
  let depth = 0
  for (let i = conf.indexOf('{', start); i < conf.length; i++) {
    if (conf[i] === '{') depth++
    else if (conf[i] === '}' && --depth === 0) return conf.slice(start, i + 1)
  }
  return conf.slice(start)
}

function frameAncestors(block: string): string[] {
  const match = block.match(/add_header\s+Content-Security-Policy\s+"([^"]*)"\s+always;/)
  expect(match, 'CSP com always (vale também em respostas de erro)').not.toBeNull()
  const directive = match![1].split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-ancestors'))
  expect(directive, 'diretiva frame-ancestors').toBeDefined()
  return directive!.split(/\s+/).slice(1)
}

describe('nginx: proteção contra clickjacking', () => {
  const sources = frameAncestors(locationBlock('/'))

  it('a location que serve o index.html declara frame-ancestors', () => {
    expect(sources).toContain("'self'")
  })

  it('libera os hosts da Microsoft que abrem a aba pessoal', () => {
    for (const host of ['teams.microsoft.com', '*.teams.microsoft.com', '*.cloud.microsoft', '*.office.com', 'outlook.office.com']) {
      expect(sources).toContain(host)
    }
  })

  it('não libera qualquer origem', () => {
    for (const wildcard of ['*', 'https:', 'http:', 'data:']) {
      expect(sources).not.toContain(wildcard)
    }
  })

  it('não usa X-Frame-Options, que bloquearia o Teams', () => {
    expect(conf).not.toMatch(/add_header\s+X-Frame-Options/i)
  })
})
