import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A suíte nunca chama a IA real (o .env pode ter modo apply e chaves reais)
    // nem envia/lê e-mail de verdade (o .env de dev pode ter o ACS e o certificado da
    // caixa de atendimento): vazio desliga, e o dotenv não sobrescreve o que já está definido.
    env: {
      AI_TRIAGE_MODE: 'off', AI_INTAKE_MODE: 'off', AI_GUIDANCE_MODE: 'off',
      AZURE_COMMUNICATION_CONNECTION_STRING: '', MAIL_GRAPH_CERT: '', MAIL_GRAPH_PRIVATE_KEY: '', MAIL_INBOUND_ENABLED: 'false',
      TEAMS_SSO_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
    },
    coverage: {
      reporter: ['text', 'cobertura', 'html'],
      // Piso de cobertura: só impede regressão. Subir quando a cobertura subir.
      thresholds: { statements: 55, branches: 76, functions: 66, lines: 55 },
    },
  },
})
