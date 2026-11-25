// Entry point de produção: registra qualquer falha e encerra se a aplicação não subir
const PORT = Number(process.env.PORT) || 3001

process.on('uncaughtException', (err) => {
  console.error('[ISA] UNCAUGHT EXCEPTION:', err.message, err.stack)
})

process.on('unhandledRejection', (reason) => {
  console.error('[ISA] UNHANDLED REJECTION:', reason)
})

try {
  require('./app')
} catch (err: any) {
  console.error('[ISA] STARTUP FAILED:', err.message)

  // Sem servidor de diagnóstico: a mensagem de erro não pode ficar pública.
  process.exit(1)
}
