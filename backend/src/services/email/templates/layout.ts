import { emailColors } from '../../appearance'

// E-mail não tem variável CSS: tinta, texto e fio fixos; só o botão segue a cor da organização.
const INK = '#0b2332'
const TEXT = '#4f616b'
const LINE = '#d4dde3'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Parágrafo. `html` já escapado. */
export const p = (html: string) => `<p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: ${INK};">${html}</p>`

/** Texto de apoio, menor. `html` já escapado. */
export const small = (html: string) => `<p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.5; color: ${TEXT};">${html}</p>`

export const muted = (html: string) => `<span style="color: ${TEXT};">${html}</span>`

/** Título de seção, com fio escuro em cima. */
export const section = (title: string) => `<p style="margin: 28px 0 10px 0; padding-top: 14px; border-top: 1px solid ${INK}; font-size: 16px; font-weight: 500; color: ${INK};">${escapeHtml(title)}</p>`

/** Texto de quem escreveu (resposta, descrição): mantém as quebras de linha. */
export const quote = (text: string) => `<div style="padding: 0 0 12px 0; margin: 0 0 12px 0; border-bottom: 1px solid ${LINE}; font-size: 14.5px; line-height: 1.6; color: ${INK}; white-space: pre-wrap;">${escapeHtml(text)}</div>`

/** Tabela rótulo/valor. `html` já escapado; linha nula não aparece. */
export function rows(items: ([string, string] | null | false)[]) {
  return `<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid ${INK}; margin: 8px 0 20px 0;">${items.filter((i): i is [string, string] => !!i).map(([label, html]) => `
                    <tr>
                      <td width="150" style="padding: 11px 16px 11px 0; border-bottom: 1px solid ${LINE}; font-size: 14px; color: ${TEXT}; vertical-align: top;">${escapeHtml(label)}</td>
                      <td style="padding: 11px 0; border-bottom: 1px solid ${LINE}; font-size: 14px; line-height: 1.5; color: ${INK}; vertical-align: top;">${html}</td>
                    </tr>`).join('')}
                  </table>`
}

export function button(href: string, label: string) {
  const { button: bg, onButton } = emailColors()
  return `<p style="margin: 26px 0 8px 0;"><a href="${href}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: ${bg}; color: ${onButton}; font-size: 15px; font-weight: 500; text-decoration: none;">${label}</a></p>`
}

/** Folha branca: marca, título, conteúdo e rodapé separados por fios. */
export function emailPage({ subject, heading, body, footer }: { subject: string; heading: string; body: string; footer: string }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(subject)}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: ${FONT};">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff;">
        <tr>
          <td align="center" style="padding: 28px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; text-align: left;">
              <tr>
                <td style="padding: 0 0 12px 0; border-bottom: 1px solid ${INK}; font-size: 18px; font-weight: 600; color: ${INK};">ISA</td>
              </tr>
              <tr>
                <td style="padding: 28px 0 24px 0;">
                  <h1 style="margin: 0 0 18px 0; font-size: 24px; line-height: 1.25; font-weight: 500; color: ${INK};">${escapeHtml(heading)}</h1>
                  ${body}
                </td>
              </tr>
              <tr>
                <td style="padding: 14px 0 0 0; border-top: 1px solid ${LINE}; font-size: 12px; line-height: 1.5; color: ${TEXT};">
                  ${footer}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}
