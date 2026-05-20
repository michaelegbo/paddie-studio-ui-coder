import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import {
  createInspirationSnapshot,
  INSPIRATION_HOST_MESSAGE_SOURCE,
  INSPIRATION_MESSAGE_SOURCE,
  normalizeInspirationPayload,
  normalizeInspirationUrl,
  type InspirationSnapshot,
} from "@/inspiration/helpers"

const messageRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const messageUrl = (value: unknown) => {
  const record = messageRecord(value)
  const payload = messageRecord(record.payload)
  return typeof payload.url === "string" ? payload.url : ""
}

export function InspirationPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const platform = usePlatform()
  const prompt = usePrompt()
  const [input, setInput] = createSignal("")
  const [activeUrl, setActiveUrl] = createSignal("")
  const [liveUrl, setLiveUrl] = createSignal("")
  const [snapshot, setSnapshot] = createSignal<InspirationSnapshot>()
  const [view, setView] = createSignal<"live" | "snapshot">("live")
  const [loading, setLoading] = createSignal(false)
  const [picking, setPicking] = createSignal(false)
  const [error, setError] = createSignal("")
  const [liveBlocked, setLiveBlocked] = createSignal(false)
  let frame: HTMLIFrameElement | undefined

  const canUseUrl = createMemo(() => input().trim().length > 0 || activeUrl().trim().length > 0)
  const status = createMemo(() => {
    if (loading()) return "Capturing snapshot..."
    if (error()) return error()
    if (picking()) return "Click an element in the snapshot."
    if (view() === "snapshot" && snapshot()) return `Snapshot ready: ${snapshot()!.pageTitle}`
    if (liveBlocked()) return "Live browsing may be blocked. Snapshot capture is still available."
    if (liveUrl()) return "Live browsing loaded."
    return "Enter a public URL to start."
  })

  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const postToSnapshot = (type: string, payload: Record<string, unknown> = {}) => {
    frame?.contentWindow?.postMessage({ source: INSPIRATION_HOST_MESSAGE_SOURCE, type, ...payload }, "*")
  }

  const loadLive = () => {
    try {
      const next = normalizeInspirationUrl(input())
      setInput(next)
      setActiveUrl(next)
      setLiveUrl(next)
      setView("live")
      setError("")
      setLiveBlocked(false)
      setPicking(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({ variant: "error", title: "Could not load URL", description: message })
    }
  }

  const captureSnapshot = async (target?: string) => {
    setLoading(true)
    setError("")
    setPicking(false)
    try {
      const next = normalizeInspirationUrl(target || activeUrl() || input())
      const response = await (platform.fetch ?? fetch)(next, {
        headers: { accept: "text/html,application/xhtml+xml,*/*" },
      })
      if (!response.ok) throw new Error(`Snapshot fetch failed with HTTP ${response.status}`)
      const captured = await createInspirationSnapshot({
        url: next,
        html: await response.text(),
        fetcher: platform.fetch ?? fetch,
      })
      setInput(captured.url)
      setActiveUrl(captured.url)
      setLiveUrl(captured.url)
      setSnapshot(captured)
      setView("snapshot")
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({ variant: "error", title: "Could not capture snapshot", description: message })
      return false
    } finally {
      setLoading(false)
    }
  }

  const attachPayload = (raw: unknown) => {
    const fallback = activeUrl() || snapshot()?.url || input()
    const item = normalizeInspirationPayload(raw, fallback)
    prompt.context.add({
      type: "inspiration",
      url: item.url,
      pageTitle: item.pageTitle,
      mode: item.mode,
      selector: item.selector,
      label: item.label,
      text: item.text,
      html: item.html,
      styleSignals: item.styleSignals,
    })
    focus()
    showToast({
      title: item.mode === "page" ? "Page inspiration added" : "Element inspiration added",
      description: item.mode === "page" ? item.pageTitle : item.label,
    })
  }

  const attachPage = async () => {
    if (!snapshot() && !(await captureSnapshot())) return
    setView("snapshot")
    setPicking(false)
    requestAnimationFrame(() => postToSnapshot("capture-page"))
  }

  const selectFromPage = async () => {
    if (!snapshot() && !(await captureSnapshot())) return
    setView("snapshot")
    setPicking((value) => !value)
  }

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow) return
      const data = messageRecord(event.data)
      if (data.source !== INSPIRATION_MESSAGE_SOURCE) return
      if (data.type === "cancel") {
        setPicking(false)
        return
      }
      if (data.type === "navigate") {
        const next = messageUrl(event.data)
        if (!next) return
        setInput(next)
        void captureSnapshot(next)
        return
      }
      if (data.type !== "pick" && data.type !== "capture") return
      setPicking(false)
      attachPayload(data.payload)
    }

    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  createEffect(() => {
    if (view() !== "snapshot" || !snapshot()) return
    const next = picking()
    requestAnimationFrame(() => postToSnapshot("set-picking", { picking: next }))
  })

  return (
    <div class="min-h-full w-full bg-background-base">
      <div class="flex min-h-full flex-col gap-3">
        <div class="rounded-[20px] border border-border-weaker-base bg-surface-base px-4 py-4">
          <form
            class="flex flex-col gap-3 lg:flex-row lg:items-center"
            onSubmit={(event) => {
              event.preventDefault()
              loadLive()
            }}
          >
            <div class="min-w-0 flex-1">
              <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Inspiration</div>
              <input
                value={input()}
                onInput={(event) => setInput(event.currentTarget.value)}
                placeholder="https://example.com"
                class="mt-2 h-10 w-full rounded-xl border border-border-weaker-base bg-background-stronger px-3 text-13-medium text-text-base outline-none transition-colors placeholder:text-text-weak focus:border-border-weak-base"
              />
            </div>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" class="h-9 px-3 text-12-medium" disabled={!canUseUrl() || loading()}>
                Load
              </Button>
              <Button
                type="button"
                variant="ghost"
                class="h-9 px-3 text-12-medium"
                disabled={!canUseUrl() || loading()}
                onClick={() => void captureSnapshot()}
              >
                Capture snapshot
              </Button>
            </div>
          </form>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 flex-1 truncate text-12-medium text-text-weak">{status()}</div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <div class="rounded-xl border border-border-weaker-base bg-background-base p-1 flex items-center gap-1">
                <Button
                  type="button"
                  variant={view() === "live" ? "secondary" : "ghost"}
                  class="h-8 px-3 text-11-medium"
                  disabled={!liveUrl()}
                  onClick={() => setView("live")}
                >
                  Live
                </Button>
                <Button
                  type="button"
                  variant={view() === "snapshot" ? "secondary" : "ghost"}
                  class="h-8 px-3 text-11-medium"
                  disabled={!snapshot()}
                  onClick={() => setView("snapshot")}
                >
                  Snapshot
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                class="h-8 px-3 text-11-medium"
                disabled={!canUseUrl() || loading()}
                onClick={() => void attachPage()}
              >
                Attach page
              </Button>
              <Button
                type="button"
                variant={picking() ? "secondary" : "ghost"}
                class="h-8 px-3 text-11-medium"
                disabled={!canUseUrl() || loading()}
                onClick={() => void selectFromPage()}
              >
                {picking() ? "Stop selecting" : "Select from page"}
              </Button>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)]">
          <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
            <div class="size-2 rounded-full bg-[#f87171]" />
            <div class="size-2 rounded-full bg-[#fbbf24]" />
            <div class="size-2 rounded-full bg-[#34d399]" />
            <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
              {view() === "snapshot" ? snapshot()?.pageTitle || "Snapshot" : liveUrl() || "Live browser"}
            </div>
          </div>
          <div class="h-[620px] bg-background-stronger p-3">
            <Show
              when={liveUrl() || snapshot()}
              fallback={
                <div class="size-full rounded-[18px] border border-border-weaker-base bg-background-base flex items-center justify-center text-13-medium text-text-weak">
                  No website loaded
                </div>
              }
            >
              <iframe
                ref={frame}
                src={view() === "live" ? liveUrl() || undefined : undefined}
                srcdoc={view() === "snapshot" ? snapshot()?.html : undefined}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
                class="block size-full rounded-[18px] border border-border-weaker-base bg-white"
                title="Inspiration browser"
                onLoad={() => {
                  if (view() === "snapshot") {
                    postToSnapshot("set-picking", { picking: picking() })
                    return
                  }
                  setLiveBlocked(false)
                }}
                onError={() => setLiveBlocked(true)}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
