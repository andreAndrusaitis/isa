import { PrismaClient } from '@prisma/client'
import { env } from './env'

const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  // O padrão de 2 s para conseguir uma conexão falha em rajadas curtas.
  transactionOptions: { maxWait: 5_000 },
})

export default prisma
