import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createSignal, For, Show, type Accessor, type Setter } from "solid-js"
import { useQueryOptions } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import {
  buildPenpotMcpUrl,
  createPenpotDesignContext,
  normalizePenpotInstanceUrl,
  penbotPresets,
  penpotMcpUrlIncludesUserToken,
  PENPOT_PRODUCTION_MCP_NAME,
  PENPOT_PRODUCTION_URL,
  type PenpotDesignMode,
} from "@/penpot/helpers"
import { pathKey } from "@/utils/path-key"

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

  const mcpStatus = createMemo(() => sync.data.mcp[mcpName().trim()]?.status)
  const connected = createMemo(() => mcpStatus() === "connected" || !!registeredAt())
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
  const frameCount = createMemo(() => frames().split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).length)
  const mcpKeyProvided = createMemo(() => !!userToken().trim() || penpotMcpUrlIncludesUserToken(mcpUrl()))
  const previewUrl = createMemo(() => {
    try {
      return normalizePenpotInstanceUrl(instanceUrl())
    } catch {
      return PENPOT_PRODUCTION_URL
    }
  })
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
        onOpenPenpot={openPenpot}
        onRegister={() => register.mutate()}
        onConnectSaved={() => connectConfigured.mutate()}
        onAttachWriteback={() => attach("writeback")}
      />
    ))

  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const refetchMcp = () => queryClient.refetchQueries(queryOptions.mcp(pathKey(sync.directory)))

  const register = useMutation(() => ({
    mutationFn: async () => {
      setRegistrationError("")
      const name = mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME
      if (!mcpKeyProvided()) {
        throw new Error("Paste the Penpot MCP URL with userToken, or enter the MCP key generated in Penpot.")
      }
      const url = buildPenpotMcpUrl({
        instanceUrl: instanceUrl(),
        mcpUrl: mcpUrl(),
        userToken: userToken(),
      })
      await sdk.client.mcp.add({
        name,
        config: {
          type: "remote",
          url,
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

  const attach = (nextMode: PenpotDesignMode) => {
    setMode(nextMode)
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
        mode: nextMode,
        mcpName: mcpName(),
        writebackAllowed,
        summary: summary(),
      })
      prompt.context.add({ type: "penpot-design", ...item })
      focus()
      showToast({
        title: nextMode === "writeback" ? "Penpot writeback context added" : "Penpot design added",
        description:
          item.frameNames.length > 0
            ? `${item.frameNames.length} frame${item.frameNames.length === 1 ? "" : "s"} attached.`
            : "The active Penpot frame context was attached.",
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
    <div class="min-h-full w-full bg-background-base">
      <div class="grid min-h-full gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div class="min-h-0 overflow-auto rounded-[20px] border border-border-weaker-base bg-surface-base p-4 shadow-[var(--shadow-lg-border-base)]">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-15-medium text-text-base">Penpot</div>
              <div class="mt-1 text-12-medium text-text-weak">
                {connectionStatus()} through {mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME}
              </div>
            </div>
            <div
              classList={{
                "size-2 rounded-full shrink-0": true,
                "bg-icon-success-base": connected(),
                "bg-icon-danger-base": mcpStatus() === "failed",
                "bg-border-strong-base": !connected() && mcpStatus() !== "failed",
              }}
            />
          </div>
          <div class="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <Button type="button" class="h-9 justify-center text-12-medium" onClick={openPenpot}>
              Open Penpot
            </Button>
            <Button type="button" variant="ghost" class="h-9 justify-center px-3 text-12-medium" onClick={showSetup}>
              Setup
            </Button>
            <Button
              type="button"
              variant="ghost"
              class="h-9 justify-center px-3 text-12-medium"
              disabled={connectConfigured.isPending}
              onClick={() => connectConfigured.mutate()}
            >
              Connect saved
            </Button>
          </div>
          <div class="mt-3 rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-11-medium leading-5 text-text-weak">
            Sign in to Penpot with Paddie SSO, then copy the MCP Server URL from Penpot Account integrations.
          </div>

          <form
            class="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              register.mutate()
            }}
          >
            <label class="block">
              <span class="text-11-medium text-text-weak">Instance URL</span>
              <input
                value={instanceUrl()}
                onInput={(event) => setInstanceUrl(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={PENPOT_PRODUCTION_URL}
              />
            </label>
            <label class="block">
              <span class="text-11-medium text-text-weak">MCP name</span>
              <input
                value={mcpName()}
                onInput={(event) => setMcpName(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={PENPOT_PRODUCTION_MCP_NAME}
              />
            </label>
            <label class="block">
              <span class="text-11-medium text-text-weak">MCP URL from Penpot</span>
              <input
                value={mcpUrl()}
                onInput={(event) => setMcpUrl(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={`${PENPOT_PRODUCTION_URL}/mcp/stream?userToken=...`}
              />
            </label>
            <label class="block">
              <span class="text-11-medium text-text-weak">MCP key alternative</span>
              <input
                value={userToken()}
                type="password"
                onInput={(event) => setUserToken(event.currentTarget.value)}
                class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder="Used only to build the MCP URL"
              />
            </label>
            <div class="grid grid-cols-2 gap-2">
              <Button type="submit" class="h-9 justify-center text-12-medium" disabled={register.isPending}>
                {register.isPending ? "Registering" : "Register MCP"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                class="h-9 justify-center text-12-medium"
                onClick={openPenpot}
              >
                Open Penpot
              </Button>
            </div>
            <Show when={registrationError()}>
              {(message) => <div class="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-11-medium text-red-200">{message()}</div>}
            </Show>
          </form>

          <div class="mt-5 border-t border-border-weaker-base pt-4">
            <div class="text-13-medium text-text-base">Selected design</div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <label class="block">
                <span class="text-11-medium text-text-weak">File ID</span>
                <input
                  value={fileId()}
                  onInput={(event) => setFileId(event.currentTarget.value)}
                  class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                  placeholder="active"
                />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">File name</span>
                <input
                  value={fileName()}
                  onInput={(event) => setFileName(event.currentTarget.value)}
                  class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                  placeholder="optional"
                />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">Page ID</span>
                <input
                  value={pageId()}
                  onInput={(event) => setPageId(event.currentTarget.value)}
                  class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                  placeholder="active"
                />
              </label>
              <label class="block">
                <span class="text-11-medium text-text-weak">Page name</span>
                <input
                  value={pageName()}
                  onInput={(event) => setPageName(event.currentTarget.value)}
                  class="mt-1 h-9 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                  placeholder="optional"
                />
              </label>
            </div>
            <label class="mt-3 block">
              <span class="text-11-medium text-text-weak">Frame IDs or names</span>
              <textarea
                value={frames()}
                onInput={(event) => setFrames(event.currentTarget.value)}
                class="mt-1 min-h-20 w-full resize-y rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder={"frame-id: Hero\nframe-id-2: Pricing"}
              />
            </label>
            <label class="mt-3 block">
              <span class="text-11-medium text-text-weak">Context note</span>
              <textarea
                value={summary()}
                onInput={(event) => setSummary(event.currentTarget.value)}
                class="mt-1 min-h-16 w-full resize-y rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-12-medium text-text-base outline-none focus:border-border-weak-base"
                placeholder="What should Paddie do with these frames?"
              />
            </label>
          </div>

          <div class="mt-5 border-t border-border-weaker-base pt-4">
            <div class="flex items-center justify-between gap-2">
              <div class="text-13-medium text-text-base">Penbots</div>
              <div class="text-11-medium text-text-weak">
                {frameCount() || "active"} frame{frameCount() === 1 ? "" : "s"}
              </div>
            </div>
            <div class="mt-3 space-y-2">
              <For each={penbotPresets}>
                {(preset) => (
                  <button
                    type="button"
                    classList={{
                      "w-full rounded-xl border px-3 py-3 text-left transition-colors": true,
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
        </div>

        <div class="min-h-0 overflow-auto rounded-[20px] border border-border-weaker-base bg-surface-base p-5 shadow-[var(--shadow-lg-border-base)]">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="text-15-medium text-text-base">Paddie SSO setup</div>
              <div class="mt-1 truncate text-12-medium text-text-weak">{previewUrl()}</div>
            </div>
            <Button type="button" class="h-9 shrink-0 px-3 text-12-medium" onClick={openPenpot}>
              Open Penpot
            </Button>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={showSetup}>
              Open setup guide
            </Button>
            <Button type="button" variant="ghost" class="h-8 px-3 text-11-medium" onClick={() => attach("writeback")}>
              Attach writeback
            </Button>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-2">
            <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-12-medium text-text-base">1. Sign in</div>
              <div class="mt-2 text-11-medium leading-5 text-text-weak">
                Use the Paddie SSO button at Penpot. Penpot creates your profile the first time you sign in.
              </div>
            </div>
            <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-12-medium text-text-base">2. Generate MCP URL</div>
              <div class="mt-2 text-11-medium leading-5 text-text-weak">
                Open Account integrations in Penpot, enable MCP Server, and copy the URL that includes userToken.
              </div>
            </div>
            <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-12-medium text-text-base">3. Register in Paddie</div>
              <div class="mt-2 text-11-medium leading-5 text-text-weak">
                Paste the copied URL into this panel and register it as {mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME}.
              </div>
            </div>
            <div class="rounded-xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-12-medium text-text-base">4. Connect file MCP</div>
              <div class="mt-2 text-11-medium leading-5 text-text-weak">
                Open the Penpot file and use File MCP Server Connect before asking Paddie to inspect or update frames.
              </div>
            </div>
          </div>

          <div class="mt-5 rounded-xl border border-border-weaker-base bg-background-stronger p-4">
            <div class="text-12-medium text-text-base">Current connection</div>
            <div class="mt-2 grid gap-2 text-11-medium leading-5 text-text-weak sm:grid-cols-2">
              <div>Instance: {previewUrl()}</div>
              <div>MCP name: {mcpName().trim() || PENPOT_PRODUCTION_MCP_NAME}</div>
              <div>Status: {connectionStatus()}</div>
              <div>MCP key: {mcpKeyProvided() ? "Provided" : "Needed"}</div>
            </div>
          </div>
        </div>
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
  onOpenPenpot: VoidFunction
  onRegister: VoidFunction
  onConnectSaved: VoidFunction
  onAttachWriteback: VoidFunction
}) {
  const dialog = useDialog()

  const setupSteps = [
    {
      title: "1. Sign in with Paddie",
      body: "Open Penpot, use Paddie SSO, and let Penpot create the account profile on first login.",
    },
    {
      title: "2. Enable MCP",
      body: "In Penpot, open Your account, then Integrations, then MCP Server. Enable it and generate a key if needed.",
    },
    {
      title: "3. Copy the MCP URL",
      body: "Copy the server URL from Penpot. It should include userToken. Paste that URL below instead of sharing the raw key.",
    },
    {
      title: "4. Connect the file",
      body: "Open a Penpot file, then use File, MCP Server, Connect. Paddie can then inspect or write to that active file.",
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
      title="Set up Penpot MCP"
      description="Connect the current Paddie model to your active Penpot file. Tokens stay user-provided and write actions still require approval."
      size="large"
      class="w-full max-w-[820px] mx-auto"
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
                Open Penpot
              </Button>
              <Button
                type="button"
                variant="ghost"
                class="h-8 px-3 text-11-medium"
                disabled={props.connectPending()}
                onClick={props.onConnectSaved}
              >
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
