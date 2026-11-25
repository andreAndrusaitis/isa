/**
 * Itens ativos do checklist: os do tipo inteiro + os da subcategoria do chamado.
 * Item da subcategoria com a mesma key substitui o do tipo (sem duplicar pergunta).
 */
import type { TicketType } from '@prisma/client'
import prisma from '../../../config/prisma'
import type { ChecklistItem } from './intake'

export async function loadChecklist(type: TicketType, subcategoryId: string | null): Promise<ChecklistItem[]> {
  const rows = await prisma.intakeChecklistItem.findMany({
    where: {
      active: true,
      type,
      OR: [{ subcategory_id: null }, ...(subcategoryId ? [{ subcategory_id: subcategoryId }] : [])],
    },
    orderBy: [{ sort: 'asc' }, { created_at: 'asc' }],
    select: { key: true, label: true, criterion: true, question: true, kind: true, required: true, subcategory_id: true },
  })
  const bySub = new Set(rows.filter(r => r.subcategory_id).map(r => r.key))
  return rows
    .filter(r => r.subcategory_id || !bySub.has(r.key))
    .map(({ subcategory_id, ...item }) => item)
}
