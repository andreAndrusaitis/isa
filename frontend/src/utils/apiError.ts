/**
 * Extrai a mensagem de erro amigável de uma exceção de chamada à API.
 *
 * O backend responde erros no formato `{ error: string, code: string }`
 * (ver `backend/src/middlewares/errorHandler.ts`). Este helper recupera essa
 * mensagem específica — por exemplo "Tipo de arquivo não permitido" — em vez de
 * cair sempre numa mensagem genérica.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as any)?.response?.data
  if (data && typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }
  return fallback
}
