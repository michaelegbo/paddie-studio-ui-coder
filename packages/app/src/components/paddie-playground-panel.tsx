import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, Show, onCleanup, type JSX } from "solid-js"
import { useAuth } from "@/context/auth"
import { usePrompt } from "@/context/prompt"
import { paddieApi, paddieApiErrorFromResponse, paddieApiErrorMessage } from "@/lib/paddie-api"
import {
  defaultPaddieDataLlmRuntime,
  knowledgeBaseID,
  paddieDataPlaygroundImplementationCode,
  paddieMemoryLabel,
  type PaddieDataLlmRuntimeConfig,
  type PaddieApiKey,
  type PaddieApiKeySecret,
  type PaddieKnowledgeBase,
  type PaddieMemoryRecord,
} from "@/paddie-data/helpers"

type PlaygroundWindow = Window & {
  __PADDIE_API_URL?: string
  __paddie_fetch?: typeof fetch
}

type PlaygroundMode = "router" | "manual"
type PlaygroundRouterMode = "auto" | "conversation" | "store" | "retrieve"
type PlaygroundStrategy = "auto" | "vector" | "hybrid" | "graph"
type PlaygroundPersona = "default" | "pocketmoni"
type PlaygroundMemoryType = "" | "short_term" | "episodic" | "semantic" | "procedural" | "preference" | "working" | "summary" | "artifact"

type PlaygroundMessage = {
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string | number | Date
}

type PlaygroundModel = {
  id: string
  name: string
  description?: string
}

type PlaygroundConversation = {
  id: string
  title?: string
  messages?: PlaygroundMessage[]
  model?: string
  apiKeyId?: string
  updatedAt?: string
  createdAt?: string
}

type PlaygroundMemoryStatus = {
  action?: string
  strategy?: string
  count?: number
  explanation?: string
  storageQueued?: boolean
  error?: string
}

type PlaygroundKnowledgeBaseStatus = {
  count: number
  items: unknown[]
}

type KnowledgeBaseSummary = {
  id: string
  name: string
  documentCount?: number
  chunkCount?: number
}

type PlaygroundAttachConfig = {
  memoryService: boolean
  knowledgeBaseMode: "none" | "selected" | "all"
  knowledgeBaseIDs: string[]
  paddieApiKeyEnv: string
  paddieApiKey?: string
  llm: PaddieDataLlmRuntimeConfig
}

const llmProviders: Array<{ value: PaddieDataLlmRuntimeConfig["provider"]; label: string; apiKeyEnv: string; model: string; baseUrlEnv?: string }> = [
  { value: "openai", label: "OpenAI", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
  { value: "anthropic", label: "Anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", model: "claude-3-5-sonnet-latest" },
  { value: "google", label: "Google Gemini", apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", model: "gemini-1.5-pro" },
  { value: "mistral", label: "Mistral", apiKeyEnv: "MISTRAL_API_KEY", model: "mistral-large-latest" },
  { value: "groq", label: "Groq", apiKeyEnv: "GROQ_API_KEY", model: "llama-3.1-70b-versatile" },
  { value: "cohere", label: "Cohere", apiKeyEnv: "COHERE_API_KEY", model: "command-r-plus" },
  { value: "xai", label: "xAI", apiKeyEnv: "XAI_API_KEY", model: "grok-2-latest" },
  { value: "azure-openai", label: "Azure OpenAI", apiKeyEnv: "AZURE_OPENAI_API_KEY", model: "gpt-4o-mini", baseUrlEnv: "AZURE_OPENAI_ENDPOINT" },
  { value: "openrouter", label: "OpenRouter", apiKeyEnv: "OPENROUTER_API_KEY", model: "openai/gpt-4.1-mini", baseUrlEnv: "OPENROUTER_BASE_URL" },
  { value: "custom", label: "Custom compatible API", apiKeyEnv: "LLM_API_KEY", model: "configured-chat-model", baseUrlEnv: "LLM_BASE_URL" },
]

const llmProviderDefaults = (provider: PaddieDataLlmRuntimeConfig["provider"]) =>
  llmProviders.find((item) => item.value === provider) ?? llmProviders[0]

const routerModes: Array<{ value: PlaygroundRouterMode; label: string; description: string }> = [
  { value: "conversation", label: "Conversation", description: "Retrieve context and store useful memory in the background." },
  { value: "auto", label: "Auto detect", description: "Let the router choose whether to store, retrieve, or continue." },
  { value: "store", label: "Store only", description: "Save information without retrieval." },
  { value: "retrieve", label: "Retrieve only", description: "Search memory without storing new information." },
]

const strategies: Array<{ value: PlaygroundStrategy; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Balanced memory search." },
  { value: "vector", label: "Vector", description: "Semantic similarity only." },
  { value: "hybrid", label: "Hybrid", description: "Semantic plus relationship context." },
  { value: "graph", label: "Graph", description: "Entity and relationship traversal." },
]

const memoryTypes: Array<{ value: PlaygroundMemoryType; label: string }> = [
  { value: "", label: "All memory types" },
  { value: "semantic", label: "Semantic" },
  { value: "episodic", label: "Episodic" },
  { value: "procedural", label: "Procedural" },
  { value: "preference", label: "Preference" },
  { value: "short_term", label: "Short term" },
  { value: "working", label: "Working" },
  { value: "summary", label: "Summary" },
  { value: "artifact", label: "Artifact" },
]

const apiBase = () =>
  typeof window !== "undefined" && (window as PlaygroundWindow).__PADDIE_API_URL
    ? (window as PlaygroundWindow).__PADDIE_API_URL!
    : import.meta.env.VITE_PADDIE_API_URL ?? "https://api.paddie.io/api"

const platformFetch = (): typeof fetch =>
  (typeof window !== "undefined" && (window as PlaygroundWindow).__paddie_fetch) || fetch

const inputClass =
  "h-10 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-13-medium text-text-base outline-none transition-colors placeholder:text-text-weak focus:border-border-weak-base disabled:opacity-50"

const newConversationID = () => `playground_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"

const stringValue = (value: unknown) => (typeof value === "string" ? value : "")

const numberValue = (value: unknown) => (typeof value === "number" ? value : undefined)

const arrayValue = (value: unknown) => (Array.isArray(value) ? value : [])

const compactJSON = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const memoryText = (memory: unknown) => {
  if (typeof memory === "string") return memory
  if (!isRecord(memory)) return String(memory)
  if (typeof memory.memory === "string") return memory.memory
  if (typeof memory.content === "string") return memory.content
  return compactJSON(memory)
}

const dateLabel = (value: string | number | Date | undefined) => {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

const conversationMessages = (items: unknown): PlaygroundMessage[] =>
  arrayValue(items).flatMap((item) => {
    if (!isRecord(item)) return []
    const role = item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : undefined
    if (!role || typeof item.content !== "string") return []
    return [{ role, content: item.content, timestamp: item.timestamp as PlaygroundMessage["timestamp"] }]
  })

async function playgroundChat(data: {
  query: string
  apiKey: string
  userId: string
  model: string
  mode: PlaygroundMode
  routerMode?: PlaygroundRouterMode
  strategy?: PlaygroundStrategy
  memoryType?: PlaygroundMemoryType
  persona: PlaygroundPersona
  knowledgeBaseIds: string[]
  conversationId: string
  conversationHistory: Array<{ role: string; content: string }>
  signal: AbortSignal
}) {
  const response = await platformFetch()(`${apiBase()}/playground/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": data.apiKey,
    },
    body: JSON.stringify({
      query: data.query,
      userId: data.userId,
      model: data.model,
      mode: data.mode,
      routerMode: data.routerMode,
      strategy: data.strategy,
      memoryType: data.memoryType || undefined,
      persona: data.persona,
      knowledgeBaseIds: data.knowledgeBaseIds,
      conversationId: data.conversationId,
      conversationHistory: data.conversationHistory,
    }),
    signal: data.signal,
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error(`Chat request failed with HTTP ${response.status}`)
    }
    throw paddieApiErrorFromResponse(response.status, body)
  }

  if (!response.body) throw new Error("Playground chat did not return a stream.")
  return response.body
}

