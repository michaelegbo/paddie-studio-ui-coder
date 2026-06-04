import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor, type Setter } from "solid-js"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"
import { useQueryOptions } from "@/context/global-sync"
import { usePlatform, type DOMRectLike } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import {
  buildPenpotMcpUrl,
  createPenpotDesignContext,
  normalizePenpotInstanceUrl,
  penbotPresets,
  penpotContextBody,
  penpotMcpUrlIncludesUserToken,
  PENPOT_PRODUCTION_MCP_NAME,
  PENPOT_PRODUCTION_URL,
  type PenpotBridgeSession,
  type PenpotDesignMode,
  type PenpotSelection,
} from "@/penpot/helpers"
import { pathKey } from "@/utils/path-key"

const PENPOT_WEBVIEW_ID = "paddie-penpot-workspace"

export function PenpotPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const queryClient = useQueryClient()
  const queryOptions = useQueryOptions()

  let workspaceSlot: HTMLDivElement | undefined
  let lastWorkspaceUrl = ""

  const [instanceUrl, setInstanceUrl] = createSignal(PENPOT_PRODUCTION_URL)
  const [mcpName, setMcpName] = createSignal(PENPOT_PRODUCTION_MCP_NAME)
  const [mcpUrl, setMcpUrl] = createSignal("")
  const [userToken, setUserToken] = createSignal("")
  const [fileId, setFileId] = createSignal("")
  const [fileName, setFileName] = createSignal("")
  const [pageId, setPageId] = createSignal("")
  const [pageName, setPageName] = createSignal("")
  const [frames, setFrames] = createSignal("")
  const [summary, setSummary] = createSignal("")
  const [mode, setMode] = createSignal<PenpotDesignMode>("website")
  const [registeredAt, setRegisteredAt] = createSignal("")
  const [registrationError, setRegistrationError] = createSignal("")
  const [workspaceError, setWorkspaceError] = createSignal("")
  const [bridgeSession, setBridgeSession] = createSignal<PenpotBridgeSession>()
  const [bridgeError, setBridgeError] = createSignal("")

  const mcpStatus = createMemo(() => sync.data.mcp[mcpName().trim()]?.status)
  const connected = createMemo(() => mcpStatus() === "connected" || !!registeredAt())
  const embeddedAvailable = createMemo(() => !!platform.embeddedWebview)
  const connectionStatus = createMemo(() => {
    const status = mcpStatus()
    if (status === "connected") return "Connected"
    if (status === "failed") return "Failed"
    if (status === "needs_auth") return "Needs auth"
    if (status === "needs_client_registration") return "Needs client"
    if (status === "disabled") return "Disabled"
    if (registeredAt()) return "Registered"
    return "Not connected"
  })
  const manualFrameCount = createMemo(() => frames().split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).length)
  const mcpKeyProvided = createMemo(() => !!userToken().trim() || penpotMcpUrlIncludesUserToken(mcpUrl()))
  const previewUrl = createMemo(() => {
    try {
      return normalizePenpotInstanceUrl(instanceUrl())
    } catch {
      return PENPOT_PRODUCTION_URL
    }
  })
  const activeSelection = createMemo(() => bridgeSession()?.latestSelection)
  const selectionCount = createMemo(() => activeSelection()?.items.length || manualFrameCount())
  const bridgeStatus = createMemo(() => {
    const session = bridgeSession()
    if (!session) return "Not paired"
    if (session.status === "paired") return "Paired"
    if (session.status === "expired") return "Expired"
    if (session.status === "disconnected") return "Disconnected"
    return "Waiting"
  })
  const bridgeManifestUrl = createMemo(
    () => bridgeSession()?.manifestUrl ?? "https://api.paddie.io/api/studio/penpot-bridge/manifest.json",
  )

  const openPenpot = () => platform.openLink(previewUrl())
  const showSetup = () =>
    dialog.show(() => (
      <PenpotSetupDialog
        instanceUrl={instanceUrl}
        setInstanceUrl={setInstanceUrl}
        mcpName={mcpName}
        setMcpName={setMcpName}
        mcpUrl={mcpUrl}
        setMcpUrl={setMcpUrl}
        userToken={userToken}
        setUserToken={setUserToken}
        previewUrl={previewUrl}
        connectionStatus={connectionStatus}
        mcpKeyProvided={mcpKeyProvided}
        registrationError={registrationError}
        registerPending={() => register.isPending}
        connectPending={() => connectConfigured.isPending}
        bridgeSession={bridgeSession}
        bridgeManifestUrl={bridgeManifestUrl}
        bridgePending={() => createBridgeSession.isPending}
        onOpenPenpot={openPenpot}
        onRegister={() => register.mutate()}
        onConnectSaved={() => connectConfigured.mutate()}
        onCreateBridge={() => createBridgeSession.mutate()}
        onCopyBridge={() => void copyBridgeDetails()}
        onAttachWriteback={() => attach("writeback")}
      />
    ))

  const focusPrompt = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const refetchMcp = () => queryClient.refetchQueries(queryOptions.mcp(pathKey(sync.directory)))

  const slotBounds = (): DOMRectLike | undefined => {
    if (!workspaceSlot) return undefined
    const rect = workspaceSlot.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return undefined
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  }

  const syncWorkspace = async (visible = true) => {
    const api = platform.embeddedWebview
    const bounds = slotBounds()
    if (!api || !bounds) return
    setWorkspaceError("")
    try {
      if (!lastWorkspaceUrl) {
        await api.open({ id: PENPOT_WEBVIEW_ID, url: previewUrl(), bounds, visible })
        lastWorkspaceUrl = previewUrl()
        return
      }
      if (lastWorkspaceUrl !== previewUrl()) {
        await api.navigate(PENPOT_WEBVIEW_ID, previewUrl())
        lastWorkspaceUrl = previewUrl()
      }
      await api.setBounds(PENPOT_WEBVIEW_ID, bounds)
      await api.setVisible(PENPOT_WEBVIEW_ID, visible)
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  const reloadWorkspace = async () => {
    const api = platform.embeddedWebview
    if (!api) return openPenpot()
    await api.reload(PENPOT_WEBVIEW_ID).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))
  }

  const resetWorkspace = async () => {
    const api = platform.embeddedWebview
    if (!api) return openPenpot()
    lastWorkspaceUrl = previewUrl()
    await api.navigate(PENPOT_WEBVIEW_ID, previewUrl()).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))
  }

  onMount(() => {
    if (!embeddedAvailable()) return
    const observer = new ResizeObserver(() => void syncWorkspace(true))
    if (workspaceSlot) observer.observe(workspaceSlot)
    const onResize = () => void syncWorkspace(true)
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onResize, true)
    requestAnimationFrame(() => void syncWorkspace(true))
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onResize, true)
      void platform.embeddedWebview?.close(PENPOT_WEBVIEW_ID)
    })
  })

  createEffect(() => {
    const url = previewUrl()
    if (!embeddedAvailable()) return
    requestAnimationFrame(() => {
      if (url !== lastWorkspaceUrl) void syncWorkspace(true)
    })
  })

  const register = useMutation(() => ({
    mutationFn: async () => {
      setRegistrationError("")
      const name = mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME
      if (!mcpKeyProvided()) {
        throw new Error("Paste the Penpot MCP URL with userToken, or enter the MCP key generated in Penpot.")
      }
      await sdk.client.mcp.add({
        name,
        config: {
          type: "remote",
          url: buildPenpotMcpUrl({
            instanceUrl: instanceUrl(),
            mcpUrl: mcpUrl(),
            userToken: userToken(),
          }),
          enabled: true,
          oauth: false,
          timeout: 30_000,
        },
      })
      setMcpName(name)
      setRegisteredAt(new Date().toISOString())
      await refetchMcp()
    },
    onSuccess: () => {
      showToast({
        title: "Penpot MCP registered",
        description: `${mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME} is available to the current Paddie model.`,
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setRegistrationError(message)
      showToast({ variant: "error", title: "Could not connect Penpot MCP", description: message })
    },
  }))

  const connectConfigured = useMutation(() => ({
    mutationFn: async () => {
      await sdk.client.mcp.connect({ name: mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME })
      await refetchMcp()
    },
    onSuccess: () => {
      setRegisteredAt(new Date().toISOString())
      showToast({ title: "Penpot MCP connected", description: "The configured Penpot MCP server is connected." })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setRegistrationError(message)
      showToast({ variant: "error", title: "Could not connect configured MCP", description: message })
    },
  }))

  const createBridgeSession = useMutation(() => ({
    mutationFn: () =>
      paddieApi.post<PenpotBridgeSession>("/studio/penpot-bridge/bridge-sessions", {
        instanceUrl: previewUrl(),
      }),
    onSuccess: (session) => {
      setBridgeSession(session)
      setBridgeError("")
      showToast({ title: "Penpot bridge session created", description: "Open the Paddie Bridge plugin in Penpot and paste the pairing details." })
    },
    onError: (err) => {
      const message = paddieApiErrorMessage(err)
      setBridgeError(message)
      showToast({ variant: "error", title: "Could not create Penpot bridge", description: message })
    },
  }))

  const refreshBridgeSession = async () => {
    const session = bridgeSession()
    if (!session) return
    try {
      setBridgeSession(await paddieApi.get<PenpotBridgeSession>(`/studio/penpot-bridge/bridge-sessions/${encodeURIComponent(session.id)}`))
      setBridgeError("")
    } catch (err) {
      setBridgeError(paddieApiErrorMessage(err))
    }
  }

  createEffect(() => {
    const session = bridgeSession()
    if (!session || session.status === "expired") return
    const timer = window.setInterval(() => void refreshBridgeSession(), 2500)
    onCleanup(() => window.clearInterval(timer))
  })

  const copyBridgeDetails = async () => {
    const session = bridgeSession()
    if (!session) {
      createBridgeSession.mutate()
      return
    }
    await navigator.clipboard?.writeText(
      [
        `Manifest: ${bridgeManifestUrl()}`,
        `Session ID: ${session.id}`,
        `Pairing code: ${session.pairingCode}`,
        session.bridgeToken ? `Bridge token: ${session.bridgeToken}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    showToast({ title: "Bridge details copied" })
  }

  const attach = (nextMode: PenpotDesignMode) => {
    setMode(nextMode)
    const selection = activeSelection()
    const writebackAllowed =
      nextMode === "writeback" &&
      window.confirm("Allow Penpot writeback context for this attachment? The worker must still ask before each Penpot write.")
    try {
      const item = createPenpotDesignContext({
        instanceUrl: instanceUrl(),
        fileId: fileId(),
        fileName: fileName(),
        pageId: pageId(),
        pageName: pageName(),
        frames: frames(),
        selection,
        selectionId: selection ? bridgeSession()?.id : undefined,
        mode: nextMode,
        mcpName: mcpName(),
        writebackAllowed,
        summary: summary(),
      })
      prompt.context.add({ type: "penpot-design", ...item })
      focusPrompt()
      showToast({
        title: nextMode === "writeback" ? "Penpot writeback context added" : "Penpot design added",
        description: penpotContextBody(item),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Could not attach Penpot context",
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col bg-background-base">
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-weaker-base bg-surface-base px-3 py-2">
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void resetWorkspace()}>
          Back
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void reloadWorkspace()}>
          Reload
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={openPenpot}>
          Open external
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={showSetup}>
          Setup MCP
        </Button>
        <span class="mx-1 h-5 w-px bg-border-weaker-base" />
        <Button type="button" class="h-8 px-3 text-11-medium" onClick={() => attach("chat")}>
          Attach selected
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attach("inspiration")}>
          Use as inspiration
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attach("website")}>
          Build website
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attach("template")}>
          Create template
        </Button>
        <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attach("writeback")}>
          AI edit in Penpot
        </Button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-0">
        <div class="relative min-h-0 bg-background-stronger">
          <div ref={workspaceSlot} class="absolute inset-0">
            <Show
              when={!embeddedAvailable()}
              fallback={
                <div class="flex h-full items-center justify-center border-r border-border-weaker-base bg-background-stronger text-12-medium text-text-weak">
                  <Show when={workspaceError()} fallback={<span>Loading Penpot workspace...</span>}>
                    {(message) => <span class="max-w-md text-center text-red-300">{message()}</span>}
                  </Show>
                </div>
              }
            >
              <div class="flex h-full flex-col items-center justify-center gap-3 border-r border-border-weaker-base bg-background-stronger px-6 text-center">
                <div class="text-14-medium text-text-base">Embedded Penpot is available in Paddie Studio desktop.</div>
                <div class="max-w-md text-12-medium leading-5 text-text-weak">
                  This build cannot iframe Penpot because the production Penpot site blocks cross-origin embedding. Open the same workspace externally, then use MCP and the bridge here.
                </div>
                <Button type="button" class="h-9 px-4 text-12-medium" onClick={openPenpot}>
                  Open Penpot
                </Button>
              </div>
            </Show>
          </div>
        </div>

        <aside class="min-h-0 overflow-auto border-l border-border-weaker-base bg-surface-base p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-15-medium text-text-base">Penpot</div>
              <div class="mt-1 truncate text-12-medium text-text-weak">{previewUrl()}</div>
            </div>
            <div
              classList={{
                "mt-1 size-2 shrink-0 rounded-full": true,
                "bg-icon-success-base": connected(),
                "bg-icon-danger-base": mcpStatus() === "failed",
                "bg-border-strong-base": !connected() && mcpStatus() !== "failed",
              }}
            />
          </div>

          <div class="mt-4 grid gap-2 text-11-medium leading-5 text-text-weak">
            <div class="flex items-center justify-between gap-3">
              <span>MCP</span>
              <span class="text-text-base">{connectionStatus()}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span>Bridge</span>
              <span class="text-text-base">{bridgeStatus()}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span>Selection</span>
              <span class="text-text-base">{selectionCount() || "Manual"}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span>Writeback</span>
              <span class="text-text-base">Approval gated</span>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <Button type="button" class="h-8 justify-center text-11-medium" disabled={createBridgeSession.isPending} onClick={() => createBridgeSession.mutate()}>
              Start bridge
            </Button>
            <Button type="button" variant="ghost" class="h-8 justify-center text-11-medium" onClick={() => void copyBridgeDetails()}>
              Copy pairing
            </Button>
          </div>
          <Show when={bridgeError()}>
            {(message) => <div class="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-11-medium text-red-200">{message()}</div>}
          </Show>
          <Show when={bridgeSession()}>
            {(session) => (
              <div class="mt-3 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-11-medium leading-5 text-text-weak">
                <div>Pairing code: <span class="text-text-base">{session().pairingCode}</span></div>
                <div class="break-all">Session: {session().id}</div>
                <div>Expires: {new Date(session().expiresAt).toLocaleTimeString()}</div>
              </div>
            )}
          </Show>

          <div class="mt-5 border-t border-border-weaker-base pt-4">
            <div class="text-13-medium text-text-base">Live selection</div>
            <Show
              when={activeSelection()}
              fallback={<div class="mt-2 text-11-medium leading-5 text-text-weak">Pair the bridge plugin or enter file/page/frame details manually below.</div>}
            >
              {(selection: Accessor<PenpotSelection>) => (
                <div class="mt-2 rounded-lg border border-border-weaker-base bg-background-stronger p-3">
                  <div class="text-12-medium text-text-base">{selection().fileName ?? selection().fileId}</div>
                  <div class="mt-1 text-11-medium text-text-weak">{selection().pageName ?? selection().pageId}</div>
                  <div class="mt-3 space-y-1">
                    <For each={selection().items}>
                      {(item) => (
                        <div class="flex items-center justify-between gap-3 text-11-medium">
                          <span class="min-w-0 truncate text-text-base">{item.name || item.id}</span>
                          <span class="shrink-0 text-text-weak">{item.type}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </Show>
          </div>

          <div class="mt-5 border-t border-border-weaker-base pt-4">
            <div class="text-13-medium text-text-base">Manual fallback</div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <label class="block">
                <span class="text-11-medium text-text-weak">File ID</span>
                <input value={fileId()} onInput={(event) => setFileId(event.currentTarget.value)} class="mt-1 h-8 w-full rounded-lg border border-border-weaker-base bg-background-stronger px-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder="active" />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">File name</span>
                <input value={fileName()} onInput={(event) => setFileName(event.currentTarget.value)} class="mt-1 h-8 w-full rounded-lg border border-border-weaker-base bg-background-stronger px-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder="optional" />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">Page ID</span>
                <input value={pageId()} onInput={(event) => setPageId(event.currentTarget.value)} class="mt-1 h-8 w-full rounded-lg border border-border-weaker-base bg-background-stronger px-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder="active" />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">Page name</span>
                <input value={pageName()} onInput={(event) => setPageName(event.currentTarget.value)} class="mt-1 h-8 w-full rounded-lg border border-border-weaker-base bg-background-stronger px-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder="optional" />
              </label>
            </div>
            <label class="mt-3 block">
              <span class="text-11-medium text-text-weak">Frame IDs or names</span>
              <textarea value={frames()} onInput={(event) => setFrames(event.currentTarget.value)} class="mt-1 min-h-16 w-full resize-y rounded-lg border border-border-weaker-base bg-background-stronger px-2 py-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder={"frame-id: Hero\nframe-id-2: Pricing"} />
            </label>
            <label class="mt-3 block">
              <span class="text-11-medium text-text-weak">Context note</span>
              <textarea value={summary()} onInput={(event) => setSummary(event.currentTarget.value)} class="mt-1 min-h-14 w-full resize-y rounded-lg border border-border-weaker-base bg-background-stronger px-2 py-2 text-11-medium text-text-base outline-none focus:border-border-weak-base" placeholder="What should Paddie do with this design?" />
            </label>
          </div>

          <div class="mt-5 border-t border-border-weaker-base pt-4">
            <div class="text-13-medium text-text-base">Penbots</div>
            <div class="mt-3 space-y-2">
              <For each={penbotPresets}>
                {(preset) => (
                  <button
                    type="button"
                    classList={{
                      "w-full rounded-lg border px-3 py-2 text-left transition-colors": true,
                      "border-border-weak-base bg-background-stronger": mode() === preset.mode,
                      "border-border-weaker-base bg-surface-base hover:bg-surface-base-hover": mode() !== preset.mode,
                    }}
                    onClick={() => attach(preset.mode)}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-12-medium text-text-base">{preset.label}</span>
                      <span class="text-10-medium text-text-weak">{preset.mode}</span>
                    </div>
                    <div class="mt-1 text-11-medium leading-5 text-text-weak">{preset.description}</div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function PenpotSetupDialog(props: {
  instanceUrl: Accessor<string>
  setInstanceUrl: Setter<string>
  mcpName: Accessor<string>
  setMcpName: Setter<string>
  mcpUrl: Accessor<string>
  setMcpUrl: Setter<string>
  userToken: Accessor<string>
  setUserToken: Setter<string>
  previewUrl: Accessor<string>
  connectionStatus: Accessor<string>
  mcpKeyProvided: Accessor<boolean>
  registrationError: Accessor<string>
  registerPending: Accessor<boolean>
  connectPending: Accessor<boolean>
  bridgeSession: Accessor<PenpotBridgeSession | undefined>
  bridgeManifestUrl: Accessor<string>
  bridgePending: Accessor<boolean>
  onOpenPenpot: VoidFunction
  onRegister: VoidFunction
  onConnectSaved: VoidFunction
  onCreateBridge: VoidFunction
  onCopyBridge: VoidFunction
  onAttachWriteback: VoidFunction
}) {
  const dialog = useDialog()

  const setupSteps = [
    {
      title: "1. Sign in with Paddie",
      body: "Open the embedded Penpot workspace, use Paddie SSO, and let Penpot create the account profile on first login.",
    },
    {
      title: "2. Enable MCP",
      body: "In Penpot, open Your account, then Integrations, then MCP Server. Enable it and generate a user URL.",
    },
    {
      title: "3. Pair the bridge",
      body: "Install or open the Paddie Bridge plugin, then paste the session ID and bridge token from this dialog.",
    },
    {
      title: "4. Attach selected",
      body: "Select frames or objects in Penpot, then attach the live selection to chat, template generation, or writeback.",
    },
  ]

  const copyPrompt = async () => {
    await navigator.clipboard?.writeText(
      "Use the attached Penpot writeback context. Design directly inside the active Penpot file. Start by describing the exact objects you will create or update, then wait for approval before using write tools.",
    )
    showToast({ title: "Penpot writeback prompt copied" })
  }

  return (
    <Dialog
      title="Set up Penpot workspace"
      description="Connect the current Paddie model to the embedded Penpot editor. Tokens stay user-provided and write actions still require approval."
      size="large"
      class="w-full max-w-[860px] mx-auto"
      fit
    >
      <div class="space-y-4">
        <div class="grid gap-3 md:grid-cols-2">
          <For each={setupSteps}>
            {(step) => (
              <div class="rounded-lg border border-border-weaker-base bg-background-stronger p-3">
                <div class="text-12-medium text-text-base">{step.title}</div>
                <div class="mt-1 text-12-medium leading-5 text-text-weak">{step.body}</div>
              </div>
            )}
          </For>
        </div>

        <form
          class="rounded-lg border border-border-weaker-base bg-background-stronger p-3"
          onSubmit={(event) => {
            event.preventDefault()
            props.onRegister()
          }}
        >
          <div class="grid gap-3 md:grid-cols-2">
            <label class="block">
              <span class="text-11-medium text-text-weak">Instance URL</span>
              <input
                value={props.instanceUrl()}
                onInput={(event) => props.setInstanceUrl(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-lg border border-border-weaker-base bg-background-base px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={PENPOT_PRODUCTION_URL}
              />
            </label>
            <label class="block">
              <span class="text-11-medium text-text-weak">MCP name</span>
              <input
                value={props.mcpName()}
                onInput={(event) => props.setMcpName(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-lg border border-border-weaker-base bg-background-base px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={PENPOT_PRODUCTION_MCP_NAME}
              />
            </label>
          </div>
          <label class="mt-3 block">
            <span class="text-11-medium text-text-weak">MCP URL from Penpot</span>
            <input
              value={props.mcpUrl()}
              onInput={(event) => props.setMcpUrl(event.currentTarget.value)}
              class="mt-1 h-9 w-full rounded-lg border border-border-weaker-base bg-background-base px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
              placeholder={`${PENPOT_PRODUCTION_URL}/mcp/stream?userToken=...`}
            />
          </label>
          <label class="mt-3 block">
            <span class="text-11-medium text-text-weak">MCP key alternative</span>
            <input
              value={props.userToken()}
              type="password"
              onInput={(event) => props.setUserToken(event.currentTarget.value)}
              class="mt-1 h-9 w-full rounded-lg border border-border-weaker-base bg-background-base px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
              placeholder="Only used to build the MCP URL"
            />
          </label>
          <Show when={props.registrationError()}>
            {(message) => (
              <div class="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-11-medium text-red-200">
                {message()}
              </div>
            )}
          </Show>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-11-medium text-text-weak">
              {props.connectionStatus()} - MCP key {props.mcpKeyProvided() ? "provided" : "needed"}
            </div>
            <div class="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={props.onOpenPenpot}>
                Open external
              </Button>
              <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" disabled={props.connectPending()} onClick={props.onConnectSaved}>
                Connect saved
              </Button>
              <Button type="submit" class="h-8 px-3 text-11-medium" disabled={props.registerPending()}>
                {props.registerPending() ? "Registering" : "Register MCP"}
              </Button>
            </div>
          </div>
        </form>

        <div class="rounded-lg border border-border-weaker-base bg-background-stronger p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-12-medium text-text-base">Selection bridge</div>
              <div class="mt-1 text-12-medium leading-5 text-text-weak">
                Host URL: <span class="break-all">{props.bridgeManifestUrl()}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" disabled={props.bridgePending()} onClick={props.onCreateBridge}>
                Start bridge
              </Button>
              <Button type="button" class="h-8 px-3 text-11-medium" onClick={props.onCopyBridge}>
                Copy pairing
              </Button>
            </div>
          </div>
          <Show when={props.bridgeSession()}>
            {(session) => (
              <div class="mt-3 grid gap-2 text-11-medium leading-5 text-text-weak sm:grid-cols-2">
                <div>Pairing code: {session().pairingCode}</div>
                <div>Status: {session().status}</div>
                <div class="break-all">Session: {session().id}</div>
                <div>Expires: {new Date(session().expiresAt).toLocaleString()}</div>
              </div>
            )}
          </Show>
        </div>

        <div class="rounded-lg border border-border-weaker-base bg-background-stronger p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-12-medium text-text-base">Design directly in Penpot</div>
              <div class="mt-1 text-12-medium leading-5 text-text-weak">
                After MCP is connected, attach writeback context, describe the design, and approve each Penpot write.
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => void copyPrompt()}>
                Copy prompt
              </Button>
              <Button type="button" class="h-8 px-3 text-11-medium" onClick={props.onAttachWriteback}>
                Attach writeback
              </Button>
            </div>
          </div>
          <div class="mt-3 grid gap-2 text-11-medium leading-5 text-text-weak sm:grid-cols-2">
            <div>Instance: {props.previewUrl()}</div>
            <div>MCP server: {props.mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME}</div>
          </div>
        </div>

        <div class="flex justify-end">
          <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
