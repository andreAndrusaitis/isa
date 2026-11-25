import api from './api'
import type { DocAttachment, DocListItem, DocMember, DocPageMeta, DocPerson, DocSpace, DocTrashItem, DocTreeNode, DocVersion, SpaceRole } from '@/types/docs'

const BASE = '/docs'
const data = <T>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data)

const readDataUri = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
  r.readAsDataURL(file)
})

export type SpaceInput = Partial<Pick<DocSpace, 'name' | 'icon' | 'color' | 'description' | 'visibility'>>

export const docsService = {
  access: () => api.get(`${BASE}/access`).then(() => true),
  spaces: () => data<DocSpace[]>(api.get(`${BASE}/spaces`)),
  createSpace: (input: SpaceInput) => data<DocSpace>(api.post(`${BASE}/spaces`, input)),
  updateSpace: (id: string, input: SpaceInput) => data<DocSpace>(api.patch(`${BASE}/spaces/${id}`, input)),
  archiveSpace: (id: string) => api.delete(`${BASE}/spaces/${id}`).then(() => undefined),
  members: (id: string) => data<DocMember[]>(api.get(`${BASE}/spaces/${id}/members`)),
  setMember: (id: string, userId: string, role: SpaceRole) => data<DocMember>(api.put(`${BASE}/spaces/${id}/members/${userId}`, { role })),
  removeMember: (id: string, userId: string) => api.delete(`${BASE}/spaces/${id}/members/${userId}`).then(() => undefined),
  people: (q: string) => data<DocPerson[]>(api.get(`${BASE}/people`, { params: { q } })),
  tree: (spaceId: string) => data<DocTreeNode[]>(api.get(`${BASE}/spaces/${spaceId}/pages`)),
  createPage: (spaceId: string, input: { title?: string; parentId?: string | null; icon?: string | null }) => data<DocTreeNode & { spaceId: string }>(api.post(`${BASE}/spaces/${spaceId}/pages`, input)),
  page: (id: string) => data<DocPageMeta>(api.get(`${BASE}/pages/${id}`)),
  updatePage: (id: string, input: { title?: string; icon?: string | null }) => data<DocTreeNode>(api.patch(`${BASE}/pages/${id}`, input)),
  movePage: (id: string, input: { parentId?: string | null; position?: number; spaceId?: string }) => data<DocTreeNode>(api.post(`${BASE}/pages/${id}/move`, input)),
  duplicatePage: (id: string) => data<DocTreeNode>(api.post(`${BASE}/pages/${id}/duplicate`)),
  trashPage: (id: string) => api.delete(`${BASE}/pages/${id}`).then(() => undefined),
  restorePage: (id: string) => data<DocTreeNode>(api.post(`${BASE}/pages/${id}/restore`)),
  deletePage: (id: string) => api.delete(`${BASE}/pages/${id}/permanent`).then(() => undefined),
  trash: () => data<DocTrashItem[]>(api.get(`${BASE}/trash`)),
  favorite: (id: string, on: boolean) => (on ? api.put(`${BASE}/pages/${id}/favorite`) : api.delete(`${BASE}/pages/${id}/favorite`)).then(() => undefined),
  favorites: () => data<DocListItem[]>(api.get(`${BASE}/favorites`)),
  recent: () => data<DocListItem[]>(api.get(`${BASE}/recent`)),
  search: (q: string) => data<DocListItem[]>(api.get(`${BASE}/search`, { params: { q } })),
  versions: (id: string) => data<DocVersion[]>(api.get(`${BASE}/pages/${id}/versions`)),
  saveVersion: (id: string, label?: string) => data<DocVersion>(api.post(`${BASE}/pages/${id}/versions`, label ? { label } : {})),
  versionBytes: (id: string) => api.get<ArrayBuffer>(`${BASE}/versions/${id}/ydoc`, { responseType: 'arraybuffer' }).then(r => new Uint8Array(r.data)),
  restoreVersion: (pageId: string, versionId: string) => api.post(`${BASE}/pages/${pageId}/versions/${versionId}/restore`).then(() => undefined),
  uploadAttachment: async (pageId: string, file: File) => data<DocAttachment>(api.post(`${BASE}/pages/${pageId}/attachments`, { filename: file.name, dataUri: await readDataUri(file) })),
  attachmentUrl: (id: string) => data<DocAttachment>(api.get(`${BASE}/attachments/${id}`)).then(a => a.url),
}
