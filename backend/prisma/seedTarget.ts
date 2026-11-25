import { config as loadDotenv } from 'dotenv'

// "npm run db:seed" não passa pelo CLI do Prisma: sem isto a guarda não veria o banco
// do .env. Quem já define DATABASE_URL (e2e, pipeline) não recebe nada do .env real.
if (!process.env.DATABASE_URL) loadDotenv()

/** Banco alvo do seed. Importe antes do @prisma/client, que carrega o .env do projeto sozinho. */
export const TARGET_URL = process.env.DATABASE_URL
