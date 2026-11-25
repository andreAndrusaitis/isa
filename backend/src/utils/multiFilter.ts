// Filtro de listagem: 'all'/vazio = sem filtro; CSV da multisseleção ("a,b") vira `in`.
// undefined é ignorado pelo Prisma.
export function multi(v: unknown): string | { in: string[] } | undefined {
  if (typeof v !== 'string' || !v || v === 'all') return undefined
  const list = v.split(',').filter(Boolean)
  return list.length > 1 ? { in: list } : list[0]
}
