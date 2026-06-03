import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ContextItem, Prompt } from "@/context/prompt"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const enabledAutoAccept: Array<{ sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: string[] = []
const syncedDirectories: string[] = []
const contextItems: (ContextItem & { key: string })[] = []
const contextAdds: ContextItem[] = []
const contextRemoves: string[] = []

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let promptAsyncError: Error | undefined

const promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]

const sortedIndex = <T extends { id: string }>(items: T[], id: string) => {
  const index = items.findIndex((item) => item.id >= id)
  return index >= 0 ? index : items.length
}

const mergeParts = <T extends { id: string }>(current: T[] | undefined, want: T[]) => {
  const parts = current?.slice() ?? []
  for (const part of want) {
    if (parts.some((item) => item.id === part.id)) continue
    parts.splice(sortedIndex(parts, part.id), 0, part)
  }
  return parts
}

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async () => {
        createdSessions.push(directory)
        return {
          data: {
            id: `session-${createdSessions.length}`,
            title: `New session ${createdSessions.length}`,
          },
        }
      },
      shell: async () => {
        sentShell.push(directory)
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async () => {
        if (promptAsyncError) throw promptAsyncError
        return { data: undefined }
      },
      command: async () => ({ data: undefined }),
      abort: async () => ({ data: undefined }),
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: () => 0,
  }))

  const checksum = (content: string): string | undefined => {
    if (!content) return undefined
    let hash = 0x811c9dc5
    for (let index = 0; index < content.length; index++) {
      hash ^= content.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
  }

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
    base64Decode: (value: string) => value,
    checksum,
    sampledChecksum: checksum,
    hash: async (value: string) => checksum(value) ?? "",
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ sessionID, directory })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => undefined,
      set: () => undefined,
      context: {
        add: (item: ContextItem) => {
          contextAdds.push(item)
          contextItems.push({ ...item, key: `restored:${contextAdds.length}` })
        },
        remove: (key: string) => {
          contextRemoves.push(key)
          const index = contextItems.findIndex((item) => item.key === key)
          if (index >= 0) contextItems.splice(index, 1)
        },
        items: () => contextItems,
      },
    }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
    ensureSessionKey: (key: string, touch: (key: string) => void, seed: (key: string) => void) => {
      touch(key)
      seed(key)
      return key
    },
    createSessionKeyReader: (sessionKey: string | (() => string), ensure: (key: string) => void) => {
      const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
      return () => {
        const value = key()
        ensure(value)
        return value
      }
    },
    pruneSessionKeys: (input: { keep?: string; max: number; used: Map<string, number>; view: string[]; tabs: string[] }) => {
      if (!input.keep) return []
      const keys = new Set<string>([...input.view, ...input.tabs])
      if (keys.size <= input.max) return []
      const score = (key: string) => key === input.keep ? Number.MAX_SAFE_INTEGER : input.used.get(key) ?? 0
      return Array.from(keys).sort((a, b) => score(b) - score(a)).slice(input.max)
    },
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        directory: "/repo/main",
        client: rootClient,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
    applyOptimisticAdd: (
      draft: { message: Record<string, Array<{ id: string }> | undefined>; part: Record<string, Array<{ id: string }> | undefined> },
      input: { sessionID: string; message: { id: string }; parts: Array<{ id: string }> },
    ) => {
      const messages = draft.message[input.sessionID]
      if (messages) {
        messages.splice(sortedIndex(messages, input.message.id), 0, input.message)
      } else {
        draft.message[input.sessionID] = [input.message]
      }
      draft.part[input.message.id] = input.parts.slice().sort((a, b) => a.id.localeCompare(b.id))
    },
    applyOptimisticRemove: (
      draft: { message: Record<string, Array<{ id: string }> | undefined>; part: Record<string, Array<{ id: string }> | undefined> },
      input: { sessionID: string; messageID: string },
    ) => {
      const messages = draft.message[input.sessionID]
      const index = messages?.findIndex((message) => message.id === input.messageID) ?? -1
      if (messages && index >= 0) messages.splice(index, 1)
      delete draft.part[input.messageID]
    },
    mergeOptimisticPage: (
      page: {
        session: Array<{ id: string }>
        part: Array<{ id: string; part: Array<{ id: string }> }>
        cursor?: string
        complete: boolean
      },
      items: Array<{ message: { id: string }; parts: Array<{ id: string }> }>,
    ) => {
      const session = page.session.slice()
      const part = new Map(page.part.map((item) => [item.id, item.part.slice().sort((a, b) => a.id.localeCompare(b.id))]))
      const confirmed: string[] = []
      for (const item of items) {
        const index = sortedIndex(session, item.message.id)
        const found = session[index]?.id === item.message.id
        if (!found) session.splice(index, 0, item.message)
        const current = part.get(item.message.id)
        if (found && current && item.parts.every((want) => current.some((existing) => existing.id === want.id))) {
          confirmed.push(item.message.id)
          continue
        }
        part.set(item.message.id, mergeParts(current, item.parts))
      }
      return {
        cursor: page.cursor,
        complete: page.complete,
        session,
        part: Array.from(part.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([id, value]) => ({ id, part: value })),
        confirmed,
      }
    },
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [
          { session: storedSessions[directory] },
          (...args: unknown[]) => {
            if (args[0] !== "session") return
            const next = args[1]
            if (typeof next === "function") {
              storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
              return
            }
            if (Array.isArray(next)) {
              storedSessions[directory] = next as Array<{ id: string; title?: string }>
            }
          },
        ]
      },
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

