/**
 * Sistema de Logs Centralizado (Winston)
 * 
 * Este módulo configura o logger da aplicação, permitindo registrar mensagens
 * no console e em arquivos, com diferentes níveis de severidade e formatação.
 */

import winston from 'winston'
import { env } from '../config/env'

const { combine, timestamp, printf, colorize, align } = winston.format

/**
 * Define o formato customizado da linha de log.
 * Exemplo: 2026-04-30 18:45:00 [info]: Servidor rodando na porta 3001
 */
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message} `
  // Se houver metadados adicionais (objetos, IDs), imprime como JSON no final da linha.
  if (Object.keys(metadata).length > 0) {
    msg += JSON.stringify(metadata)
  }
  return msg
})

/**
 * Instância principal do logger.
 * Configura o nível de log baseado no ambiente (debug em dev, info em prod).
 */
export const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    align(),
    logFormat
  ),
  transports: [
    // Saída padrão para o console (terminal).
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }), // Adiciona cores para facilitar a leitura no terminal.
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        align(),
        logFormat
      ),
    }),
  ],
})

/**
 * Persistência de Logs em Arquivo
 * 
 * Só ativado se não estivermos em ambiente de testes.
 * Salva logs em arquivos para auditoria e depuração de problemas em produção.
 */
if (env.NODE_ENV !== 'test') {
  // Apenas erros críticos.
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }))
  
  // Todos os logs gerados.
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }))
}
