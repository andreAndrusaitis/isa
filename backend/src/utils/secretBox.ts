/**
 * Cifra de segredos guardados no banco (AES-256-GCM). `context` entra como dado
 * autenticado: um texto cifrado copiado para outro campo não abre.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { env } from '../config/env'

const VERSION = 'v1'

function key(): Buffer {
  const material = env.SETTINGS_ENCRYPTION_KEY || env.JWT_SECRET
  return Buffer.from(hkdfSync('sha256', material, 'isa', 'system-settings', 32))
}

export function seal(plain: string, context: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

/** Devolve null quando não abre (chave trocada ou valor adulterado). */
export function open(sealed: string, context: string): string | null {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || body === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