afterAll(() => {
  mock.restore()
})

beforeEach(() => {
  createdClients.length = 0
  createdSessions.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  params = {}
  sentShell.length = 0
  syncedDirectories.length = 0
  contextItems.length = 0
  contextAdds.length = 0
  contextRemoves.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  promptAsyncError = undefined
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toEqual([{ id: "session-1", title: "New session 1" }])
    expect(optimisticSeeded).toEqual([true])
  })

  test("restores inspiration transient context when prompt send fails", async () => {
    params = { id: "session-inspiration" }
    promptAsyncError = new Error("network down")
    contextItems.push({
      key: "inspiration:https://example.com/:element:main",
      type: "inspiration",
      url: "https://example.com/",
      pageTitle: "Example",
      mode: "element",
      selector: "main > section.hero",
      label: "section.hero",
      text: "Hero",
      html: "<section>Hero</section>",
      styleSignals: {
        colors: ["rgb(10, 20, 30)"],
        typography: [],
        layout: [],
        borders: [],
        shadows: [],
        transitions: [],
        animations: [],
        keyframes: [],
      },
    })

    const submit = createPromptSubmit({
      info: () => ({ id: "session-inspiration" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    for (let i = 0; i < 20 && contextAdds.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(contextRemoves).toContain("inspiration:https://example.com/:element:main")
    expect(contextAdds).toHaveLength(1)
    expect(contextAdds[0]).toMatchObject({
      type: "inspiration",
      url: "https://example.com/",
      selector: "main > section.hero",
    })
  })

  test("restores Paddie Data transient context when prompt send fails", async () => {
    params = { id: "session-data" }
    promptAsyncError = new Error("network down")
    contextItems.push(
      {
        key: "memory:dynamic-user:integration:Paddie Memory service",
        type: "memory",
        userID: "<DYNAMIC_USER_ID>",
        mode: "integration",
        label: "Paddie Memory service",
        query: "What should the app remember?",
        content: "Integrate Memory Router through a server route and pass dynamic user IDs.",
        endpoint: "POST /memory/router",
        apiBase: "https://api.paddie.io/api",
        apiKeyEnv: "PADDIE_API_KEY",
        userIDStrategy: "Create or resolve a stable app-specific Paddie Memory user_id for each end user.",
        metadata: { selectedExplorerUserID: "user_1" },
      },
      {
        key: "knowledge-base:kb_1:integration:onboarding",
        type: "knowledge-base",
        knowledgeBaseID: "kb_1",
        knowledgeBaseName: "Onboarding",
        mode: "integration",
        label: "Knowledge Base integration",
        query: "How should onboarding work?",
        endpoint: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
        apiBase: "https://api.paddie.io/api",
        apiKeyEnv: "PADDIE_API_KEY",
        integrationNote: "Query this KB through a trusted server route.",
        knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
      },
      {
        key: "data-playground:router:conversation:preference:kb_1",
        type: "data-playground",
        label: "Paddie Data Playground",
        apiBase: "https://api.paddie.io/api",
        apiKeyEnv: "PADDIE_API_KEY",
        mode: "router",
        routerMode: "conversation",
        memoryType: "preference",
        selectedExplorerUserID: "user_1",
        userIDStrategy: "Create or resolve a stable app-specific Paddie Memory user_id for each end user.",
        sampleQuery: "How should onboarding work?",
        conversationID: "conversation_1",
        integrationNote: "Build runtime Memory/RAG services, not static answers.",
        knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
      },
    )

    const submit = createPromptSubmit({
      info: () => ({ id: "session-data" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    for (let i = 0; i < 20 && contextAdds.length < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(contextRemoves).toContain("memory:dynamic-user:integration:Paddie Memory service")
    expect(contextRemoves).toContain("knowledge-base:kb_1:integration:onboarding")
    expect(contextRemoves).toContain("data-playground:router:conversation:preference:kb_1")
    expect(contextAdds).toHaveLength(3)
    expect(contextAdds[0]).toMatchObject({
      type: "memory",
      userID: "<DYNAMIC_USER_ID>",
      query: "What should the app remember?",
      apiKeyEnv: "PADDIE_API_KEY",
      userIDStrategy: "Create or resolve a stable app-specific Paddie Memory user_id for each end user.",
    })
    expect(contextAdds[1]).toMatchObject({
      type: "knowledge-base",
      knowledgeBaseID: "kb_1",
      mode: "integration",
      query: "How should onboarding work?",
      apiKeyEnv: "PADDIE_API_KEY",
      endpoint: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
    })
    expect(contextAdds[2]).toMatchObject({
      type: "data-playground",
      label: "Paddie Data Playground",
      mode: "router",
      routerMode: "conversation",
      memoryType: "preference",
      apiKeyEnv: "PADDIE_API_KEY",
      knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
    })
  })

  test("restores Autopilot transient context when prompt send fails", async () => {
    params = { id: "session-autopilot" }
    promptAsyncError = new Error("network down")
    contextItems.push({
      key: "autopilot:run-1",
      type: "autopilot",
      runID: "run-1",
      goal: "Build and verify a dashboard",
      workspace: "/repo",
      status: "running",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      plan: [
        {
          id: "verify",
          title: "Verify",
          description: "Run tests.",
          owner: "opencode",
          status: "pending",
        },
      ],
      events: [
        {
          id: "run-1:goal",
          source: "user",
          title: "Goal accepted",
          body: "Build and verify a dashboard",
          at: "2026-05-22T10:00:00.000Z",
        },
      ],
      safeguards: ["Ask before destructive actions."],
    })

    const submit = createPromptSubmit({
      info: () => ({ id: "session-autopilot" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    for (let i = 0; i < 20 && contextAdds.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(contextRemoves).toContain("autopilot:run-1")
    expect(contextAdds).toHaveLength(1)
    expect(contextAdds[0]).toMatchObject({
      type: "autopilot",
      runID: "run-1",
      goal: "Build and verify a dashboard",
    })
  })

  test("restores Penpot transient context when prompt send fails", async () => {
    params = { id: "session-penpot" }
    promptAsyncError = new Error("network down")
    contextItems.push({
      key: "penpot-design:https://penpot.paddie.io:penpot-production:file-1:page-1:website:hero:read",
      type: "penpot-design",
      instanceUrl: "https://penpot.paddie.io",
      fileId: "file-1",
      fileName: "Landing",
      pageId: "page-1",
      pageName: "Marketing",
      frameIds: ["hero"],
      frameNames: ["Hero"],
      mode: "website",
      mcpName: "penpot-production",
      styleSignals: {
        colors: [],
        typography: [],
        layout: [],
        components: [],
        interactions: [],
      },
      assets: [],
      tokens: {},
      writebackAllowed: false,
      summary: "Build from this frame.",
    })

    const submit = createPromptSubmit({
      info: () => ({ id: "session-penpot" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    for (let i = 0; i < 20 && contextAdds.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(contextRemoves).toContain("penpot-design:https://penpot.paddie.io:penpot-production:file-1:page-1:website:hero:read")
    expect(contextAdds).toHaveLength(1)
    expect(contextAdds[0]).toMatchObject({
      type: "penpot-design",
      instanceUrl: "https://penpot.paddie.io",
      fileId: "file-1",
      frameNames: ["Hero"],
    })
  })
})
