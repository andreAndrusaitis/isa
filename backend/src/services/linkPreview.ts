/**
 * Prévia de link (Open Graph) para leitores de prévia: Teams, Slack, WhatsApp…
 *
 * O nginx do front encaminha só os user-agents de prévia em /projetos/... para cá,
 * com a URI original em X-Original-URI e o host público em X-Forwarded-Host.
 * O leitor não faz login: quem tem o link vê código, título e status da task.
 * Nada além disso (descrição, comentários, anexos, e-mails, chamados) sai daqui.
 */
import prisma from '../config/prisma'
import { env } from '../config/env'
import { escapeHtml as e } from './projectExport/html'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOST = /^[a-z0-9.-]{1,253}$/

export const SITE_NAME = 'ISA'
export const GENERIC_TITLE = 'ISA'
export const GENERIC_DESCRIPTION = 'Service desk corporativo: chamados, SLA e projetos em um só lugar.'
const IMAGE_PATH = '/og-image.png'

export interface PreviewMeta {
  title: string
  description: string
}

/** Host do front configurado em PORTAL_URL: é o padrão quando o recebido não é permitido. */
export function defaultHost(): string {
  try { return new URL(env.PORTAL_URL).host.toLowerCase() } catch { return 'localhost:5173' }
}

/** Lista permitida: entradas com ponto na frente valem como sufixo (".example.com"). */
export function allowedHost(raw: string | undefined): string {
  const fallback = defaultHost()
  const host = (raw ?? '').split(',')[0].trim().toLowerCase()
  if (!host || !HOST.test(host)) return fallback
  if (host === fallback) return host
  const rules = (env.LINK_PREVIEW_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const ok = rules.some(r => (r.startsWith('.') ? host.endsWith(r) || host === r.slice(1) : host === r))
  return ok ? host : fallback
}

interface ParsedLink {
  /** Caminho + query normalizados (só /projetos/...), para og:url e o refresh. */
  path: string
  pathProjectId: string | null
  taskId: string | null
  taskProjectId: string | null
}

/** Lê a URI original. Fora de /projetos/ (ou malformada) vira a raiz do app. */
export function parseOriginalUri(raw: string | undefined): ParsedLink {
  const root: ParsedLink = { path: '/', pathProjectId: null, taskId: null, taskProjectId: null }
  if (!raw || !raw.startsWith('/projetos/') || raw.length > 2048) return root
  let url: URL
  try { url = new URL(raw, 'https://preview.invalid') } catch { return root }
  if (url.host !== 'preview.invalid' || !url.pathname.startsWith('/projetos/')) return root
  const seg = url.pathname.split('/')[2] ?? ''
  const uuidOrNull = (v: string | null) => (v && UUID.test(v) ? v.toLowerCase() : null)
  return {
    path: url.pathname + url.search,
    pathProjectId: uuidOrNull(seg),
    taskId: uuidOrNull(url.searchParams.get('task')),
    taskProjectId: uuidOrNull(url.searchParams.get('taskProject')),
  }
}

const GENERIC: PreviewMeta = { title: GENERIC_TITLE, description: GENERIC_DESCRIPTION }
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/**
 * Título/descrição da prévia. Id inválido, inexistente, arquivado ou de outro projeto
 * caem no genérico, sem dizer qual foi o caso.
 */
export async function resolvePreview(link: ParsedLink): Promise<PreviewMeta> {
  // Projeto que a task precisa ter: todos os informados (caminho e taskProject) têm de bater.
  const expected = [link.pathProjectId, link.taskProjectId].filter((v): v is string => !!v)
  if (link.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: link.taskId },
      select: {
        key: true, seq: true, title: true, archived_at: true, project_id: true,
        project: { select: { name: true, archived_at: true } },
        status: { select: { name: true } },
      },
    })
    if (!task || task.archived_at || task.project.archived_at) return GENERIC
    if (expected.some(p => p !== task.project_id)) return GENERIC
    const parts = [task.project.name, task.status.name].filter(Boolean)
    return {
      title: cut(`${task.key ?? `#${task.seq}`} · ${task.title}`, 200),
      description: cut(parts.join(' · '), 300),
    }
  }
  if (link.pathProjectId) {
    const project = await prisma.project.findUnique({ where: { id: link.pathProjectId }, select: { name: true, archived_at: true } })
    if (!project || project.archived_at) return GENERIC
    return { title: cut(project.name, 200), description: 'Projeto no ISA' }
  }
  return GENERIC
}

/** HTML mínimo com as tags OG/Twitter; quem não for leitor de prévia segue para o app. */
export function renderPreviewHtml(meta: PreviewMeta, host: string, path: string): string {
  const url = `https://${host}${path}`
  const image = `https://${host}${IMAGE_PATH}`
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${e(meta.title)}</title>
<meta name="description" content="${e(meta.description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0E2247">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:url" content="${e(url)}">
<meta property="og:title" content="${e(meta.title)}">
<meta property="og:description" content="${e(meta.description)}">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="ISA">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(meta.title)}">
<meta name="twitter:description" content="${e(meta.description)}">
<meta name="twitter:image" content="${e(image)}">
<meta http-equiv="refresh" content="0; url=${e(url)}">
</head>
<body><a href="${e(url)}">Abrir no ISA</a></body>
</html>
`
}
