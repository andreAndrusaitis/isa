/**
 * LGPD: nada sai para o modelo sem passar por aqui (vale para todos os agentes).
 * Regex cobre identificadores estruturados (CPF, CNPJ, RG, e-mail, telefone,
 * CEP). Nomes próprios e endereços livres passam — somar o PII do Azure AI
 * Language se o jurídico exigir.
 */
const MAX_CHARS = 4000

// Ordem importa: CNPJ (14 dígitos) antes de CPF (11), celular antes de CPF,
// RG depois de CNPJ (o prefixo 12.345.678/ casaria), CEP antes de telefone.
const RULES: Array<[RegExp, string]> = [
  // Quantificadores limitados (RFC: parte local ≤64, rótulo ≤63): com `+` livre, texto
  // longo sem @ (log, base64) fazia backtracking quadrático e travava o event loop.
  [/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/g, '[EMAIL]'],
  // Separador livre porque quem digita à mão usa espaço e hífen; ponto no último grupo
  // de CPF ficaria igual a um IP (192.168.100.10), por isso ali só espaço ou hífen.
  [/\b\d{2}[. -]?\d{3}[. -]?\d{3}[/ -]?\d{4}[ -]?\d{2}\b/g, '[CNPJ]'],
  // 11 dígitos são ambíguos — DDD válido (11–99) + 9 vira telefone,
  // então um CPF sem pontuação cujo 3º dígito é 9 (ex. 11987654321) sai como
  // [TELEFONE]. Os dois são mascarados; só o rótulo pode errar. CPF formatado
  // (123.456.789-09) nunca casa aqui por causa dos pontos.
  [/(?<!\d)(?:\+?55\s?)?(?:\(\s?(?:1[1-9]|[2-9]\d)\s?\)|(?:1[1-9]|[2-9]\d))\s?9\d{4}[-\s]?\d{4}(?!\d)/g, '[TELEFONE]'],
  [/\b\d{3}[. -]?\d{3}[. -]?\d{3}[ -]?\d{2}\b/g, '[CPF]'],
  // RG: 12.345.678-9 / 1.234.567 / 12345678-9 / dígito X. Exige ponto ou hífen
  // (8–9 dígitos soltos são comuns demais); não pega IP nem valor (R$ 1.234.567,89).
  [/(?<![\d.])(?:\d{1,2}\.\d{3}\.\d{3}(?:-[\dXx])?|\d{7,8}-[\dXx])(?![.,]?\d|\w)/g, '[RG]'],
  [/\b\d{5}-\d{3}\b/g, '[CEP]'],
  [/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]\d{4}\b/g, '[TELEFONE]'],
  // "senha: X", "senha temporária: X" e, em frase, "minha senha antiga é X".
  [/(senha|password|pwd)(?:\s+[\wÀ-ÿ]+){0,2}?\s*(?:[:=]|\s(?:é|eh|is)\s)\s*\S+/gi, '$1: [SENHA]'],
]

// Despedida após quebra de linha ou pontuação, e avisos legais de e-mail.
const SIGNATURE_MARKERS = [
  /(?<=^|[\n.!?])\s*(?:atenciosamente|att\.?|cordialmente|abraços)\b/i,
  /as informações contidas nesta mensagem/i,
  /this e-?mail (?:and any attachments|is confidential)/i,
]

export function maskPII(text: string): string {
  return RULES.reduce((t, [re, label]) => t.replace(re, label), text)
}

export function stripSignature(text: string): string {
  let cut = text.length
  for (const re of SIGNATURE_MARKERS) {
    const m = re.exec(text)
    if (m && m.index > 0 && m.index < cut) cut = m.index
  }
  return text.slice(0, cut).trim()
}

export function sanitizeForModel(text: string | null | undefined): string {
  // Corta antes de mascarar (com folga: a máscara encurta o texto) — só o começo vai ao modelo.
  return maskPII(stripSignature(text ?? '').slice(0, MAX_CHARS * 2)).slice(0, MAX_CHARS)
}
