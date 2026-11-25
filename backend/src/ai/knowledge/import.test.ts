import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import JSZip from 'jszip'
import request from 'supertest'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { errorHandler } from '../../middlewares/errorHandler'
import knowledgeRoutes from './routes'

const SUFFIX = `kbimport-${Date.now()}`
const URL_IMPORT = '/api/knowledge/import'
let orgId: string, adminId: string, agentId: string
const articles: string[] = []

// Mesmo limite de corpo do app.ts: 10 MB em base64 cabem em 15 MB de JSON.
const app = express()
app.use(express.json({ limit: '15mb' }))
app.use('/api/knowledge', knowledgeRoutes)
app.use(errorHandler)

const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

const dataUri = (bytes: Buffer, mime = 'application/octet-stream') => `data:${mime};base64,${bytes.toString('base64')}`
const send = (fileName: string, bytes: Buffer, mime?: string) =>
  request(app).post(URL_IMPORT).set('Authorization', bearer(adminId, 'admin')).send({ fileName, dataUri: dataUri(bytes, mime) })

async function imported(fileName: string, bytes: Buffer, mime?: string) {
  const r = await send(fileName, bytes, mime)
  expect(r.status).toBe(201)
  articles.push(r.body.data.id)
  return r.body.data
}

async function refused(fileName: string, bytes: Buffer, status: number, code: string, mime?: string) {
  const before = await prisma.knowledgeArticle.count({ where: { created_by_id: adminId } })
  const r = await send(fileName, bytes, mime)
  expect(r.body.code).toBe(code)
  expect(r.status).toBe(status)
  expect(typeof r.body.error).toBe('string')
  expect(r.body.error.length).toBeGreaterThan(10)
  expect(await prisma.knowledgeArticle.count({ where: { created_by_id: adminId } })).toBe(before)
}

