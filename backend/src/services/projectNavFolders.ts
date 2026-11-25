import { z } from 'zod'
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { AppError } from '../middlewares/errorHandler'

/**
 * Pastas compartilhadas da sidebar de Projetos: pasta dentro de pasta e
 * projeto dentro de pasta — projeto nunca dentro de projeto. Organizar é de
 * Gerente/admin (rotas com requireCap('projects.global.manage')); os demais só leem.
 */

export const navFolderSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome à pasta').max(80),
  parentId: z.string().uuid().nullable().optional(),
})
export const updateNavFolderSchema = navFolderSchema.partial()
export const moveProjectSchema = z.object({ folderId: z.string().uuid().nullable() })

/**
 * Quem organiza vê a árvore toda (inclusive pastas vazias); os demais só as
 * pastas que levam a algum projeto do qual são membros.
 */
export async function listNavFolders(userId: string, canOrganize: boolean) {
  const folders = await prisma.projectNavFolder.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, parent_id: true } })
  if (canOrganize) return folders
  const mine = await prisma.project.findMany({
    where: { archived_at: null, nav_folder_id: { not: null }, ...(await visibleProjectsWhere(userId)) },
    select: { nav_folder_id: true },
  })
  const parentOf = new Map(folders.map((f) => [f.id, f.parent_id]))
  const visible = new Set<string>()
  for (const { nav_folder_id } of mine) {
    for (let id: string | null | undefined = nav_folder_id; id && !visible.has(id); id = parentOf.get(id)) visible.add(id)
  }
  return folders.filter((f) => visible.has(f.id))
}

async function assertParentExists(parentId: string | null | undefined) {
  if (parentId && !(await prisma.projectNavFolder.findUnique({ where: { id: parentId }, select: { id: true } }))) {
    throw new AppError(404, 'Pasta de destino não encontrada', 'NOT_FOUND')
  }
}

export async function createNavFolder(data: z.infer<typeof navFolderSchema>) {
  await assertParentExists(data.parentId)
  return prisma.projectNavFolder.create({ data: { name: data.name, parent_id: data.parentId ?? null } })
}

export async function updateNavFolder(id: string, data: z.infer<typeof updateNavFolderSchema>) {
  if (!(await prisma.projectNavFolder.findUnique({ where: { id }, select: { id: true } }))) throw new AppError(404, 'Pasta não encontrada', 'NOT_FOUND')
  if (data.parentId) {
    await assertParentExists(data.parentId)
    // Subir a partir do destino: se passar pela própria pasta, viraria um ciclo.
    for (let cur: string | null = data.parentId; cur; ) {
      if (cur === id) throw new AppError(400, 'Uma pasta não pode ir para dentro dela mesma.', 'NAV_FOLDER_CYCLE')
      cur = (await prisma.projectNavFolder.findUnique({ where: { id: cur }, select: { parent_id: true } }))?.parent_id ?? null
    }
  }
  return prisma.projectNavFolder.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.parentId !== undefined ? { parent_id: data.parentId } : {}),
    },
  })
}

/** Apagar a pasta não some com nada: subpastas e projetos sobem para a pasta-mãe. */
export async function deleteNavFolder(id: string) {
  const folder = await prisma.projectNavFolder.findUnique({ where: { id } })
  if (!folder) throw new AppError(404, 'Pasta não encontrada', 'NOT_FOUND')
  await prisma.$transaction([
    prisma.projectNavFolder.updateMany({ where: { parent_id: id }, data: { parent_id: folder.parent_id } }),
    prisma.project.updateMany({ where: { nav_folder_id: id }, data: { nav_folder_id: folder.parent_id } }),
    prisma.projectNavFolder.delete({ where: { id } }),
  ])
}

export async function moveProjectToNavFolder(projectId: string, folderId: string | null) {
  await assertParentExists(folderId)
  const updated = await prisma.project.updateMany({ where: { id: projectId }, data: { nav_folder_id: folderId } })
  if (updated.count === 0) throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')
}
