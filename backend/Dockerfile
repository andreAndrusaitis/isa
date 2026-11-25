# ── Stage: development ────────────────────────────────────────────────────────
FROM node:22-alpine AS development

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3001
CMD ["npm", "run", "dev"]


# ── Stage: builder ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate
RUN npm run build


# ── Stage: production ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# openssl necessário para o Prisma binary engine
RUN apk add --no-cache openssl

# Apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Prisma client gerado (binário Linux pelo builder)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Build compilado
COPY --from=builder /app/dist ./dist

# Schema Prisma (necessário para migrate deploy)
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

RUN mkdir -p logs && chown node:node logs
USER node

# As migrations rodam à parte (npx prisma migrate deploy), antes de subir a nova versão.
CMD ["node", "dist/src/server.js"]
