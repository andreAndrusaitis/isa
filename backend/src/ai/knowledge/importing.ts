/**
 * Leitura do arquivo importado. A extensão só diz o que se espera: quem decide é
 * o conteúdo. O MIME do data URI vem do navegador e não entra na conta.
 */
import mammoth from 'mammoth'
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf'
import { AppError } from '../../middlewares/errorHandler'
import { MAX_BYTES } from '../../services/uploads'
import { MAX_CONTENT_CHARS } from './schemas'

type Kind = 'pdf' | 'docx' | 'text'

const KINDS: Record<string, Kind> = { pdf: 'pdf', docx: 'docx', txt: 'text', md: 'text', markdown: 'text' }
const MAX_TITLE_CHARS = 200
// Bem acima de qualquer DOCX real de 10 MB; barra zip bomb antes de descompactar.
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024

const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_END_OF_DIRECTORY = 0x06054b50
const ZIP_END_MIN_BYTES = 22

const mismatch = (what: string) => new AppError(415, `O conteúdo do arquivo não é ${what}, apesar da extensão.`, 'FILE_CONTENT_MISMATCH')
const emptyFile = () => new AppError(400, 'O arquivo está vazio: não há texto para importar.', 'EMPTY_FILE')
const tooLarge = () => new AppError(413, 'Arquivo grande demais: o limite é de 10 MB.', 'FILE_TOO_LARGE')

/** Nome sem caminho (o navegador pode mandar C:\fakepath\...), título e tipo esperado. */
function parseFileName(fileName: string) {
  const name = fileName.split(/[\\/]/).pop()!.trim()
  const dot = name.lastIndexOf('.')
  const kind = dot > 0 ? KINDS[name.slice(dot + 1).toLowerCase()] : undefined
  if (!kind) throw new AppError(415, 'Tipo de arquivo não permitido: envie PDF, DOCX, TXT ou Markdown.', 'UNSUPPORTED_FILE_TYPE')
  return { name, title: name.slice(0, dot).trim().slice(0, MAX_TITLE_CHARS), kind }
}

function decodeDataUri(dataUri: string): Buffer {
  const comma = dataUri.indexOf(',')
  if (!dataUri.startsWith('data:') || !dataUri.slice(0, comma).endsWith(';base64')) {
    throw new AppError(400, 'Formato de arquivo inválido: envie um data URI em base64.', 'INVALID_FILE')
  }
  return Buffer.from(dataUri.slice(comma + 1), 'base64')
}

/** Entradas do diretório central, sem descompactar. Null quando não é um ZIP íntegro. */
function zipEntries(buffer: Buffer): { name: string; size: number }[] | null {
  try {
    if (buffer.readUInt32LE(0) !== ZIP_LOCAL_HEADER) return null
    let end = buffer.length - ZIP_END_MIN_BYTES
    while (end >= 0 && buffer.readUInt32LE(end) !== ZIP_END_OF_DIRECTORY) end--
    if (end < 0) return null

    const entries = []
    let at = buffer.readUInt32LE(end + 16)
    for (let i = 0, total = buffer.readUInt16LE(end + 10); i < total; i++) {
      if (buffer.readUInt32LE(at) !== ZIP_CENTRAL_HEADER) return null
      const nameLength = buffer.readUInt16LE(at + 28)
      entries.push({ name: buffer.toString('utf8', at + 46, at + 46 + nameLength), size: buffer.readUInt32LE(at + 24) })
      at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
    }
    return entries
  } catch {
    return null // leitura fora do buffer: diretório truncado
  }
}

async function readPdf(buffer: Buffer): Promise<string> {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw mismatch('um PDF')
  let text: string
  try {
    const document = await getDocumentProxy(new Uint8Array(buffer))
    try {
      text = (await extractPdfText(document, { mergePages: true })).text
    } finally {
      await document.destroy()
    }
  } catch {
    throw new AppError(422, 'Não foi possível ler o PDF: o arquivo está corrompido ou protegido por senha.', 'UNREADABLE_FILE')
  }
  if (!text.trim()) {
    throw new AppError(422, 'O PDF não tem texto para extrair: parece conter só imagem. Envie uma versão com texto selecionável.', 'PDF_WITHOUT_TEXT')
  }
  return text
}

async function readDocx(buffer: Buffer): Promise<string> {
  const entries = zipEntries(buffer)
  if (!entries?.some(e => e.name === 'word/document.xml')) throw mismatch('um documento Word (DOCX)')
  if (entries.reduce((sum, e) => sum + e.size, 0) > MAX_UNZIPPED_BYTES) throw tooLarge()
  try {
    return (await mammoth.extractRawText({ buffer })).value
  } catch {
    throw new AppError(422, 'Não foi possível ler o documento Word: o arquivo está corrompido.', 'UNREADABLE_FILE')
  }
}

function readText(buffer: Buffer): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw mismatch('texto em UTF-8')
  }
  if (text.includes('\u0000')) throw mismatch('texto em UTF-8')
  return text
}

const READERS: Record<Kind, (buffer: Buffer) => string | Promise<string>> = { pdf: readPdf, docx: readDocx, text: readText }

export async function readUploadedFile(fileName: string, dataUri: string) {
  const { name, title, kind } = parseFileName(fileName)
  const buffer = decodeDataUri(dataUri)
  if (!buffer.length) throw emptyFile()
  if (buffer.length > MAX_BYTES) throw tooLarge()

  // PDF e DOCX podem trazer \u0000 no texto, que o Postgres recusa em TEXT.
  const content = (await READERS[kind](buffer)).replaceAll('\u0000', '').trim()
  if (!content) throw emptyFile()
  if (content.length > MAX_CONTENT_CHARS) {
    throw new AppError(413, 'O texto do arquivo passa do limite de um artigo: divida o documento em partes menores.', 'CONTENT_TOO_LONG')
  }
  return { name, title, content }
}
