import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useAuth } from "@/context/auth"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { paddieApi, paddieApiErrorMessage, UpgradeRequiredError } from "@/lib/paddie-api"
import {
  fileToBase64,
  knowledgeBaseID,
  paddieMemoryLabel,
  paddieMemoryText,
  sourceChunkText,
  type PaddieApiKey,
  type PaddieApiKeySecret,
  type PaddieKnowledgeBase,
  type PaddieKnowledgeBaseApiDetail,
  type PaddieKnowledgeBaseDocument,
  type PaddieKnowledgeBaseQueryResult,
  type PaddieMemoryList,
  type PaddieMemoryRecord,
  type PaddieMemoryRouterResponse,
  type PaddieMemoryUser,
} from "@/paddie-data/helpers"

type DataSection = "memory" | "knowledge" | "api"
type RouterMode = "auto" | "conversation" | "store" | "retrieve"
type MemoryType = "" | "short_term" | "episodic" | "semantic" | "procedural" | "preference" | "working" | "summary" | "artifact"

type PaddieWindow = Window & {
  __PADDIE_API_URL?: string
}

const memoryTypes: MemoryType[] = ["", "semantic", "episodic", "procedural", "preference", "short_term", "working", "summary", "artifact"]
const routerModes: RouterMode[] = ["auto", "conversation", "store", "retrieve"]

const apiBase = () =>
  typeof window !== "undefined" && (window as PaddieWindow).__PADDIE_API_URL
    ? (window as PaddieWindow).__PADDIE_API_URL!
    : import.meta.env.VITE_PADDIE_API_URL ?? "https://api.paddie.io/api"

