import api from './api'

export type DocBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bulleted_list'; items: string[] }
  | { type: 'checklist'; items: string[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'link'; text: string; url: string }

export interface ProjectDocument {
  id: string
  projectId: string
  parentId: string | null
  title: string
  content: DocBlock[]
  createdBy: string
  updatedBy: string
}

export async function listDocuments(projectId: string): Promise<ProjectDocument[]> {
  const { data } = await api.get(`/projects/${projectId}/docs`)
  return data.data
}

export async function createDocument(projectId: string, input: { title: string; content: DocBlock[]; parentId?: string | null }): Promise<ProjectDocument> {
  const { data } = await api.post(`/projects/${projectId}/docs`, input)
  return data.data
}

export async function getDocument(projectId: string, documentId: string): Promise<ProjectDocument> {
  const { data } = await api.get(`/projects/${projectId}/docs/${documentId}`)
  return data.data
}

export async function updateDocument(projectId: string, documentId: string, input: { title?: string; content?: DocBlock[] }): Promise<ProjectDocument> {
  const { data } = await api.patch(`/projects/${projectId}/docs/${documentId}`, input)
  return data.data
}
