import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    hmr: {
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001', // ambiente isolado: VITE_PROXY_TARGET=http://localhost:3002
        changeOrigin: true,
      },
      '/auth': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001', // ambiente isolado: VITE_PROXY_TARGET=http://localhost:3002
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: { include: [/tokens.css/] }, // brandTheme.test.ts confere o conteúdo
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      reporter: ['text', 'cobertura', 'html'],
      // Piso de cobertura: só impede regressão. Subir quando a cobertura subir.
      thresholds: { statements: 42, branches: 72, functions: 36, lines: 42 },
    },
  },
})