const trimText = (value: string, max = 2_000) => {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[Truncated after ${max} characters.]`
}

const isoDate = (value: string | number | undefined) => {
  if (!value) return ""
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

export function PaddieDataPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const auth = useAuth()
  const platform = usePlatform()
  const prompt = usePrompt()
  const [section, setSection] = createSignal<DataSection>("memory")

  const [memoryUsers, setMemoryUsers] = createSignal<PaddieMemoryUser[]>([])
  const [memoryUserID, setMemoryUserID] = createSignal(auth.user()?.userId ?? "")
  const [memorySearch, setMemorySearch] = createSignal("")
  const [memoryType, setMemoryType] = createSignal<MemoryType>("")
  const [memories, setMemories] = createSignal<PaddieMemoryList>()
  const [memoryLoading, setMemoryLoading] = createSignal(false)
  const [memoryError, setMemoryError] = createSignal<unknown>()
  const [newMemory, setNewMemory] = createSignal("")
  const [newMemoryType, setNewMemoryType] = createSignal<MemoryType>("")
  const [routerQuery, setRouterQuery] = createSignal("")
  const [routerMode, setRouterMode] = createSignal<RouterMode>("auto")
  const [routerResult, setRouterResult] = createSignal<PaddieMemoryRouterResponse>()

  const [knowledgeBases, setKnowledgeBases] = createSignal<PaddieKnowledgeBase[]>([])
  const [selectedKnowledgeBaseID, setSelectedKnowledgeBaseID] = createSignal("")
  const [kbDocuments, setKbDocuments] = createSignal<PaddieKnowledgeBaseDocument[]>([])
  const [kbLoading, setKbLoading] = createSignal(false)
  const [kbError, setKbError] = createSignal<unknown>()
  const [newKbName, setNewKbName] = createSignal("")
  const [newKbDescription, setNewKbDescription] = createSignal("")
  const [documentText, setDocumentText] = createSignal("")
  const [documentName, setDocumentName] = createSignal("")
  const [documentFile, setDocumentFile] = createSignal<File>()
  const [kbQuery, setKbQuery] = createSignal("")
  const [kbQueryResult, setKbQueryResult] = createSignal<PaddieKnowledgeBaseQueryResult>()
  const [kbApiDetail, setKbApiDetail] = createSignal<PaddieKnowledgeBaseApiDetail>()

  const [apiKeys, setApiKeys] = createSignal<PaddieApiKey[]>([])
  const [apiKeyName, setApiKeyName] = createSignal("Paddie Studio integration")
  const [apiSecret, setApiSecret] = createSignal<PaddieApiKeySecret>()
  const [apiLoading, setApiLoading] = createSignal(false)
  const [apiError, setApiError] = createSignal<unknown>()
  let initialized = false

  const selectedKnowledgeBase = createMemo(() => knowledgeBases().find((item) => knowledgeBaseID(item) === selectedKnowledgeBaseID()))
  const memoryErrorText = createMemo(() => memoryError() ? paddieApiErrorMessage(memoryError()) : "")
  const kbErrorText = createMemo(() => kbError() ? paddieApiErrorMessage(kbError()) : "")
  const apiErrorText = createMemo(() => apiError() ? paddieApiErrorMessage(apiError()) : "")

  const focusPrompt = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const loadMemoryUsers = async () => {
    const users = await paddieApi.get<PaddieMemoryUser[]>("/memories/users")
    setMemoryUsers(users)
    if (!memoryUserID() && users[0]?.user_id) setMemoryUserID(users[0].user_id)
  }

  const loadMemories = async () => {
    const userID = memoryUserID().trim()
    if (!userID) {
      setMemoryError(new Error("Enter a user ID to load memories."))
      return
    }
    setMemoryLoading(true)
    setMemoryError(undefined)
    try {
      const params = new URLSearchParams({
        userId: userID,
        limit: "25",
        page: "1",
      })
      if (memorySearch().trim()) params.set("search", memorySearch().trim())
      if (memoryType()) params.set("type", memoryType())
      setMemories(await paddieApi.get<PaddieMemoryList>(`/memories?${params.toString()}`))
    } catch (err) {
      setMemoryError(err)
    } finally {
      setMemoryLoading(false)
    }
  }

  const createMemory = async () => {
    const content = newMemory().trim()
    const userID = memoryUserID().trim()
    if (!content || !userID) return
    setMemoryLoading(true)
    setMemoryError(undefined)
    try {
      await paddieApi.post<PaddieMemoryRecord>("/memories", {
        content,
        user_id: userID,
        type: newMemoryType() || undefined,
      })
      setNewMemory("")
      showToast({ title: "Memory saved", description: "RMN indexed the memory for this user." })
      await loadMemories()
      await loadMemoryUsers().catch(() => undefined)
    } catch (err) {
      setMemoryError(err)
    } finally {
      setMemoryLoading(false)
    }
  }

  const runMemoryRouter = async () => {
    const query = routerQuery().trim()
    const userID = memoryUserID().trim()
    if (!query || !userID) return
    setMemoryLoading(true)
    setMemoryError(undefined)
    try {
      setRouterResult(await paddieApi.post<PaddieMemoryRouterResponse>("/memory/router", {
        query,
        user_id: userID,
        mode: routerMode(),
        include_analysis: true,
        options: { k: 10, threshold: 0.5 },
      }))
    } catch (err) {
      setMemoryError(err)
    } finally {
      setMemoryLoading(false)
    }
  }

  const attachMemory = (memory: PaddieMemoryRecord) => {
    const text = paddieMemoryText(memory)
    prompt.context.add({
      type: "memory",
      userID: memory.user_id || memoryUserID().trim(),
      mode: "memory",
      label: paddieMemoryLabel(memory),
      content: trimText(text || "Memory record attached without text."),
      memoryType: memory.type,
      metadata: memory.metadata,
      memories: [memory],
    })
    focusPrompt()
    showToast({ title: "Memory added to chat", description: paddieMemoryLabel(memory) })
  }

  const attachRouterResult = () => {
    const result = routerResult()
    if (!result) return
    const context = (result.context ?? []).map((item): PaddieMemoryRecord => ({
      memory: item.memory,
      type: item.type,
      metadata: { relevance: item.relevance, source: item.source },
      user_id: memoryUserID().trim(),
    }))
    const records = [...(result.memories ?? []), ...context]
    prompt.context.add({
      type: "memory",
      userID: memoryUserID().trim(),
      mode: "router",
      label: "Memory Router result",
      query: routerQuery().trim(),
      content: trimText([
        result.explanation,
        ...records.map((item, index) => `${index + 1}. ${paddieMemoryText(item) || item.memory || item.content || "Memory"}`),
      ].filter(Boolean).join("\n")),
      metadata: result.metadata,
      memories: records,
    })
    focusPrompt()
    showToast({ title: "Memory Router result added", description: routerQuery().trim() })
  }

  const loadKnowledgeBases = async () => {
    setKbLoading(true)
    setKbError(undefined)
    try {
      const items = await paddieApi.get<PaddieKnowledgeBase[]>("/knowledge-bases")
      setKnowledgeBases(items)
      if (!selectedKnowledgeBaseID() && items[0]) setSelectedKnowledgeBaseID(knowledgeBaseID(items[0]))
    } catch (err) {
      setKbError(err)
    } finally {
      setKbLoading(false)
    }
  }

  const loadKnowledgeBaseDocuments = async (id = selectedKnowledgeBaseID()) => {
    if (!id) {
      setKbDocuments([])
      return
    }
    try {
      setKbDocuments(await paddieApi.get<PaddieKnowledgeBaseDocument[]>(`/knowledge-bases/${encodeURIComponent(id)}/documents`))
    } catch (err) {
      setKbError(err)
    }
  }

  const loadKnowledgeBaseApi = async (id = selectedKnowledgeBaseID()) => {
    if (!id) {
      setKbApiDetail(undefined)
      return
    }
    try {
      setKbApiDetail(await paddieApi.get<PaddieKnowledgeBaseApiDetail>(`/knowledge-bases/${encodeURIComponent(id)}/api`))
    } catch (err) {
      setKbError(err)
    }
  }

  const createKnowledgeBase = async () => {
    const name = newKbName().trim()
    if (!name) return
    setKbLoading(true)
    setKbError(undefined)
    try {
      const kb = await paddieApi.post<PaddieKnowledgeBase>("/knowledge-bases", {
        name,
        description: newKbDescription().trim() || undefined,
        visibility: "private",
      })
      setNewKbName("")
      setNewKbDescription("")
      setSelectedKnowledgeBaseID(knowledgeBaseID(kb))
      showToast({ title: "Knowledge base created", description: kb.name })
      await loadKnowledgeBases()
    } catch (err) {
      setKbError(err)
    } finally {
      setKbLoading(false)
    }
  }

  const uploadKnowledgeDocument = async () => {
    const id = selectedKnowledgeBaseID()
    const file = documentFile()
    const content = documentText().trim()
    if (!id || (!file && !content)) return
    setKbLoading(true)
    setKbError(undefined)
    try {
      await paddieApi.post(`/knowledge-bases/${encodeURIComponent(id)}/documents`, file
        ? {
            name: documentName().trim() || file.name,
            contentBase64: await fileToBase64(file),
            contentType: file.type || "application/octet-stream",
          }
        : {
            name: documentName().trim() || "Pasted knowledge",
            content,
            contentType: "text/plain",
          })
      setDocumentFile(undefined)
      setDocumentName("")
      setDocumentText("")
      showToast({ title: "Document indexed", description: "The knowledge base is ready for RAG queries." })
      await Promise.all([loadKnowledgeBases(), loadKnowledgeBaseDocuments(id)])
    } catch (err) {
      setKbError(err)
    } finally {
      setKbLoading(false)
    }
  }

  const queryKnowledgeBase = async () => {
    const id = selectedKnowledgeBaseID()
    const query = kbQuery().trim()
    if (!id || !query) return
    setKbLoading(true)
    setKbError(undefined)
    try {
      setKbQueryResult(await paddieApi.post<PaddieKnowledgeBaseQueryResult>(`/knowledge-bases/${encodeURIComponent(id)}/query`, {
        query,
        limit: 8,
        generateAnswer: true,
        includeGraph: true,
      }))
    } catch (err) {
      setKbError(err)
    } finally {
      setKbLoading(false)
    }
  }

  const attachKnowledgeBaseResult = () => {
    const kb = selectedKnowledgeBase()
    const result = kbQueryResult()
    if (!kb || !result) return
    prompt.context.add({
      type: "knowledge-base",
      knowledgeBaseID: knowledgeBaseID(kb),
      knowledgeBaseName: kb.name,
      mode: "query",
      label: kbQuery().trim() || "Knowledge Base query",
      query: kbQuery().trim(),
      answer: result.answer ?? undefined,
      sources: result.results,
    })
    focusPrompt()
    showToast({ title: "RAG result added to chat", description: kb.name })
  }

  const attachMemoryApiNote = () => {
    const userID = memoryUserID().trim() || "<USER_ID>"
    const snippet = [
      `POST ${apiBase()}/memory/router`,
      `Authorization: Bearer <PADDIE_API_KEY>`,
      "",
      JSON.stringify({ query: "What should this app remember?", user_id: userID, mode: "conversation" }, null, 2),
    ].join("\n")
    prompt.context.add({
      type: "memory",
      userID,
      mode: "api",
      label: "Paddie Memory API",
      endpoint: "POST /memory/router",
      query: "Integrate Paddie Memory",
      content: snippet,
    })
    focusPrompt()
    showToast({ title: "Memory API note added", description: "The agent will use the Paddie data integration skill." })
  }

  const attachKnowledgeBaseApiNote = () => {
    const kb = selectedKnowledgeBase()
    const detail = kbApiDetail()
    if (!kb || !detail) return
    prompt.context.add({
      type: "knowledge-base",
      knowledgeBaseID: detail.knowledge_base_id,
      knowledgeBaseName: kb.name,
      mode: "api",
      label: "Knowledge Base API",
      query: "Integrate Paddie AI RAG",
      apiNote: detail.curl,
    })
    focusPrompt()
    showToast({ title: "RAG API note added", description: kb.name })
  }

  const loadApiKeys = async () => {
    setApiLoading(true)
    setApiError(undefined)
    try {
      setApiKeys(await paddieApi.get<PaddieApiKey[]>("/users/me/api-keys"))
    } catch (err) {
      setApiError(err)
    } finally {
      setApiLoading(false)
    }
  }

  const createApiKey = async () => {
    const name = apiKeyName().trim()
    if (!name) return
    setApiLoading(true)
    setApiError(undefined)
    try {
      const secret = await paddieApi.post<PaddieApiKeySecret>("/users/me/api-keys", { name })
      setApiSecret(secret)
      showToast({ title: "API key created", description: "Copy it now. It will not be shown again." })
      await loadApiKeys()
    } catch (err) {
      setApiError(err)
    } finally {
      setApiLoading(false)
    }
  }

  const regenerateApiKey = async (id: string) => {
    setApiLoading(true)
    setApiError(undefined)
    try {
      const secret = await paddieApi.post<PaddieApiKeySecret>(`/users/me/api-keys/${encodeURIComponent(id)}/regenerate`)
      setApiSecret(secret)
      showToast({ title: "API key regenerated", description: "Copy the new key now. It will not be shown again." })
      await loadApiKeys()
    } catch (err) {
      setApiError(err)
    } finally {
      setApiLoading(false)
    }
  }

  const deleteApiKey = async (id: string) => {
    setApiLoading(true)
    setApiError(undefined)
    try {
      await paddieApi.delete(`/users/me/api-keys/${encodeURIComponent(id)}`)
      showToast({ title: "API key revoked" })
      await loadApiKeys()
    } catch (err) {
      setApiError(err)
    } finally {
      setApiLoading(false)
    }
  }

  const copy = async (value: string, title = "Copied") => {
    await navigator.clipboard?.writeText(value)
    showToast({ title })
  }

  createEffect(() => {
    if (!auth.isAuthenticated()) return
    if (initialized) return
    initialized = true
    queueMicrotask(() => {
      void Promise.allSettled([loadMemoryUsers(), loadKnowledgeBases(), loadApiKeys()]).then(() => loadMemories())
    })
  })

  createEffect(() => {
    const id = selectedKnowledgeBaseID()
    if (!id) return
    void Promise.allSettled([loadKnowledgeBaseDocuments(id), loadKnowledgeBaseApi(id)])
  })

  const tab = (value: DataSection, label: string) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-colors": true,
        "bg-background-stronger text-text-strong shadow-xs-border": section() === value,
        "text-text-weak hover:text-text-base hover:bg-surface-base-hover": section() !== value,
      }}
      onClick={() => setSection(value)}
    >
      {label}
    </button>
  )

  return (
    <div class="min-h-full w-full bg-background-base">
      <div class="flex min-h-full flex-col gap-3">
        <div class="rounded-[20px] border border-border-weaker-base bg-surface-base px-4 py-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0">
              <div class="text-15-medium text-text-base">Paddie Data</div>
              <div class="mt-1 text-12-medium text-text-weak">Memory, AI RAG, and API keys from your Paddie account.</div>
            </div>
            <div class="rounded-xl border border-border-weaker-base bg-background-base p-1 flex items-center gap-1">
              {tab("memory", "Memory")}
              {tab("knowledge", "Knowledge Base")}
              {tab("api", "API")}
            </div>
          </div>
        </div>

        <Show when={section() === "memory"}>
          <div class="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <Panel title="Memory explorer" action={<Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={memoryLoading()} onClick={() => void loadMemories()}>Refresh</Button>}>
              <div class="grid gap-2 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_150px]">
                <input class={inputClass} value={memoryUserID()} onInput={(event) => setMemoryUserID(event.currentTarget.value)} placeholder="user_id" />
                <input class={inputClass} value={memorySearch()} onInput={(event) => setMemorySearch(event.currentTarget.value)} placeholder="Search memories" />
                <select class={inputClass} value={memoryType()} onChange={(event) => setMemoryType(event.currentTarget.value as MemoryType)}>
                  <For each={memoryTypes}>{(type) => <option value={type}>{type || "All types"}</option>}</For>
                </select>
              </div>
              <Show when={memoryUsers().length > 0}>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <For each={memoryUsers().slice(0, 8)}>
                    {(user) => (
                      <button
                        type="button"
                        class="rounded-lg border border-border-weaker-base px-2 py-1 text-11-medium text-text-weak hover:text-text-base"
                        onClick={() => {
                          setMemoryUserID(user.user_id)
                          void loadMemories()
                        }}
                      >
                        {user.user_id} - {user.count}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <ErrorNotice error={memoryError()} text={memoryErrorText()} openPlans={() => platform.openLink("https://paddie.io/pricing")} />
              <div class="mt-3 divide-y divide-border-weaker-base overflow-hidden rounded-xl border border-border-weaker-base">
                <Show when={!memoryLoading()} fallback={<div class="p-4 text-12-medium text-text-weak">Loading memories...</div>}>
                  <Show when={(memories()?.items.length ?? 0) > 0} fallback={<div class="p-4 text-12-medium text-text-weak">No memories found for this user.</div>}>
                    <For each={memories()?.items ?? []}>
                      {(memory) => (
                        <div class="bg-background-stronger p-3">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="text-13-medium text-text-base">{paddieMemoryLabel(memory)}</div>
                              <div class="mt-1 flex flex-wrap gap-2 text-11-medium text-text-weak">
                                <span>{memory.type || "memory"}</span>
                                <Show when={memory.created_at}><span>{isoDate(memory.created_at)}</span></Show>
                              </div>
                            </div>
                            <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attachMemory(memory)}>
                              Attach
                            </Button>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </Show>
              </div>
            </Panel>

            <div class="flex flex-col gap-3">
              <Panel title="Create memory">
                <textarea class={`${inputClass} min-h-24 py-2`} value={newMemory()} onInput={(event) => setNewMemory(event.currentTarget.value)} placeholder="Store a memory for this user" />
                <div class="mt-2 flex flex-wrap gap-2">
                  <select class={`${inputClass} max-w-[180px]`} value={newMemoryType()} onChange={(event) => setNewMemoryType(event.currentTarget.value as MemoryType)}>
                    <For each={memoryTypes}>{(type) => <option value={type}>{type || "Auto type"}</option>}</For>
                  </select>
                  <Button class="h-9 px-3 text-12-medium" disabled={!newMemory().trim() || !memoryUserID().trim() || memoryLoading()} onClick={() => void createMemory()}>
                    Save memory
                  </Button>
                </div>
              </Panel>
              <Panel title="Memory Router">
                <textarea class={`${inputClass} min-h-20 py-2`} value={routerQuery()} onInput={(event) => setRouterQuery(event.currentTarget.value)} placeholder="Ask, store, retrieve, summarize, or update memory" />
                <div class="mt-2 flex flex-wrap gap-2">
                  <select class={`${inputClass} max-w-[170px]`} value={routerMode()} onChange={(event) => setRouterMode(event.currentTarget.value as RouterMode)}>
                    <For each={routerModes}>{(mode) => <option value={mode}>{mode}</option>}</For>
                  </select>
                  <Button class="h-9 px-3 text-12-medium" disabled={!routerQuery().trim() || !memoryUserID().trim() || memoryLoading()} onClick={() => void runMemoryRouter()}>
                    Run router
                  </Button>
                  <Button variant="ghost" class="h-9 px-3 text-12-medium" disabled={!routerResult()} onClick={attachRouterResult}>
                    Attach result
                  </Button>
                </div>
                <Show when={routerResult()}>
                  {(result) => (
                    <pre class="mt-3 max-h-72 overflow-auto rounded-xl border border-border-weaker-base bg-background-stronger p-3 text-11-regular text-text-weak whitespace-pre-wrap">{JSON.stringify(result(), null, 2)}</pre>
                  )}
                </Show>
              </Panel>
            </div>
          </div>
        </Show>

        <Show when={section() === "knowledge"}>
          <div class="grid gap-3 xl:grid-cols-[330px_minmax(0,1fr)]">
            <Panel title="Knowledge bases" action={<Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={kbLoading()} onClick={() => void loadKnowledgeBases()}>Refresh</Button>}>
              <ErrorNotice error={kbError()} text={kbErrorText()} openPlans={() => platform.openLink("https://paddie.io/pricing")} />
              <div class="space-y-2">
                <For each={knowledgeBases()}>
                  {(kb) => {
                    const id = knowledgeBaseID(kb)
                    return (
                      <button
                        type="button"
                        classList={{
                          "w-full rounded-xl border p-3 text-left transition-colors": true,
                          "border-border-weak-base bg-background-stronger": selectedKnowledgeBaseID() === id,
                          "border-border-weaker-base hover:bg-surface-base-hover": selectedKnowledgeBaseID() !== id,
                        }}
                        onClick={() => setSelectedKnowledgeBaseID(id)}
                      >
                        <div class="text-13-medium text-text-base">{kb.name}</div>
                        <div class="mt-1 text-11-medium text-text-weak">{kb.document_count ?? 0} docs - {kb.chunk_count ?? 0} chunks</div>
                      </button>
                    )
                  }}
                </For>
              </div>
              <div class="mt-4 border-t border-border-weaker-base pt-4">
                <input class={inputClass} value={newKbName()} onInput={(event) => setNewKbName(event.currentTarget.value)} placeholder="New knowledge base name" />
                <textarea class={`${inputClass} mt-2 min-h-16 py-2`} value={newKbDescription()} onInput={(event) => setNewKbDescription(event.currentTarget.value)} placeholder="Optional description" />
                <Button class="mt-2 h-9 w-full justify-center text-12-medium" disabled={!newKbName().trim() || kbLoading()} onClick={() => void createKnowledgeBase()}>
                  Create knowledge base
                </Button>
              </div>
            </Panel>

            <div class="flex flex-col gap-3">
              <Panel title={selectedKnowledgeBase()?.name ?? "Select a knowledge base"}>
                <div class="grid gap-3 lg:grid-cols-2">
                  <div>
                    <div class="text-12-medium text-text-base">Upload or paste a document</div>
                    <input class={`${inputClass} mt-2`} value={documentName()} onInput={(event) => setDocumentName(event.currentTarget.value)} placeholder="Document name" />
                    <input
                      type="file"
                      class="mt-2 block w-full text-12-medium text-text-weak file:mr-3 file:rounded-lg file:border file:border-border-weaker-base file:bg-background-stronger file:px-3 file:py-2 file:text-12-medium file:text-text-base"
                      onChange={(event) => setDocumentFile(event.currentTarget.files?.[0])}
                    />
                    <textarea class={`${inputClass} mt-2 min-h-24 py-2`} value={documentText()} onInput={(event) => setDocumentText(event.currentTarget.value)} placeholder="Or paste text to index" />
                    <Button class="mt-2 h-9 px-3 text-12-medium" disabled={!selectedKnowledgeBaseID() || (!documentFile() && !documentText().trim()) || kbLoading()} onClick={() => void uploadKnowledgeDocument()}>
                      Index document
                    </Button>
                  </div>
                  <div>
                    <div class="text-12-medium text-text-base">Documents</div>
                    <div class="mt-2 max-h-60 divide-y divide-border-weaker-base overflow-auto rounded-xl border border-border-weaker-base">
                      <Show when={kbDocuments().length > 0} fallback={<div class="p-3 text-12-medium text-text-weak">No documents indexed yet.</div>}>
                        <For each={kbDocuments()}>
                          {(doc) => (
                            <div class="bg-background-stronger p-3">
                              <div class="text-12-medium text-text-base">{doc.name}</div>
                              <div class="mt-1 text-11-medium text-text-weak">{doc.chunk_count ?? 0} chunks - {doc.status ?? "indexed"}</div>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Query RAG">
                <textarea class={`${inputClass} min-h-20 py-2`} value={kbQuery()} onInput={(event) => setKbQuery(event.currentTarget.value)} placeholder="Ask this knowledge base a question" />
                <div class="mt-2 flex flex-wrap gap-2">
                  <Button class="h-9 px-3 text-12-medium" disabled={!selectedKnowledgeBaseID() || !kbQuery().trim() || kbLoading()} onClick={() => void queryKnowledgeBase()}>
                    Query
                  </Button>
                  <Button variant="ghost" class="h-9 px-3 text-12-medium" disabled={!kbQueryResult()} onClick={attachKnowledgeBaseResult}>
                    Attach result
                  </Button>
                  <Button variant="ghost" class="h-9 px-3 text-12-medium" disabled={!kbApiDetail()} onClick={attachKnowledgeBaseApiNote}>
                    Attach API note
                  </Button>
                </div>
                <Show when={kbQueryResult()}>
                  {(result) => (
                    <div class="mt-3 rounded-xl border border-border-weaker-base bg-background-stronger p-3">
                      <div class="text-12-medium text-text-base">{result().answer || "No generated answer returned."}</div>
                      <Show when={sourceChunkText(result()).trim()}>
                        {(text) => <pre class="mt-3 max-h-60 overflow-auto text-11-regular text-text-weak whitespace-pre-wrap">{text()}</pre>}
                      </Show>
                    </div>
                  )}
                </Show>
              </Panel>
            </div>
          </div>
        </Show>

        <Show when={section() === "api"}>
          <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel title="API keys" action={<Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={apiLoading()} onClick={() => void loadApiKeys()}>Refresh</Button>}>
              <ErrorNotice error={apiError()} text={apiErrorText()} openPlans={() => platform.openLink("https://paddie.io/pricing")} />
              <div class="flex gap-2">
                <input class={inputClass} value={apiKeyName()} onInput={(event) => setApiKeyName(event.currentTarget.value)} placeholder="API key name" />
                <Button class="h-10 px-3 text-12-medium" disabled={!apiKeyName().trim() || apiLoading()} onClick={() => void createApiKey()}>
                  Create key
                </Button>
              </div>
              <Show when={apiSecret()}>
                {(secret) => (
                  <div class="mt-3 rounded-xl border border-border-weak-base bg-background-stronger p-3">
                    <div class="text-12-medium text-text-base">Copy this key now. It will not be shown again.</div>
                    <code class="mt-2 block overflow-auto rounded-lg border border-border-weaker-base bg-background-base p-2 text-11-regular text-text-base">{secret().apiKey}</code>
                    <Button variant="ghost" class="mt-2 h-8 px-3 text-11-medium" onClick={() => void copy(secret().apiKey, "API key copied")}>
                      Copy key
                    </Button>
                  </div>
                )}
              </Show>
              <div class="mt-3 divide-y divide-border-weaker-base overflow-hidden rounded-xl border border-border-weaker-base">
                <For each={apiKeys()}>
                  {(key) => (
                    <div class="flex items-center justify-between gap-3 bg-background-stronger p-3">
                      <div class="min-w-0">
                        <div class="text-13-medium text-text-base">{key.name}</div>
                        <div class="mt-1 text-11-medium text-text-weak">{key.key_prefix} - {key.usage_count ?? 0} calls</div>
                      </div>
                      <div class="flex gap-2">
                        <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void regenerateApiKey(key.id)}>Regenerate</Button>
                        <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void deleteApiKey(key.id)}>Delete</Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Panel>
            <Panel title="Integration snippets">
              <div class="space-y-3">
                <Snippet title="Memory Router" text={`fetch("${apiBase()}/memory/router", {\n  method: "POST",\n  headers: {\n    "content-type": "application/json",\n    "x-api-key": process.env.PADDIE_API_KEY\n  },\n  body: JSON.stringify({\n    query: "Remember that this user prefers concise UI",\n    user_id: "${memoryUserID() || "<USER_ID>"}",\n    mode: "conversation"\n  })\n})`} copy={copy} attach={attachMemoryApiNote} />
                <Snippet title="Knowledge Base Query" text={`fetch("${apiBase()}/knowledge-bases/${selectedKnowledgeBaseID() || "<KB_ID>"}/query", {\n  method: "POST",\n  headers: {\n    "content-type": "application/json",\n    "x-api-key": process.env.PADDIE_API_KEY\n  },\n  body: JSON.stringify({\n    query: "What does this document say?",\n    limit: 8,\n    generateAnswer: true,\n    includeGraph: true\n  })\n})`} copy={copy} attach={kbApiDetail() ? attachKnowledgeBaseApiNote : undefined} />
              </div>
            </Panel>
          </div>
        </Show>
      </div>
    </div>
  )
}

const inputClass =
  "h-10 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-13-medium text-text-base outline-none transition-colors placeholder:text-text-weak focus:border-border-weak-base"

function Panel(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="rounded-[20px] border border-border-weaker-base bg-surface-base p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="text-14-medium text-text-base">{props.title}</div>
        {props.action}
      </div>
      {props.children}
    </div>
  )
}

function ErrorNotice(props: { error: unknown; text: string; openPlans: VoidFunction }) {
  return (
    <Show when={props.error}>
      <div class="my-3 rounded-xl border border-border-weaker-base bg-background-stronger p-3">
        <div class="flex items-start gap-2">
          <Icon name="warning" class="mt-0.5 size-3.5 text-icon-critical-base" />
          <div class="min-w-0 flex-1">
            <div class="text-12-medium text-text-base">{props.text}</div>
            <Show when={props.error instanceof UpgradeRequiredError}>
              <Button variant="ghost" class="mt-2 h-8 px-3 text-11-medium" onClick={props.openPlans}>
                View plans
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

function Snippet(props: { title: string; text: string; copy: (value: string, title?: string) => Promise<void>; attach?: VoidFunction }) {
  return (
    <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-12-medium text-text-base">{props.title}</div>
        <div class="flex gap-2">
          <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void props.copy(props.text, "Snippet copied")}>Copy</Button>
          <Show when={props.attach}>
            {(attach) => <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={attach()}>Attach</Button>}
          </Show>
        </div>
      </div>
      <pre class="mt-2 max-h-60 overflow-auto rounded-lg border border-border-weaker-base bg-background-base p-2 text-11-regular text-text-weak whitespace-pre-wrap">{props.text}</pre>
    </div>
  )
}
