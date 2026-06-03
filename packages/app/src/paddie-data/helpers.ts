export const PADDIE_DATA_SKILL_NAME = "paddie-data-integrator"

export type PaddieDataLlmRuntimeConfig = {
  provider: "openai" | "anthropic" | "google" | "mistral" | "groq" | "cohere" | "xai" | "azure-openai" | "openrouter" | "custom"
  apiKeyEnv: string
  model?: string
  modelEnv?: string
  baseUrlEnv?: string
}

export type PaddieDataPlaygroundImplementationInput = {
  apiBase: string
  apiKeyEnv: string
  memoryService: boolean
  memoryMode: "router" | "manual"
  routerMode?: "auto" | "conversation" | "store" | "retrieve"
  strategy?: "auto" | "vector" | "hybrid" | "graph"
  memoryType?: string
  llm: PaddieDataLlmRuntimeConfig
  knowledgeBases: Array<{
    id: string
    name: string
    documentCount?: number
    chunkCount?: number
  }>
}

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

export const defaultPaddieDataLlmRuntime = (): PaddieDataLlmRuntimeConfig => ({
  provider: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  model: "gpt-4.1-mini",
})

export const paddieDataLlmRuntimeInstruction = (config: PaddieDataLlmRuntimeConfig = defaultPaddieDataLlmRuntime()) => {
  const model = config.model?.trim() || (config.modelEnv ? `read from ${config.modelEnv}` : "choose a configured chat model")
  const baseUrl = config.baseUrlEnv ? ` If using a compatible endpoint, read its base URL from ${config.baseUrlEnv}.` : ""
  return `LLM runtime required: use ${config.provider} from trusted server-side code, read its API key from ${config.apiKeyEnv}, and use ${model}. Paddie Memory and Knowledge Base return memory/RAG context; the app's LLM must decide when to call them, combine their results, and compose the final user-facing answer.${baseUrl} Do not put LLM or Paddie API keys in browser bundles or prompt-visible generated constants.`
}

export const paddieDataSkillInstruction = () =>
  `Before implementing Paddie Memory, Memory Router, Knowledge Base, RAG, or API-key integration, load and follow the ${PADDIE_DATA_SKILL_NAME} skill. Use RMN/Paddie APIs as the source of truth, keep secrets server-side or in environment variables, create or resolve Paddie Memory user IDs dynamically per app user, query selected knowledge bases at runtime instead of embedding retrieved chunks, add an application LLM runtime to orchestrate Memory/RAG calls and final answers, respect plan gates, and do not pull unrelated tenant memory.`

