export type SpaceRole = 'owner' | 'editor' | 'viewer'
export interface DocPerson { id: string; name: string; email?: string; avatar?: string | null }
export interface DocSpaceRef { id: string; name: string; icon: string | null; color: string | null }
export interface DocSpace extends DocSpaceRef {
  description: string | null
  visibility: 'private' | 'internal'
  archivedAt: string | null
  role: SpaceRole
  isMember: boolean
  memberCount: number
  pageCount: number
}
export interface DocMember { role: SpaceRole; user: DocPerson }
export interface DocTreeNode { id: string; parentId: string | null; title: string; icon: string | null; position: number; updatedAt: string; favorite?: boolean }
export interface DocPageMeta {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  icon: string | null
  role: SpaceRole
  favorite: boolean
  breadcrumb: { id: string; title: string; icon: string | null }[]
  space: DocSpaceRef & { visibility: 'private' | 'internal' }
  updatedAt: string
  updatedBy?: DocPerson | null
}
export interface DocListItem { id: string; title: string; icon: string | null; updatedAt: string; space: DocSpaceRef; snippet?: string; updatedBy?: DocPerson | null }
export interface DocVersion { id: string; title: string; label: string | null; createdAt: string; createdBy: DocPerson | null }
export interface DocTrashItem { id: string; title: string; icon: string | null; space: DocSpaceRef; deletedAt: string; deletedBy: DocPerson | null; childCount: number; purgeAt: string | null }
export interface DocAttachment { id: string; filename: string; mime: string; size: number; url: string }
export const canEdit = (role: SpaceRole | undefined) => role === 'owner' || role === 'editor'
export const ROLE_LABEL: Record<SpaceRole, string> = { owner: 'Dono', editor: 'Pode editar', viewer: 'Pode ler' }
