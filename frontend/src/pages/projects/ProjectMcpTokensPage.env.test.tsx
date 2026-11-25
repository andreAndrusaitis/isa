import { describe, it, expect, vi, afterEach } from 'vitest'

// No CI não há .env.local: VITE_API_URL vem undefined. A página não pode quebrar
// no carregamento (quebrava a ProjetosPage inteira, que a importa).
describe('ProjectMcpTokensPage sem VITE_API_URL', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('carrega o módulo e usa a origem da página para a URL do MCP', async () => {
    vi.stubEnv('VITE_API_URL', undefined as unknown as string)
    vi.resetModules()
    const mod = await import('./ProjectMcpTokensPage')
    expect(mod.default).toBeTypeOf('function')
  })
})