export const paddieDataPlaygroundImplementationCode = (input: PaddieDataPlaygroundImplementationInput) => `/*
Portable Paddie Data Playground implementation pack.
Use this as generated-project code, not as static content. Keep all secrets server-side.
Selected knowledge bases:
${input.knowledgeBases.length ? input.knowledgeBases.map((kb) => `- ${kb.name} (${kb.id})`).join("\n") : "- none selected"}
*/

// File: src/lib/paddie-data.ts
export type PaddieChatMessage = { role: "user" | "assistant" | "system"; content: string }

export type PaddiePlaygroundRequest = {
  query: string
  appUserId: string
  conversationHistory?: PaddieChatMessage[]
  knowledgeBaseIds?: string[]
}

export type PaddieMemoryResult = {
  action?: string
  explanation?: string
  context_count?: number
  memories?: unknown[]
}

export type PaddieKnowledgeResult = {
  knowledgeBaseId: string
  answer?: string | null
  results?: Array<{ text?: string; document_name?: string; score?: number }>
  citations?: Array<{ document_name?: string; text?: string }>
}

const PADDIE_API_BASE = process.env.PADDIE_API_BASE || ${JSON.stringify(input.apiBase)}
const PADDIE_KNOWLEDGE_BASE_IDS = ${JSON.stringify(input.knowledgeBases.map((kb) => kb.id), null, 2)}

async function paddieFetch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(\`\${PADDIE_API_BASE}\${path}\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env[${JSON.stringify(input.apiKeyEnv)}] || "",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const payload = await response.json()
  return payload.data ?? payload
}

export async function callPaddieMemory(request: PaddiePlaygroundRequest) {
  ${input.memoryService ? `return paddieFetch<PaddieMemoryResult>("/memory/router", {
    query: request.query,
    user_id: request.appUserId,
    mode: ${JSON.stringify(input.routerMode ?? "conversation")},
    memory_type: ${JSON.stringify(input.memoryType || undefined)},
    include_analysis: true,
    options: { k: 10, threshold: 0.5 },
  })` : "return undefined"}
}

export async function queryPaddieKnowledgeBases(request: PaddiePlaygroundRequest) {
  const knowledgeBaseIds = request.knowledgeBaseIds?.length ? request.knowledgeBaseIds : PADDIE_KNOWLEDGE_BASE_IDS
  return Promise.all(
    knowledgeBaseIds.map((knowledgeBaseId) =>
      paddieFetch<PaddieKnowledgeResult>(\`/knowledge-bases/\${encodeURIComponent(knowledgeBaseId)}/query\`, {
        query: request.query,
        limit: 8,
        generateAnswer: true,
        includeGraph: true,
      }).then((result) => ({ ...result, knowledgeBaseId })),
    ),
  )
}

// File: src/app/api/paddie-playground/route.ts
// Adapt to Express, Hono, Next.js, Remix, or your server framework.
import {
  callPaddieMemory,
  queryPaddieKnowledgeBases,
  type PaddieKnowledgeResult,
  type PaddieMemoryResult,
  type PaddiePlaygroundRequest,
} from "@/lib/paddie-data"

async function callAppLlm(input: {
  query: string
  conversationHistory: Array<{ role: string; content: string }>
  memory?: PaddieMemoryResult
  knowledge: PaddieKnowledgeResult[]
}) {
  const provider = ${JSON.stringify(input.llm.provider)}
  const model = process.env[${JSON.stringify(input.llm.modelEnv || "PADDIE_LLM_MODEL")}] || ${JSON.stringify(input.llm.model || "configured-chat-model")}
  const apiKey = process.env[${JSON.stringify(input.llm.apiKeyEnv)}]
  if (!apiKey) throw new Error("Missing ${input.llm.apiKeyEnv}")

  // Replace this adapter with the SDK for your chosen provider.
  // Prompt shape:
  // - system: You answer using Paddie Memory and Knowledge Base context.
  // - memory: JSON.stringify(input.memory)
  // - knowledge: JSON.stringify(input.knowledge)
  // - conversationHistory: input.conversationHistory
  // - user: input.query
  return {
    provider,
    model,
    answer: "TODO: call the configured LLM here and return its final answer.",
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as PaddiePlaygroundRequest
  if (!body.query?.trim()) return Response.json({ error: "query is required" }, { status: 400 })
  if (!body.appUserId?.trim()) return Response.json({ error: "appUserId is required" }, { status: 400 })

  const [memory, knowledge] = await Promise.all([
    callPaddieMemory(body),
    queryPaddieKnowledgeBases(body),
  ])

  return Response.json({
    memory,
    knowledge,
    llm: await callAppLlm({
      query: body.query,
      conversationHistory: body.conversationHistory ?? [],
      memory,
      knowledge,
    }),
  })
}

// File: src/components/PaddieDataPlayground.tsx
import { useState } from "react"

export function PaddieDataPlayground({ appUserId }: { appUserId: string }) {
  const [query, setQuery] = useState("")
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([])
  const [loading, setLoading] = useState(false)

  async function send() {
    if (!query.trim()) return
    setLoading(true)
    const nextMessages = [...messages, { role: "user" as const, content: query }]
    setMessages(nextMessages)
    setQuery("")

    try {
      const response = await fetch("/api/paddie-playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          appUserId,
          conversationHistory: nextMessages,
        }),
      })
      const data = await response.json()
      setMessages([...nextMessages, { role: "assistant", content: data.llm?.answer || "No answer returned." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <div>
        {messages.map((message, index) => (
          <article key={index} data-role={message.role}>
            {message.content}
          </article>
        ))}
      </div>
      <textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask with Paddie Memory and RAG" />
      <button type="button" disabled={loading || !query.trim()} onClick={send}>
        {loading ? "Thinking..." : "Send"}
      </button>
    </section>
  )
}
`

export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
