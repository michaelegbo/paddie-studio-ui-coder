export const PADDIE_DATA_SKILL_NAME = "paddie-data-integrator"

export type PaddieMemoryRecord = {
  id?: string
  arango_id?: string
  content?: string
  memory?: string
  type?: string
  user_id?: string
  metadata?: Record<string, unknown>
  topics?: string[]
  created_at?: number | string
  updated_at?: number | string
  importance_score?: number
}

export type PaddieMemoryList = {
  items: PaddieMemoryRecord[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export type PaddieMemoryUser = {
  user_id: string
  count: number
}

export type PaddieMemoryRouterResponse = {
  action?: string
  status?: string
  explanation?: string
  confidence?: number
  memories?: PaddieMemoryRecord[]
  context?: Array<{
    memory?: string
    type?: string
    relevance?: number
    source?: string
  }>
  context_count?: number
  result?: unknown
  metadata?: Record<string, unknown>
}

export type PaddieKnowledgeBase = {
  _key?: string
  id?: string
  name: string
  description?: string
  visibility?: "private" | "tenant"
  status?: string
  document_count?: number
  chunk_count?: number
  entity_count?: number
  created_at?: string
  updated_at?: string
}

export type PaddieKnowledgeBaseDocument = {
  _key?: string
  id?: string
  knowledge_base_id?: string
  name: string
  content_type?: string
  metadata?: Record<string, unknown>
  status?: string
  character_count?: number
  chunk_count?: number
  created_at?: string
}

export type PaddieKnowledgeBaseQueryResult = {
  answer?: string | null
  results?: Array<{
    chunk_id?: string
    document_id?: string
    document_name?: string
    text?: string
    score?: number
    sources?: string[]
    entities?: string[]
  }>
  citations?: Array<{
    document_id?: string
    document_name?: string
    chunk_id?: string
    text?: string
  }>
}

export type PaddieKnowledgeBaseApiDetail = {
  knowledge_base_id: string
  name: string
  endpoint: string
  method: string
  auth: string
  request_body: Record<string, unknown>
  curl: string
}

export type PaddieApiKey = {
  id: string
  name: string
  key_prefix: string
  scopes?: string[]
  rate_limit?: number
  created_at?: string
  last_used?: string | null
  is_active?: boolean
  usage_count?: number
}

export type PaddieApiKeySecret = {
  id: string
  name: string
  apiKey: string
  key_prefix: string
  created_at?: string
  regenerated_at?: string
}

export const paddieMemoryText = (memory: PaddieMemoryRecord) =>
  String(memory.memory || memory.content || "").trim()

export const paddieMemoryLabel = (memory: PaddieMemoryRecord) => {
  const text = paddieMemoryText(memory).replace(/\s+/g, " ")
  if (text) return text.length > 72 ? `${text.slice(0, 69)}...` : text
  return memory.id || memory.arango_id || "Memory"
}

export const knowledgeBaseID = (kb: PaddieKnowledgeBase) => kb._key || kb.id || ""

export const sourceChunkText = (result: PaddieKnowledgeBaseQueryResult) =>
  (result.results ?? [])
    .flatMap((item, index) => {
      const text = item.text?.trim()
      if (!text) return []
      const source = item.document_name ? `${item.document_name}, chunk ${index + 1}` : `chunk ${index + 1}`
      return [`[${source}] ${text}`]
    })
    .join("\n\n")

export const dataGoalNeedsPaddieSkill = (goal: string) =>
  /\b(memory|memories|remember|recall|rag|knowledge[\s-]?base|knowledge base|uploaded documents?|api keys?|paddie data|rmn api|memory router)\b/i.test(
    goal,
  )

export const paddieDataSkillInstruction = () =>
  `Before implementing Paddie Memory, Memory Router, Knowledge Base, RAG, or API-key integration, load and follow the ${PADDIE_DATA_SKILL_NAME} skill. Use RMN/Paddie APIs as the source of truth, keep secrets server-side or in environment variables, create or resolve Paddie Memory user IDs dynamically per app user, respect plan gates, and do not pull unrelated tenant memory.`

export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