export function PaddiePlaygroundPanel(props: { chatHidden?: boolean; onChatToggle?: VoidFunction; openApiTab?: VoidFunction }) {
  const auth = useAuth()
  const dialog = useDialog()
  const prompt = usePrompt()
  const [apiKeys, setApiKeys] = createSignal<PaddieApiKey[]>([])
  const [models, setModels] = createSignal<PlaygroundModel[]>([])
  const [knowledgeBases, setKnowledgeBases] = createSignal<PaddieKnowledgeBase[]>([])
  const [selectedApiKeyID, setSelectedApiKeyID] = createSignal("")
  const [selectedModelID, setSelectedModelID] = createSignal("")
  const [selectedKnowledgeBaseIDs, setSelectedKnowledgeBaseIDs] = createSignal<string[]>([])
  const [revealedApiKey, setRevealedApiKey] = createSignal("")
  const [manualApiKey, setManualApiKey] = createSignal("")
  const [userID, setUserID] = createSignal(auth.user()?.userId ?? "")
  const [mode, setMode] = createSignal<PlaygroundMode>("router")
  const [routerMode, setRouterMode] = createSignal<PlaygroundRouterMode>("conversation")
  const [strategy, setStrategy] = createSignal<PlaygroundStrategy>("auto")
  const [memoryType, setMemoryType] = createSignal<PlaygroundMemoryType>("")
  const [persona, setPersona] = createSignal<PlaygroundPersona>("default")
  const [messages, setMessages] = createSignal<PlaygroundMessage[]>([])
  const [input, setInput] = createSignal("")
  const [streaming, setStreaming] = createSignal(false)
  const [error, setError] = createSignal<unknown>()
  const [memories, setMemories] = createSignal<unknown[]>([])
  const [memoryStatus, setMemoryStatus] = createSignal<PlaygroundMemoryStatus>()
  const [knowledgeBaseStatus, setKnowledgeBaseStatus] = createSignal<PlaygroundKnowledgeBaseStatus>()
  const [conversations, setConversations] = createSignal<PlaygroundConversation[]>([])
  const [conversationID, setConversationID] = createSignal(newConversationID())
  const [loading, setLoading] = createSignal(false)
  const [regenerating, setRegenerating] = createSignal(false)
  const [preparingAttachKey, setPreparingAttachKey] = createSignal(false)
  let abortController: AbortController | undefined
  let initialized = false
  let messagesEnd: HTMLDivElement | undefined
  let manualApiKeyInput: HTMLInputElement | undefined
  let promptInput: HTMLTextAreaElement | undefined

  onCleanup(() => abortController?.abort())

  const selectedApiKey = createMemo(() => apiKeys().find((item) => item.id === selectedApiKeyID()))
  const selectedModel = createMemo(() => models().find((item) => item.id === selectedModelID()))
  const activeApiKey = createMemo(() => manualApiKey().trim() || revealedApiKey().trim())
  const ready = createMemo(() =>
    !!input().trim() &&
    !!selectedApiKeyID() &&
    !!activeApiKey() &&
    !!userID().trim() &&
    !!selectedModelID() &&
    !streaming(),
  )
  const errorText = createMemo(() => error() ? paddieApiErrorMessage(error()) : "")
  const selectedKnowledgeBases = createMemo(() =>
    knowledgeBases().filter((item) => selectedKnowledgeBaseIDs().includes(knowledgeBaseID(item))),
  )
  const knowledgeBaseSummaries = () =>
    knowledgeBases().flatMap((kb) => {
      const id = knowledgeBaseID(kb)
      if (!id) return []
      return [{
        id,
        name: kb.name,
        documentCount: kb.document_count,
        chunkCount: kb.chunk_count,
      }]
    })

  const focusPrompt = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const loadApiKeys = async () => {
    const items = await paddieApi.get<PaddieApiKey[]>("/users/me/api-keys")
    setApiKeys(items)
    if (!selectedApiKeyID() && items[0]) setSelectedApiKeyID(items[0].id)
  }

  const loadModels = async () => {
    const items = await paddieApi.get<PlaygroundModel[]>("/playground/models")
    setModels(items)
    if (!selectedModelID() && items[0]) setSelectedModelID(items[0].id)
  }

  const loadKnowledgeBases = async () => {
    setKnowledgeBases(await paddieApi.get<PaddieKnowledgeBase[]>("/knowledge-bases"))
  }

  const loadConversations = async () => {
    setConversations(await paddieApi.get<PlaygroundConversation[]>("/playground/conversations"))
  }

  const refresh = async () => {
    setLoading(true)
    setError(undefined)
    try {
      await Promise.all([loadApiKeys(), loadModels(), loadKnowledgeBases(), loadConversations()])
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const regenerateApiKey = async () => {
    const key = selectedApiKey()
    if (!key) return
    if (!window.confirm(`Regenerate API key "${key.name}"? Existing apps using the old key will stop working.`)) return
    setRegenerating(true)
    setError(undefined)
    try {
      const secret = await paddieApi.post<PaddieApiKeySecret>(`/users/me/api-keys/${encodeURIComponent(key.id)}/regenerate`)
      setRevealedApiKey(secret.apiKey)
      setManualApiKey("")
      await loadApiKeys()
      showToast({ title: "API key regenerated", description: "The playground can use the new key now. Copy it if you need it elsewhere." })
    } catch (err) {
      setError(err)
    } finally {
      setRegenerating(false)
    }
  }

  const createAttachApiKey = async () => {
    const secret = await paddieApi.post<PaddieApiKeySecret>("/users/me/api-keys", {
      name: `Paddie Studio Playground ${new Date().toLocaleDateString()}`,
    })
    setRevealedApiKey(secret.apiKey)
    setManualApiKey("")
    await loadApiKeys()
    setSelectedApiKeyID(secret.id)
    return secret
  }

  const prepareAttachApiKey = async () => {
    const currentKey = activeApiKey()
    if (currentKey) {
      return {
        apiKey: currentKey,
        keyName: selectedApiKey()?.name ?? "Manual Paddie API key",
        keyPrefix: selectedApiKey()?.key_prefix,
      }
    }
    const secret = await createAttachApiKey()
    return {
      apiKey: secret.apiKey,
      keyName: secret.name,
      keyPrefix: secret.key_prefix,
    }
  }

  const copyApiKey = async () => {
    const key = activeApiKey()
    if (!key) return
    await navigator.clipboard?.writeText(key)
    showToast({ title: "API key copied" })
  }

  const newConversation = () => {
    abortController?.abort()
    setConversationID(newConversationID())
    setMessages([])
    setInput("")
    setMemories([])
    setMemoryStatus(undefined)
    setKnowledgeBaseStatus(undefined)
    setError(undefined)
    setStreaming(false)
  }

  const saveConversation = async (snapshot: PlaygroundMessage[]) => {
    if (!selectedApiKeyID() || !selectedModelID() || snapshot.length === 0) return
    await paddieApi.post("/playground/conversations", {
      apiKeyId: selectedApiKeyID(),
      model: selectedModelID(),
      messages: snapshot.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      title: snapshot.find((message) => message.role === "user")?.content.slice(0, 72) || `Conversation ${new Date().toLocaleString()}`,
    })
  }

  const loadConversation = async (conversation: PlaygroundConversation) => {
    setError(undefined)
    try {
      const detail = conversation.messages?.length
        ? conversation
        : await paddieApi.get<PlaygroundConversation>(`/playground/conversations/${encodeURIComponent(conversation.id)}`)
      setMessages(conversationMessages(detail.messages))
      setConversationID(detail.id || conversation.id || newConversationID())
      if (detail.model) setSelectedModelID(detail.model)
      if (detail.apiKeyId) setSelectedApiKeyID(detail.apiKeyId)
    } catch (err) {
      setError(err)
    }
  }

  const deleteConversation = async (conversation: PlaygroundConversation) => {
    if (!window.confirm("Delete this playground conversation?")) return
    setError(undefined)
    try {
      await paddieApi.delete(`/playground/conversations/${encodeURIComponent(conversation.id)}`)
      await loadConversations()
    } catch (err) {
      setError(err)
    }
  }

  const updateSelectedKnowledgeBase = (id: string, checked: boolean) => {
    setSelectedKnowledgeBaseIDs((current) =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter((item) => item !== id),
    )
  }

  const attachPlayground = (config: PlaygroundAttachConfig) => {
    const sampleQuery =
      input().trim() ||
      messages().slice().reverse().find((message) => message.role === "user")?.content.trim() ||
      "Integrate this Paddie Data Playground setup"
    const userIDStrategy =
      "Create or resolve a stable app-specific Paddie Memory user_id for each end user at runtime, persist the mapping in the app's auth profile, database, or local profile store, and pass that dynamic user_id on every Memory Router call."
    const allKnowledgeBases = knowledgeBaseSummaries()
    const knowledgeBaseSummariesForContext = config.knowledgeBaseMode === "all"
      ? allKnowledgeBases
      : config.knowledgeBaseMode === "selected"
        ? allKnowledgeBases.filter((kb) => config.knowledgeBaseIDs.includes(kb.id))
        : []
    const note = [
      "Build the attached Paddie Data Playground configuration into the user's app as reusable runtime code.",
      config.memoryService
        ? "Memory: call POST /memory/router with a dynamic per-user memory ID. Use it as an LLM tool/context provider, not as a static memory dump."
        : "Memory: do not add Memory Router unless the user later asks for memory.",
      config.memoryService && mode() === "router"
        ? `Default memory behavior: router mode ${routerMode()}${memoryType() ? ` with memory type hint ${memoryType()}` : ""}.`
        : config.memoryService
          ? `Default memory behavior: manual memory search with ${strategy()} strategy${memoryType() ? ` and ${memoryType()} filter` : ""}.`
          : "",
      knowledgeBaseSummariesForContext.length
        ? "Knowledge Base: query the selected knowledge bases by ID at runtime and pass retrieved chunks/citations into the LLM before rendering final answers."
        : "Knowledge Base: no KB is attached; expose a selector or leave RAG disabled until the user configures a knowledge base.",
      `Paddie API key: read ${config.paddieApiKeyEnv} from server-side environment or secret storage.`,
      `LLM runtime: use ${config.llm.provider}, read its key from ${config.llm.apiKeyEnv}, and use ${config.llm.model || config.llm.modelEnv || "a configured chat model"}. The LLM should orchestrate Memory/RAG calls and compose the final answer.`,
      "Do not include the playground transcript, returned memories, source chunks, or API key value in generated app code.",
    ].filter(Boolean)
    if (userID().trim()) note.push(`Selected explorer user ID for testing only: ${userID().trim()}`)
    if (selectedModelID()) note.push(`Playground model used while testing: ${selectedModelID()}`)
    if (persona()) note.push(`Playground persona default: ${persona()}`)

    prompt.context.add({
      type: "data-playground",
      label: "Paddie Data Playground",
      apiBase: apiBase(),
      apiKeyEnv: config.paddieApiKeyEnv,
      mode: mode(),
      userIDStrategy,
      selectedExplorerUserID: userID().trim() || undefined,
      routerMode: mode() === "router" ? routerMode() : undefined,
      strategy: mode() === "manual" ? strategy() : undefined,
      memoryType: memoryType() || undefined,
      persona: persona(),
      model: selectedModelID() || undefined,
      sampleQuery,
      conversationID: conversationID(),
      integrationNote: note.join("\n"),
      implementationCode: paddieDataPlaygroundImplementationCode({
        apiBase: apiBase(),
        apiKeyEnv: config.paddieApiKeyEnv,
        memoryService: config.memoryService,
        memoryMode: mode(),
        routerMode: mode() === "router" ? routerMode() : undefined,
        strategy: mode() === "manual" ? strategy() : undefined,
        memoryType: memoryType() || undefined,
        llm: config.llm,
        knowledgeBases: knowledgeBaseSummariesForContext,
      }),
      memoryService: config.memoryService,
      knowledgeBaseMode: config.knowledgeBaseMode,
      llm: config.llm,
      knowledgeBases: knowledgeBaseSummariesForContext,
      metadata: {
        apiKeyID: selectedApiKeyID() || undefined,
        apiKeyPrefix: selectedApiKey()?.key_prefix,
        apiKeyName: selectedApiKey()?.name,
        selectedKnowledgeBaseIDs: selectedKnowledgeBaseIDs(),
        attachedKnowledgeBaseIDs: knowledgeBaseSummariesForContext.map((kb) => kb.id),
        llmProvider: config.llm.provider,
        service: "paddie-data-playground",
      },
    })
    focusPrompt()
    showToast({ title: "Playground added", description: "The agent will use this setup to build dynamic Memory/RAG integration code." })
  }

  const openAttachWizard = async () => {
    setPreparingAttachKey(true)
    setError(undefined)
    let preparedApiKey: { apiKey: string; keyName: string; keyPrefix?: string } | undefined
    try {
      preparedApiKey = await prepareAttachApiKey()
      showToast({ title: "Paddie API key ready", description: "The attach wizard can copy it into the target app environment." })
    } catch (err) {
      setError(err)
      showToast({ title: "Could not prepare Paddie API key", description: paddieApiErrorMessage(err) })
    } finally {
      setPreparingAttachKey(false)
    }

    dialog.show(() => (
      <DialogAttachPlayground
        knowledgeBases={knowledgeBaseSummaries()}
        selectedKnowledgeBaseIDs={selectedKnowledgeBaseIDs()}
        playgroundModel={selectedModelID()}
        preparedApiKey={preparedApiKey}
        onConfirm={attachPlayground}
      />
    ))
  }

  const handlePlaygroundEvent = (
    event: Record<string, unknown>,
    appendAssistant: (content: string) => PlaygroundMessage[],
  ) => {
    const type = stringValue(event.type)
    if (type === "mode") {
      const nextMode = stringValue(event.mode)
      if (nextMode === "router" || nextMode === "manual") setMode(nextMode)
      return appendAssistant("")
    }

    if (type === "router_action") {
      setMemoryStatus((prev) => ({
        ...prev,
        action: stringValue(event.action),
        explanation: stringValue(event.explanation),
        count: numberValue(event.context_count) ?? prev?.count,
        storageQueued: Boolean(event.storage_queued),
      }))
      return appendAssistant("")
    }

    if (type === "manual_search") {
      setMemoryStatus((prev) => ({
        ...prev,
        strategy: stringValue(event.strategy),
        count: numberValue(event.count),
      }))
      return appendAssistant("")
    }

    if (type === "manual_search_error") {
      setMemoryStatus((prev) => ({
        ...prev,
        error: stringValue(event.error) || "Manual memory search failed.",
      }))
      return appendAssistant("")
    }

    if (type === "memories") {
      setMemories(arrayValue(event.memories))
      setMemoryStatus((prev) => ({
        ...prev,
        count: numberValue(event.count) ?? arrayValue(event.memories).length,
      }))
      return appendAssistant("")
    }

    if (type === "knowledge_bases") {
      setKnowledgeBaseStatus({
        count: numberValue(event.count) ?? 0,
        items: arrayValue(event.knowledge_bases),
      })
      return appendAssistant("")
    }

    if (type === "content") return appendAssistant(stringValue(event.content))

    if (type === "error") {
      setError(new Error(stringValue(event.error) || "Playground stream failed."))
      return appendAssistant("")
    }

    return appendAssistant("")
  }

  const send = async () => {
    const query = (
      promptInput?.value ||
      (document.querySelector("[data-paddie-playground-input]") as HTMLTextAreaElement | null)?.value ||
      input()
    ).trim()
    const fullApiKey = (
      manualApiKeyInput?.value ||
      (document.querySelector("[data-paddie-playground-api-key]") as HTMLInputElement | null)?.value ||
      activeApiKey()
    ).trim()
    if (!query) return
    if (!selectedApiKeyID()) {
      setError(new Error("Select an API key before using the playground."))
      return
    }
    if (!fullApiKey) {
      setError(new Error("Paste the full API key or regenerate this key before using the playground."))
      return
    }
    if (!userID().trim()) {
      setError(new Error("Enter a user ID before using the playground."))
      return
    }
    if (!selectedModelID()) {
      setError(new Error("Select a model before using the playground."))
      return
    }
    const userMessage: PlaygroundMessage = { role: "user", content: query, timestamp: new Date() }
    const assistantPlaceholder: PlaygroundMessage = { role: "assistant", content: "", timestamp: new Date() }
    const history = messages()
    const nextMessages = [...history, userMessage, assistantPlaceholder]
    const assistantIndex = nextMessages.length - 1
    let assistantContent = ""
    let snapshot = nextMessages
    setStreaming(true)
    setMessages(nextMessages)
    setInput("")
    setMemories([])
    setMemoryStatus(undefined)
    setKnowledgeBaseStatus(undefined)
    setError(undefined)
    abortController = new AbortController()
    const appendAssistant = (content: string) => {
      if (content) assistantContent += content
      snapshot = snapshot.map((message, index) =>
        index === assistantIndex
          ? { ...message, content: assistantContent, timestamp: new Date() }
          : message,
      )
      setMessages(snapshot)
      return snapshot
    }

    try {
      const stream = await playgroundChat({
        query,
        apiKey: fullApiKey,
        userId: userID().trim(),
        model: selectedModelID(),
        mode: mode(),
        routerMode: mode() === "router" ? routerMode() : undefined,
        strategy: mode() === "manual" ? strategy() : undefined,
        persona: persona(),
        knowledgeBaseIds: selectedKnowledgeBaseIDs(),
        conversationId: conversationID(),
        conversationHistory: history.slice(-10).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        signal: abortController.signal,
        memoryType: memoryType(),
      })
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const result = await reader.read()
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (!payload) continue
          try {
            const event = JSON.parse(payload) as unknown
            if (!isRecord(event)) continue
            if (event.type === "done") {
              setStreaming(false)
              await saveConversation(snapshot)
              await loadConversations()
              continue
            }
            snapshot = handlePlaygroundEvent(event, appendAssistant)
          } catch (err) {
            setError(err)
          }
        }
      }
      setStreaming(false)
      if (!assistantContent) {
        snapshot = appendAssistant("No response content was returned.")
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err)
        setMessages(history)
      }
      setStreaming(false)
    }
  }

  const stop = () => {
    abortController?.abort()
    setStreaming(false)
    setError(new Error("Playground stream stopped."))
  }

  createEffect(() => {
    if (!auth.isAuthenticated()) return
    if (initialized) return
    initialized = true
    queueMicrotask(() => void refresh())
  })

  createEffect(() => {
    const user = auth.user()
    if (user?.userId && !userID()) setUserID(user.userId)
  })

  createEffect(() => {
    selectedApiKeyID()
    setRevealedApiKey("")
    setManualApiKey("")
  })

  createEffect(() => {
    messages().length
    queueMicrotask(() => messagesEnd?.scrollIntoView({ block: "end" }))
  })

  const optionButton = <T extends string,>(current: () => T, value: T, label: string, onSelect: (value: T) => void) => (
    <button
      type="button"
      classList={{
        "rounded-lg border px-2.5 py-1.5 text-11-medium transition-colors": true,
        "border-border-weak-base bg-background-stronger text-text-base": current() === value,
        "border-border-weaker-base text-text-weak hover:text-text-base hover:bg-surface-base-hover": current() !== value,
      }}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  )

  return (
    <div class="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <div class="flex min-h-0 flex-col gap-3">
        <Panel title="Configuration">
          <div class="space-y-3">
            <Field label="API key">
              <select class={inputClass} value={selectedApiKeyID()} onChange={(event) => setSelectedApiKeyID(event.currentTarget.value)}>
                <Show when={apiKeys().length > 0} fallback={<option value="">No API keys</option>}>
                  <For each={apiKeys()}>
                    {(key) => <option value={key.id}>{key.name} ({key.key_prefix})</option>}
                  </For>
                </Show>
              </select>
              <Show when={selectedApiKey()} fallback={<Button class="mt-2 h-8 px-3 text-11-medium" onClick={props.openApiTab}>Create API key</Button>}>
                <div class="mt-2 grid gap-2">
                  <input
                    ref={manualApiKeyInput}
                    data-paddie-playground-api-key
                    class={inputClass}
                    value={manualApiKey()}
                    onInput={(event) => setManualApiKey(event.currentTarget.value)}
                    placeholder="Paste full API key for playground"
                    type="password"
                  />
                  <div class="flex flex-wrap gap-2">
                    <Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={regenerating()} onClick={() => void regenerateApiKey()}>
                      Reveal by regenerating
                    </Button>
                    <Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={!activeApiKey()} onClick={() => void copyApiKey()}>
                      Copy
                    </Button>
                  </div>
                  <Show when={revealedApiKey()}>
                    <code class="block overflow-auto rounded-lg border border-border-weaker-base bg-background-base p-2 text-11-regular text-text-base">{revealedApiKey()}</code>
                  </Show>
                </div>
              </Show>
            </Field>

            <Field label="User ID">
              <input class={inputClass} value={userID()} onInput={(event) => setUserID(event.currentTarget.value)} placeholder="End-user memory ID" />
            </Field>

            <Field label="Model">
              <select class={inputClass} value={selectedModelID()} onChange={(event) => setSelectedModelID(event.currentTarget.value)}>
                <Show when={models().length > 0} fallback={<option value="">No models</option>}>
                  <For each={models()}>
                    {(model) => <option value={model.id}>{model.name || model.id}</option>}
                  </For>
                </Show>
              </select>
              <Show when={selectedModel()?.description}>
                <div class="mt-1 text-11-medium text-text-weak">{selectedModel()?.description}</div>
              </Show>
            </Field>

            <Field label="Persona">
              <select class={inputClass} value={persona()} onChange={(event) => setPersona(event.currentTarget.value as PlaygroundPersona)}>
                <option value="default">Default assistant</option>
                <option value="pocketmoni">PocketMoni assistant</option>
              </select>
            </Field>

            <Field label="Memory mode">
              <div class="flex flex-wrap gap-2">
                {optionButton(mode, "router", "Router", setMode)}
                {optionButton(mode, "manual", "Manual", setMode)}
              </div>
            </Field>

            <Field label={mode() === "router" ? "Memory type hint" : "Memory type filter"}>
              <select class={inputClass} value={memoryType()} onChange={(event) => setMemoryType(event.currentTarget.value as PlaygroundMemoryType)}>
                <For each={memoryTypes}>
                  {(item) => <option value={item.value}>{item.label}</option>}
                </For>
              </select>
            </Field>

            <Show when={mode() === "router"}>
              <Field label="Router mode">
                <select class={inputClass} value={routerMode()} onChange={(event) => setRouterMode(event.currentTarget.value as PlaygroundRouterMode)}>
                  <For each={routerModes}>
                    {(item) => <option value={item.value}>{item.label}</option>}
                  </For>
                </select>
                <div class="mt-1 text-11-medium text-text-weak">{routerModes.find((item) => item.value === routerMode())?.description}</div>
              </Field>
            </Show>

            <Show when={mode() === "manual"}>
              <Field label="Search strategy">
                <select class={inputClass} value={strategy()} onChange={(event) => setStrategy(event.currentTarget.value as PlaygroundStrategy)}>
                  <For each={strategies}>
                    {(item) => <option value={item.value}>{item.label}</option>}
                  </For>
                </select>
                <div class="mt-1 text-11-medium text-text-weak">{strategies.find((item) => item.value === strategy())?.description}</div>
              </Field>
            </Show>
          </div>
        </Panel>

        <Panel title="History" action={<Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={newConversation}>New</Button>}>
          <Show when={conversations().length > 0} fallback={<div class="text-12-medium text-text-weak">No saved playground conversations yet.</div>}>
            <div class="max-h-64 space-y-2 overflow-auto">
              <For each={conversations()}>
                {(conversation) => (
                  <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-2.5">
                    <button type="button" class="block w-full text-left" onClick={() => void loadConversation(conversation)}>
                      <div class="truncate text-12-medium text-text-base">{conversation.title || "Playground conversation"}</div>
                      <div class="mt-1 text-11-medium text-text-weak">{dateLabel(conversation.updatedAt || conversation.createdAt)}</div>
                    </button>
                    <Button variant="ghost" class="mt-2 h-7 px-2 text-11-medium" onClick={() => void deleteConversation(conversation)}>
                      Delete
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Panel>
      </div>

      <Panel
        title="Chat Playground"
        action={
          <div class="flex items-center gap-2">
            <Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={preparingAttachKey()} onClick={() => void openAttachWizard()}>
              {preparingAttachKey() ? "Preparing key..." : "Attach playground"}
            </Button>
            <Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={loading()} onClick={() => void refresh()}>
              Refresh
            </Button>
            <Show when={streaming()}>
              <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={stop}>Stop</Button>
            </Show>
          </div>
        }
        fill
      >
        <div class="flex min-h-[560px] flex-col">
          <ErrorNotice error={error()} text={errorText()} />
          <div class="flex-1 overflow-auto rounded-xl border border-border-weaker-base bg-background-stronger p-3">
            <Show
              when={messages().length > 0}
              fallback={
                <div class="flex h-full min-h-[360px] items-center justify-center">
                  <div class="max-w-sm text-center">
                    <div class="text-14-medium text-text-base">Start a playground conversation</div>
                    <div class="mt-2 text-12-medium text-text-weak">
                      Test the same Paddie Memory and AI RAG runtime RMN uses, with selected API key, user ID, model, memory mode, and knowledge bases.
                    </div>
                  </div>
                </div>
              }
            >
              <div class="space-y-3">
                <For each={messages()}>
                  {(message, index) => (
                    <div classList={{ "flex": true, "justify-end": message.role === "user", "justify-start": message.role !== "user" }}>
                      <div
                        classList={{
                          "max-w-[82%] rounded-2xl border px-3 py-2": true,
                          "border-border-weak-base bg-surface-base text-text-base": message.role !== "user",
                          "border-border-weaker-base bg-background-base text-text-strong": message.role === "user",
                        }}
                      >
                        <div class="mb-1 text-10-medium uppercase tracking-wide text-text-weak">{message.role}</div>
                        <Show
                          when={message.content || !(streaming() && index() === messages().length - 1)}
                          fallback={<div class="text-12-medium text-text-weak">Thinking...</div>}
                        >
                          <Show
                            when={message.role === "assistant"}
                            fallback={<div class="whitespace-pre-wrap text-13-medium text-text-base">{message.content}</div>}
                          >
                            <div class="whitespace-pre-wrap text-13-regular text-text-base">{message.content}</div>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
                <div ref={messagesEnd} />
              </div>
            </Show>
          </div>
          <div class="mt-3 flex gap-2">
            <textarea
              ref={promptInput}
              data-paddie-playground-input
              class={`${inputClass} min-h-20 flex-1 py-2`}
              value={input()}
              disabled={streaming()}
              onInput={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return
                event.preventDefault()
                void send()
              }}
              placeholder="Ask Paddie Memory and AI RAG..."
            />
            <button
              type="button"
              class="h-20 rounded-xl border border-border-weaker-base bg-background-stronger px-5 text-13-medium text-text-base transition-colors hover:bg-surface-base-hover disabled:opacity-50"
              disabled={!ready()}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
          <div class="mt-2 text-11-medium text-text-weak">
            {streaming() ? "Streaming response from RMN Playground..." : `${messages().length} messages - last 10 messages are sent as conversation context.`}
          </div>
        </div>
      </Panel>

      <div class="flex min-h-0 flex-col gap-3">
        <Panel title="Knowledge bases">
          <Show when={knowledgeBases().length > 0} fallback={<div class="text-12-medium text-text-weak">No knowledge bases yet. Create one in the Knowledge Base tab.</div>}>
            <div class="max-h-72 space-y-2 overflow-auto">
              <For each={knowledgeBases()}>
                {(kb) => {
                  const id = knowledgeBaseID(kb)
                  return (
                    <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-border-weaker-base bg-background-stronger p-2.5">
                      <input
                        type="checkbox"
                        class="mt-1"
                        checked={selectedKnowledgeBaseIDs().includes(id)}
                        onChange={(event) => updateSelectedKnowledgeBase(id, event.currentTarget.checked)}
                      />
                      <span class="min-w-0">
                        <span class="block truncate text-12-medium text-text-base">{kb.name}</span>
                        <span class="text-11-medium text-text-weak">{kb.document_count ?? 0} docs - {kb.chunk_count ?? 0} chunks</span>
                      </span>
                    </label>
                  )
                }}
              </For>
            </div>
          </Show>
          <Show when={selectedKnowledgeBases().length > 0}>
            <div class="mt-2 rounded-xl border border-border-weaker-base bg-background-stronger p-2 text-11-medium text-text-weak">
              {selectedKnowledgeBases().length} selected for runtime retrieval.
            </div>
          </Show>
        </Panel>

        <Panel title="Runtime context">
          <div class="grid grid-cols-2 gap-2">
            <Metric label="Messages" value={String(Math.min(messages().length, 10))} />
            <Metric label="Memories" value={String(memories().length)} />
          </div>

          <Show when={memoryStatus()}>
            {(status) => (
              <ContextCard title="Memory router" badge={status().action || status().strategy || "checked"}>
                {status().error ||
                  status().explanation ||
                  `${status().count ?? memories().length} memories were considered for this turn.`}
                <Show when={status().storageQueued}>
                  <div class="mt-1">Background memory storage was queued.</div>
                </Show>
              </ContextCard>
            )}
          </Show>

          <Show when={knowledgeBaseStatus()}>
            {(status) => (
              <ContextCard title="AI RAG" badge={`${status().count} chunks`}>
                {selectedKnowledgeBaseIDs().length === 0
                  ? "No knowledge base was selected for this message."
                  : `${selectedKnowledgeBaseIDs().length} knowledge base${selectedKnowledgeBaseIDs().length === 1 ? "" : "s"} checked.`}
              </ContextCard>
            )}
          </Show>

          <div class="mt-3 border-t border-border-weaker-base pt-3">
            <div class="text-12-medium text-text-base">Active memories</div>
            <Show when={memories().length > 0} fallback={<div class="mt-2 text-12-medium text-text-weak">No memories returned yet.</div>}>
              <div class="mt-2 max-h-72 space-y-2 overflow-auto">
                <For each={memories()}>
                  {(memory) => (
                    <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-2.5">
                      <div class="text-12-medium text-text-base">{isRecord(memory) ? paddieMemoryLabel(memory as PaddieMemoryRecord) : memoryText(memory)}</div>
                      <Show when={isRecord(memory) && typeof memory.type === "string"}>
                        <div class="mt-1 text-11-medium text-text-weak">{String((memory as Record<string, unknown>).type)}</div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function DialogAttachPlayground(props: {
  knowledgeBases: KnowledgeBaseSummary[]
  selectedKnowledgeBaseIDs: string[]
  playgroundModel: string
  preparedApiKey?: { apiKey: string; keyName: string; keyPrefix?: string }
  onConfirm: (config: PlaygroundAttachConfig) => void
}) {
  const dialog = useDialog()
  const initialLlm = defaultPaddieDataLlmRuntime()
  const [memoryService, setMemoryService] = createSignal(true)
  const [knowledgeBaseMode, setKnowledgeBaseMode] = createSignal<PlaygroundAttachConfig["knowledgeBaseMode"]>(
    props.selectedKnowledgeBaseIDs.length > 0 ? "selected" : props.knowledgeBases.length > 0 ? "all" : "none",
  )
  const [knowledgeBaseIDs, setKnowledgeBaseIDs] = createSignal(props.selectedKnowledgeBaseIDs)
  const [paddieApiKeyEnv, setPaddieApiKeyEnv] = createSignal("PADDIE_API_KEY")
  const [llmProvider, setLlmProvider] = createSignal<PaddieDataLlmRuntimeConfig["provider"]>(initialLlm.provider)
  const [llmApiKeyEnv, setLlmApiKeyEnv] = createSignal(initialLlm.apiKeyEnv)
  const [llmModel, setLlmModel] = createSignal(initialLlm.model ?? "")
  const [llmBaseUrlEnv, setLlmBaseUrlEnv] = createSignal("")
  const [showPaddieApiKey, setShowPaddieApiKey] = createSignal(true)

  const canAttach = createMemo(() =>
    memoryService() ||
    knowledgeBaseMode() === "all" ||
    (knowledgeBaseMode() === "selected" && knowledgeBaseIDs().length > 0),
  )

  const setProvider = (provider: PaddieDataLlmRuntimeConfig["provider"]) => {
    const defaults = llmProviderDefaults(provider)
    setLlmProvider(provider)
    setLlmApiKeyEnv(defaults.apiKeyEnv)
    setLlmModel(defaults.model)
    setLlmBaseUrlEnv(defaults.baseUrlEnv ?? "")
  }

  const toggleKnowledgeBase = (id: string, checked: boolean) => {
    setKnowledgeBaseIDs((current) =>
      checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id),
    )
  }

  const copyPreparedPaddieApiKey = async () => {
    if (!props.preparedApiKey?.apiKey) return
    await navigator.clipboard?.writeText(props.preparedApiKey.apiKey)
    showToast({ title: "Paddie API key copied" })
  }

  const confirm = () => {
    const baseUrlEnv = llmBaseUrlEnv().trim()
    props.onConfirm({
      memoryService: memoryService(),
      knowledgeBaseMode: knowledgeBaseMode(),
      knowledgeBaseIDs: knowledgeBaseMode() === "all"
        ? props.knowledgeBases.map((kb) => kb.id)
        : knowledgeBaseMode() === "selected"
          ? knowledgeBaseIDs()
          : [],
      paddieApiKeyEnv: paddieApiKeyEnv().trim() || "PADDIE_API_KEY",
      paddieApiKey: props.preparedApiKey?.apiKey,
      llm: {
        provider: llmProvider(),
        apiKeyEnv: llmApiKeyEnv().trim() || llmProviderDefaults(llmProvider()).apiKeyEnv,
        model: llmModel().trim() || undefined,
        baseUrlEnv: baseUrlEnv || undefined,
      },
    })
    dialog.close()
  }

  return (
    <Dialog
      title="Attach Data Playground"
      description="Choose the runtime services the coding agent should build into this app. Secrets stay as environment variable names."
      size="large"
      class="w-full max-w-[780px] mx-auto"
      fit
    >
      <div class="space-y-4">
        <section class="rounded-xl border border-border-weaker-base bg-background-stronger p-3">
          <label class="flex items-start gap-3">
            <input
              type="checkbox"
              class="mt-1"
              checked={memoryService()}
              onChange={(event) => setMemoryService(event.currentTarget.checked)}
            />
            <span>
              <span class="block text-13-medium text-text-base">Attach Memory service</span>
              <span class="mt-1 block text-12-medium text-text-weak">
                The agent will create a dynamic per-user Memory Router integration. It will not attach individual memory records.
              </span>
            </span>
          </label>
        </section>

        <section class="rounded-xl border border-border-weaker-base bg-background-stronger p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-13-medium text-text-base">Attach Knowledge Base / graph RAG</div>
              <div class="mt-1 text-12-medium text-text-weak">Select which knowledge bases the generated app can query at runtime.</div>
            </div>
            <select
              class={`${inputClass} max-w-40`}
              value={knowledgeBaseMode()}
              onChange={(event) => setKnowledgeBaseMode(event.currentTarget.value as PlaygroundAttachConfig["knowledgeBaseMode"])}
            >
              <option value="selected">Selected</option>
              <option value="all">All</option>
              <option value="none">None</option>
            </select>
          </div>

          <Show when={knowledgeBaseMode() === "selected"}>
            <Show
              when={props.knowledgeBases.length > 0}
              fallback={<div class="mt-3 text-12-medium text-text-weak">No knowledge bases are available yet.</div>}
            >
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <For each={props.knowledgeBases}>
                  {(kb) => (
                    <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-border-weaker-base bg-background-base p-2">
                      <input
                        type="checkbox"
                        class="mt-1"
                        checked={knowledgeBaseIDs().includes(kb.id)}
                        onChange={(event) => toggleKnowledgeBase(kb.id, event.currentTarget.checked)}
                      />
                      <span class="min-w-0">
                        <span class="block truncate text-12-medium text-text-base">{kb.name}</span>
                        <span class="text-11-medium text-text-weak">{kb.documentCount ?? 0} docs - {kb.chunkCount ?? 0} chunks</span>
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>

        <section class="rounded-xl border border-border-weaker-base bg-background-stronger p-3">
          <div class="text-13-medium text-text-base">Runtime configuration</div>
          <div class="mt-3 rounded-lg border border-border-weaker-base bg-background-base p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-12-medium text-text-base">Paddie API key</div>
                <div class="mt-1 text-12-medium text-text-weak">
                  {props.preparedApiKey
                    ? `${props.preparedApiKey.keyName}${props.preparedApiKey.keyPrefix ? ` (${props.preparedApiKey.keyPrefix})` : ""} is ready for the target app.`
                    : "No Paddie API key was prepared. Create one in the API tab or retry after your plan allows API keys."}
                </div>
              </div>
              <Button
                variant="ghost"
                class="h-8 px-3 text-11-medium"
                disabled={!props.preparedApiKey?.apiKey}
                onClick={() => void copyPreparedPaddieApiKey()}
              >
                Copy key
              </Button>
            </div>
            <Show when={props.preparedApiKey?.apiKey}>
              <div class="mt-3 flex gap-2">
                <input
                  class={inputClass}
                  readOnly
                  type={showPaddieApiKey() ? "text" : "password"}
                  value={props.preparedApiKey?.apiKey ?? ""}
                />
                <Button variant="ghost" class="h-10 px-3 text-11-medium" onClick={() => setShowPaddieApiKey((value) => !value)}>
                  {showPaddieApiKey() ? "Hide" : "Reveal"}
                </Button>
              </div>
            </Show>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Paddie API env">
              <input class={inputClass} value={paddieApiKeyEnv()} onInput={(event) => setPaddieApiKeyEnv(event.currentTarget.value)} />
            </Field>
            <Field label="LLM provider">
              <select
                class={inputClass}
                value={llmProvider()}
                onChange={(event) => setProvider(event.currentTarget.value as PaddieDataLlmRuntimeConfig["provider"])}
              >
                <For each={llmProviders}>
                  {(provider) => <option value={provider.value}>{provider.label}</option>}
                </For>
              </select>
            </Field>
            <Field label="LLM key env">
              <input class={inputClass} value={llmApiKeyEnv()} onInput={(event) => setLlmApiKeyEnv(event.currentTarget.value)} />
            </Field>
            <Field label="Default model">
              <input
                class={inputClass}
                value={llmModel()}
                onInput={(event) => setLlmModel(event.currentTarget.value)}
                placeholder={props.playgroundModel || "gpt-4.1-mini"}
              />
            </Field>
            <Show when={llmProviderDefaults(llmProvider()).baseUrlEnv}>
              <Field label="Base URL env">
                <input class={inputClass} value={llmBaseUrlEnv()} onInput={(event) => setLlmBaseUrlEnv(event.currentTarget.value)} />
              </Field>
            </Show>
          </div>
          <div class="mt-3 rounded-lg border border-border-weaker-base bg-background-base p-2 text-12-medium text-text-weak">
            The generated app should call the LLM from trusted server code. Paddie Memory and Knowledge Base provide context; the LLM decides when to call them and writes the final response.
          </div>
        </section>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" class="h-9 px-4 text-12-medium" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button class="h-9 px-4 text-12-medium" disabled={!canAttach()} onClick={confirm}>
            Attach to chat
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function Panel(props: { title: string; action?: JSX.Element; children: JSX.Element; fill?: boolean }) {
  return (
    <div
      classList={{
        "rounded-[20px] border border-border-weaker-base bg-surface-base p-4": true,
        "min-h-0": props.fill,
      }}
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="text-14-medium text-text-base">{props.title}</div>
        {props.action}
      </div>
      {props.children}
    </div>
  )
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="block">
      <div class="mb-1.5 text-11-medium uppercase tracking-wide text-text-weak">{props.label}</div>
      {props.children}
    </label>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-2.5">
      <div class="text-10-medium uppercase tracking-wide text-text-weak">{props.label}</div>
      <div class="mt-1 text-16-medium text-text-base">{props.value}</div>
    </div>
  )
}

function ContextCard(props: { title: string; badge: string; children: JSX.Element }) {
  return (
    <div class="mt-3 rounded-xl border border-border-weaker-base bg-background-stronger p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-12-medium text-text-base">{props.title}</div>
        <div class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium uppercase text-text-weak">{props.badge}</div>
      </div>
      <div class="mt-2 text-12-medium text-text-weak">{props.children}</div>
    </div>
  )
}

function ErrorNotice(props: { error: unknown; text: string }) {
  return (
    <Show when={props.error}>
      <div class="mb-3 rounded-xl border border-border-weaker-base bg-background-stronger p-3">
        <div class="text-12-medium text-text-base">Playground issue</div>
        <div class="mt-1 text-12-medium text-text-weak">{props.text}</div>
      </div>
    </Show>
  )
}
