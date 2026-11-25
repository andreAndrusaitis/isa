import api from './api'
import type { KnowledgeArticle, KnowledgeArticleInput, KnowledgeArticlePage, KnowledgeGaps, KnowledgeListParams } from '@/types/knowledge'

const readDataUri = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

/** Base de conhecimento (só admin). Todas as escritas devolvem o artigo completo. */
export const knowledgeService = {
  list: (params: KnowledgeListParams): Promise<KnowledgeArticlePage> => api.get('/knowledge', { params }).then(r => r.data),
  gaps: (days: number): Promise<KnowledgeGaps> => api.get('/knowledge/gaps', { params: { days } }).then(r => r.data.data),
  get: (id: string): Promise<KnowledgeArticle> => api.get(`/knowledge/${id}`).then(r => r.data.data),
  create: (input: KnowledgeArticleInput): Promise<KnowledgeArticle> => api.post('/knowledge', input).then(r => r.data.data),
  update: (id: string, input: KnowledgeArticleInput): Promise<KnowledgeArticle> => api.put(`/knowledge/${id}`, input).then(r => r.data.data),
  publish: (id: string): Promise<KnowledgeArticle> => api.post(`/knowledge/${id}/publish`).then(r => r.data.data),
  unpublish: (id: string): Promise<KnowledgeArticle> => api.post(`/knowledge/${id}/unpublish`).then(r => r.data.data),
  remove: (id: string): Promise<void> => api.delete(`/knowledge/${id}`).then(() => undefined),
  importFile: async (file: File): Promise<KnowledgeArticle> => {
    const dataUri = await readDataUri(file)
    return api.post('/knowledge/import', { fileName: file.name, dataUri }).then(r => r.data.data)
  },
}
