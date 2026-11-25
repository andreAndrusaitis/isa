# ── Stage: development ────────────────────────────────────────────────────────
FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]


# ── Stage: builder ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Endereço da API visto pelo navegador. /api passa pelo proxy do nginx.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build


# ── Stage: production (Nginx serving static files) ────────────────────────────
FROM nginxinc/nginx-unprivileged:1.27-alpine AS production

# Config customizada
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=backend:3001
ENV NGINX_ENVSUBST_FILTER=BACKEND_HOST

# Build estático
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
