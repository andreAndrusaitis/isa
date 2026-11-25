// O que a API da base de conhecimento devolve. O vetor do trecho (`embedding`) não sai dela.

export type KnowledgeArticleStatus = 'draft' | 'published'
export type AiInteractionFeedback = 'useful' | 'not_useful'

export interface KnowledgeArticleCategory {
  id: string
  name: string
  active: boolean
}

/** Linha de `GET /knowledge`: o conteúdo pode ter centenas de KB e fica só no `GET /knowledge/:id`. */
export interface KnowledgeArticleSummary {
  id: string
  title: string
  status: KnowledgeArticleStatus
  source_filename: string | null
  created_by_id: string
  updated_by_id: string
  published_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  categories: KnowledgeArticleCategory[]
}

export interface KnowledgeArticle extends KnowledgeArticleSummary {
  content: string
}

export interface KnowledgeArticlePage {
  data: KnowledgeArticleSummary[]
  total: number
  page: number
  pageSize: number
}

/** Assunto que a IA não soube responder: `example` já vem mascarada e sem quem perguntou. */
export interface KnowledgeGap {
  example: string
  title: string
  count: number
  last_at: string
}

export interface KnowledgeGaps {
  days: number
  gaps: KnowledgeGap[]
  analyzed: number
  truncated: boolean
  /** 'text' = sem IA disponível: só perguntas de texto igual ficam juntas. */
  grouped_by: 'subject' | 'text'
}

export interface KnowledgeArticleInput {
  title: string
  content: string
  categoryIds: string[]
}

export interface KnowledgeListParams {
  page: number
  pageSize: number
  status?: KnowledgeArticleStatus
  categoryId?: string
}

export interface KnowledgeChunk {
  id: string
  article_id: string
  position: number
  text: string
  created_at: string
  updated_at: string
}

export interface AiInteractionSource {
  article_id: string
  title: string
}

export interface AiInteraction {
  id: string
  ticket_id: string | null
  user_id: string
  org_id: string | null
  question: string
  answer: string | null
  confidence: number | null
  sources: AiInteractionSource[]
  feedback: AiInteractionFeedback | null
  accepted: boolean
  created_at: string
  updated_at: string
}