/** PDF mínimo e válido, com xref certo, desenhando o conteúdo pedido. */
function pdf(stream: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  adminId = (await prisma.user.create({ data: { name: `Adm ${SUFFIX}`, email: `adm-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Ana ${SUFFIX}`, email: `ana-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
})

afterAll(async () => {
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articles } } })
  await prisma.auditLog.deleteMany({ where: { user_id: adminId } })
  await prisma.user.deleteMany({ where: { id: { in: [adminId, agentId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('importar arquivo', () => {
  it('PDF com texto vira rascunho', async () => {
    const a = await imported('Manual da VPN.pdf', pdf('BT /F1 12 Tf 20 200 Td (Reinicie a VPN) Tj ET'), 'application/pdf')
    expect(a).toMatchObject({ title: 'Manual da VPN', source_filename: 'Manual da VPN.pdf', status: 'draft', published_at: null, created_by_id: adminId })
    expect(a.content).toContain('Reinicie a VPN')
    expect(await prisma.knowledgeChunk.count({ where: { article_id: a.id } })).toBe(0)
  })

  it('DOCX vira rascunho com os parágrafos', async () => {
    const a = await imported('procedimento.docx', await docx(['Abra o portal.', 'Clique em Sair.']))
    expect(a).toMatchObject({ title: 'procedimento', source_filename: 'procedimento.docx', status: 'draft' })
    expect(a.content).toContain('Abra o portal.')
    expect(a.content).toContain('Clique em Sair.')
  })

  it('TXT em UTF-8 mantém os acentos e descarta o BOM', async () => {
    const a = await imported('notas.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Instalação do cliente.\n')]), 'text/plain')
    expect(a).toMatchObject({ title: 'notas', content: 'Instalação do cliente.', status: 'draft' })
  })

  it('Markdown é aceito mesmo com MIME genérico', async () => {
    const a = await imported('guia.rapido.md', Buffer.from('# Título\n\n- passo 1\n'))
    expect(a).toMatchObject({ title: 'guia.rapido', source_filename: 'guia.rapido.md', content: '# Título\n\n- passo 1' })
  })

  it('caminho no nome do arquivo não vai para o banco', async () => {
    const a = await imported('C:\\fakepath\\..\\segredo.txt', Buffer.from('conteúdo'))
    expect(a).toMatchObject({ title: 'segredo', source_filename: 'segredo.txt' })
  })

  it('audita a importação', async () => {
    const a = await imported('auditado.txt', Buffer.from('conteúdo'))
    const log = await prisma.auditLog.findFirst({ where: { user_id: adminId, action: 'KNOWLEDGE_ARTICLE_IMPORT' }, orderBy: { created_at: 'desc' } })
    expect(log?.details).toMatchObject({ articleId: a.id })
  })

  it('extensão .pdf com conteúdo falso é recusada, mesmo com MIME de PDF', async () => {
    await refused('falso.pdf', Buffer.from('isto não é um pdf'), 415, 'FILE_CONTENT_MISMATCH', 'application/pdf')
  })

  it('PDF só com o cabeçalho, corrompido, é recusado', async () => {
    await refused('quebrado.pdf', Buffer.from('%PDF-1.4\nlixo sem estrutura'), 422, 'UNREADABLE_FILE')
  })

  it('DOCX falso é recusado: texto, ZIP sem word/document.xml e ZIP quebrado', async () => {
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    await refused('falso.docx', Buffer.from('texto puro'), 415, 'FILE_CONTENT_MISMATCH', mime)
    const zip = await new JSZip().file('outro.txt', 'x').generateAsync({ type: 'nodebuffer' })
    await refused('zip.docx', zip, 415, 'FILE_CONTENT_MISMATCH', mime)
    await refused('cortado.docx', zip.subarray(0, 20), 415, 'FILE_CONTENT_MISMATCH', mime)
  })

  it('DOCX que descompacta para além do limite é recusado sem abrir', async () => {
    const bytes = await docx(['x'])
    const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt32LE(0xfffffff0, directory + 24)
    await refused('bomba.docx', bytes, 413, 'FILE_TOO_LARGE')
  })

  it('TXT binário é recusado: UTF-8 inválido e byte nulo', async () => {
    await refused('latin1.txt', Buffer.from([0x61, 0xe7, 0xe3, 0x6f]), 415, 'FILE_CONTENT_MISMATCH')
    await refused('nulo.md', Buffer.from([0x61, 0x00, 0x62]), 415, 'FILE_CONTENT_MISMATCH')
    await refused('imagem.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 415, 'FILE_CONTENT_MISMATCH')
  })

  it('PDF sem texto explica que parece só imagem', async () => {
    await refused('digitalizado.pdf', pdf('0 0 100 100 re f'), 422, 'PDF_WITHOUT_TEXT')
    const r = await send('digitalizado.pdf', pdf('0 0 100 100 re f'))
    expect(r.body.error).toMatch(/imagem/)
  })

  it('arquivo vazio é recusado: sem bytes, só espaços ou DOCX sem texto', async () => {
    await refused('vazio.txt', Buffer.alloc(0), 400, 'EMPTY_FILE')
    await refused('branco.md', Buffer.from(' \n\t '), 400, 'EMPTY_FILE')
    await refused('vazio.docx', await docx([]), 400, 'EMPTY_FILE')
  })

  it('arquivo acima de 10 MB é recusado', async () => {
    await refused('grande.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61), 413, 'FILE_TOO_LARGE')
  })

  it('texto extraído acima do teto do artigo é recusado', async () => {
    await refused('longo.txt', Buffer.alloc(500_001, 0x61), 413, 'CONTENT_TOO_LONG')
  })

  it('tipo proibido é recusado, mesmo com conteúdo de texto', async () => {
    await refused('virus.exe', Buffer.from('MZ'), 415, 'UNSUPPORTED_FILE_TYPE')
    await refused('pagina.html', Buffer.from('<script>alert(1)</script>'), 415, 'UNSUPPORTED_FILE_TYPE', 'text/plain')
    await refused('sem-extensao', Buffer.from('texto'), 415, 'UNSUPPORTED_FILE_TYPE')
    await refused('.pdf', pdf('BT ET'), 415, 'UNSUPPORTED_FILE_TYPE')
  })

  it('corpo inválido devolve error, code e details', async () => {
    const auth = bearer(adminId, 'admin')
    for (const body of [{}, { fileName: 'a.txt' }, { fileName: '', dataUri: 'data:text/plain;base64,YQ==' }, { fileName: 'a\u0000.txt', dataUri: 'data:text/plain;base64,YQ==' }]) {
      const r = await request(app).post(URL_IMPORT).set('Authorization', auth).send(body)
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('VALIDATION_ERROR')
      expect(r.body.details).toBeDefined()
    }
    const notUri = await request(app).post(URL_IMPORT).set('Authorization', auth).send({ fileName: 'a.txt', dataUri: 'texto solto' })
    expect(notUri.status).toBe(400)
    expect(notUri.body.code).toBe('INVALID_FILE')
  })

  it('só admin importa', async () => {
    const body = { fileName: 'a.txt', dataUri: dataUri(Buffer.from('x')) }
    expect((await request(app).post(URL_IMPORT).set('Authorization', bearer(agentId, 'agent')).send(body)).status).toBe(403)
    expect((await request(app).post(URL_IMPORT).send(body)).status).toBe(401)
  })
})
