import { useNavigate } from "@solidjs/router"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode-ai/ui/button"
import { Mark } from "@opencode-ai/ui/logo"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useAuth } from "@/context/auth"
import { paddieApi, UpgradeRequiredError } from "@/lib/paddie-api"
import { STUDIO_LOGIN_URL, STUDIO_SIGNUP_URL } from "@/lib/paddie-links"
import { InspirationPanel } from "@/components/inspiration-panel"
import { WorkflowBuilder, type WorkflowAttachPayload } from "@/components/workflow-builder"
import {
  DEFAULT_TEMPLATE_THUMB_DATA_URL,
  filesFor,
  materialize,
  part,
  previewDoc,
  previewHtml,
  previewUrl,
  templateGalleryPreviewReady,
  templateIsReactProject,
} from "@/template/helpers"
import type { UITemplateMeta, UITemplate } from "@/template/helpers"

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "landing-page"

function LoginCard(props: { desc?: string; openLink: (url: string) => void }) {
  return (
    <div class="rounded-[20px] border border-border-weaker-base bg-surface-base p-6">
      <div class="mx-auto max-w-sm text-center">
        <div class="mx-auto mb-3 size-10 rounded-xl border border-border-weaker-base bg-background-stronger flex items-center justify-center shadow-xs-border">
          <Mark class="size-5 text-icon-info-base" />
        </div>
        <div class="text-16-medium text-text-base">Sign in to Paddie</div>
        <div class="mt-1 text-13-medium text-text-weak">
          {props.desc ?? "Use your Paddie account to access templates"}
        </div>
        <Button
          class="mt-5 h-10 w-full justify-center text-13-medium"
          onClick={() => props.openLink(STUDIO_LOGIN_URL)}
        >
          Sign in with browser
        </Button>
        <div class="mt-4 text-11-medium text-text-weak">
          A browser window will open. After signing in, click the button in the browser to return to Studio.
        </div>
        <div class="mt-3 text-11-medium text-text-weak">
          No account?{" "}
          <button
            type="button"
            class="text-text-base underline underline-offset-2 hover:text-text-strong"
            onClick={() => props.openLink(STUDIO_SIGNUP_URL)}
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type Device = "desktop" | "tablet" | "mobile"
type Desk = "1920" | "1600" | "1440"
type StudioSection = "templates" | "inspiration" | "workflow"

const views = {
  "1920": { w: 1920, h: 1080, label: "1920x1080" },
  "1600": { w: 1600, h: 900, label: "1600x900" },
  "1440": { w: 1440, h: 900, label: "1440x900" },
  tablet: { w: 834, h: 1194, label: "Tablet" },
  mobile: { w: 430, h: 932, label: "Mobile" },
} as const

const mini = {
  w: 1440,
  h: 940,
  scale: 0.18,
} as const

const miniH = Math.round(mini.h * mini.scale)
const miniW = Math.round(mini.w * mini.scale)

export function TemplatePanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = usePrompt()
  const server = useServer()
  const auth = useAuth()

  const [list, setList] = createSignal<UITemplateMeta[]>([])
  const [listLoading, setListLoading] = createSignal(false)
  const [listError, setListError] = createSignal<string>()

  const [detailCache, setDetailCache] = createSignal<Record<string, UITemplate>>({})
  const [detailLoading, setDetailLoading] = createSignal(false)

  const [id, setID] = createSignal("")
  const [pid, setPID] = createSignal("full")
  const [pick, setPick] = createSignal(false)
  const [view, setView] = createSignal<"library" | "detail">("library")
  const [section, setSection] = createSignal<StudioSection>("templates")
  const [parts, setParts] = createSignal(false)
  const [device, setDevice] = createSignal<Device>("desktop")
  const [desk, setDesk] = createSignal<Desk>("1920")
  const [zoom, setZoom] = createSignal(100)
  const [w, setW] = createSignal(0)
  const [h, setH] = createSignal(0)
  const [doc, setDoc] = createSignal("")
  const [docCache, setDocCache] = createSignal<Record<string, string>>({})
  const [wait, setWait] = createSignal(false)
  const [showUpgrade, setShowUpgrade] = createSignal(false)
  const [upgradeInfo, setUpgradeInfo] = createSignal<{ required_tier: string; current_tier: string }>()
  let frame: HTMLIFrameElement | undefined
  let stage: HTMLDivElement | undefined

  const tpl = createMemo(() => detailCache()[id()])
  const url = createMemo(() => {
    const cur = tpl()
    if (!cur) return ""
    return previewUrl(cur)
  })
  const html = createMemo(() => {
    const cur = tpl()
    if (!cur) return ""
    return previewHtml(cur)
  })
  const browseDoc = createMemo(() => {
    const cur = tpl()
    const text = html()
    if (!cur || !text.trim()) return ""
    return previewDoc(url(), text, cur.parts, "browse")
  })
  const hit = createMemo(() => {
    const t = tpl()
    if (!t) return undefined
    return part(t, pid()) ?? t.parts[0]
  })

  const userTier = createMemo(() => auth.subscription()?.plan_slug ?? "free")
  const tierOrder: Record<string, number> = { free: 0, basic: 1, pro: 2, custom: 3 }
  const canAccess = (tier: string) => (tierOrder[userTier()] ?? 0) >= (tierOrder[tier] ?? 0)

  let fetchInFlight = false
  const fetchList = async (opts?: { force?: boolean }): Promise<boolean> => {
    if (!auth.isAuthenticated()) return false
    if (fetchInFlight && !opts?.force) return false
    fetchInFlight = true
    setListLoading(true)
    setListError(undefined)
    try {
      const data = await paddieApi.get<UITemplateMeta[]>("/studio/ui-templates")
      setList(data)
      setListError(undefined)
      if (data.length > 0 && !id()) setID(data[0].id)
      return true
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load templates")
      return false
    } finally {
      setListLoading(false)
      fetchInFlight = false
    }
  }

  const fetchDetail = async (templateId: string, opts?: { force?: boolean }): Promise<boolean> => {
    if (!opts?.force && detailCache()[templateId]) return true
    try {
      setDetailLoading(true)
      const data = await paddieApi.get<UITemplate>(
        `/studio/ui-templates/${templateId}?v=${Date.now()}`,
      )
      setDetailCache((prev) => ({ ...prev, [templateId]: data }))
      return true
    } catch (err) {
      if (err instanceof UpgradeRequiredError) {
        setUpgradeInfo({ required_tier: err.required_tier, current_tier: err.current_tier })
        setShowUpgrade(true)
        setView("library")
        return false
      }
      showToast({ variant: "error", title: "Failed to load template", description: err instanceof Error ? err.message : String(err) })
      setView("library")
      return false
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshTemplates = async () => {
    const cur = id()
    const onDetail = view() === "detail"
    const listOk = await fetchList({ force: true })
    if (!listOk) {
      showToast({
        variant: "error",
        title: "Could not refresh templates",
        description: "Check your connection and try again.",
      })
      return
    }
    if (onDetail && cur) {
      setDetailCache((prev) => (prev[cur] ? { [cur]: prev[cur] } : {}))
      setDocCache((prev) => {
        const next = { ...prev }
        delete next[cur]
        return next
      })
      const detailOk = await fetchDetail(cur, { force: true })
      if (!detailOk) return
    } else {
      setDetailCache({})
      setDocCache({})
    }
    showToast({ title: "Templates refreshed", description: "Loaded the latest list from Paddie." })
  }

  createEffect(() => {
    const authenticated = auth.isAuthenticated()
    if (authenticated) void fetchList()
  })
  const preset = createMemo(() => {
    const next = device()
    if (next === "desktop") return views[desk()]
    return views[next]
  })
  const chrome = 40
  const boxW = createMemo(() => Math.max(0, w() - 32))
  const boxH = createMemo(() => Math.max(0, h() - 32))
  const frameW = createMemo(() => preset().w)
  const shellH = createMemo(() => preset().h + chrome)
  const fitScale = createMemo(() => {
    const x = boxW()
    if (!x) return 1
    if (device() === "desktop") return Math.min(1, x / frameW())
    const y = boxH()
    if (!y) return Math.min(1, x / frameW())
    return Math.min(1, x / frameW(), y / shellH())
  })
  const scale = createMemo(() => fitScale() * (zoom() / 100))
  const scaledW = createMemo(() => Math.max(0, Math.floor(frameW() * scale())))
  const scaledH = createMemo(() => Math.max(0, Math.floor(shellH() * scale())))
  const canvasH = createMemo(() => Math.max(device() === "desktop" ? 520 : 420, scaledH() + 32))
  const zoomText = createMemo(() => `${zoom()}%`)

  const fit = () => {
    const nextW = Math.ceil(stage?.clientWidth ?? 0)
    const nextH = Math.ceil(stage?.clientHeight ?? 0)
    if (!nextW || !nextH) return
    if (nextW === w() && nextH === h()) return
    setW(nextW)
    setH(nextH)
  }

  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const open = async (next: string) => {
    setID(next)
    setPID("full")
    setPick(false)
    setDoc("")
    setWait(false)
    setParts(false)
    setDevice("desktop")
    setDesk("1920")
    setZoom(100)
    await fetchDetail(next)
    if (detailCache()[next]) setView("detail")
  }

  const back = () => {
    setPick(false)
    setDoc("")
    setWait(false)
    setParts(false)
    setView("library")
  }

  const zoomOut = () => setZoom((value) => clamp(value - 10, 50, 200))
  const zoomIn = () => setZoom((value) => clamp(value + 10, 50, 200))
  const zoomReset = () => setZoom(100)

  const attach = (
    next?: string,
    opts?: {
      selector?: string
      label?: string
      html?: string
      text?: string
      focus?: boolean
      toast?: boolean
    },
  ) => {
    const cur = tpl()
    if (!cur) return
    const item = part(cur, next ?? pid()) ?? cur.parts[0]
    if (!item) return
    setPID(item.id)
    prompt.context.add({
      type: "template",
      templateID: cur.id,
      templateName: cur.name,
      description: item.id === "full" ? cur.description : item.description,
      stack: cur.stack,
      partID: item.id,
      partName: item.name,
      hint: item.hint,
      selector: opts?.selector,
      label: opts?.label,
      html: opts?.html,
      text: opts?.text,
      files: filesFor(cur, item),
    })
    if (opts?.focus ?? true) focus()
    if (opts?.focus === false && props.chatHidden) props.onChatToggle?.()
    if (opts?.toast ?? true) {
      showToast({
        title: "Template added to chat",
        description: opts?.label ? `${cur.name} - ${opts.label}` : `${cur.name} - ${item.name}`,
      })
    }
  }

  const attachWorkflow = (payload: WorkflowAttachPayload) => {
    const flow = payload.flow
    const codegen = payload.codegen
    for (const item of prompt.context.items()) {
      if (item.type === "workflow" && item.workflowID === flow.id) {
        prompt.context.remove(item.key)
      }
    }
    prompt.context.add({
      type: "workflow",
      workflowID: flow.id,
      workflowName: flow.name,
      description: flow.description,
      status: flow.status,
      method: flow.webhook?.method,
      webhookUrl: codegen.webhookUrl,
      language: codegen.language,
      code: codegen.code,
      nodes: flow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        name: node.name,
        config: node.config,
      })),
      edges: flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        condition: edge.condition,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      revision: flow.revision,
      updatedAt: flow.updatedAt,
    })
    focus()
    showToast({
      title: "Workflow added to chat",
      description: `${flow.name} is ready to use in code.`,
    })
  }

  const create = async () => {
    const cur = tpl()
    const fs = platform.workbench
    if (!cur || !fs || !platform.openDirectoryPickerDialog) {
      showToast({
        variant: "error",
        title: "Templates need the desktop app",
        description: "Create-from-template is only available in the desktop build.",
      })
      return
    }

    const parent = await platform.openDirectoryPickerDialog({
      title: "Choose a parent folder",
      multiple: false,
    })
    const root = Array.isArray(parent) ? parent[0] : parent
    if (!root) return

    const raw = window.prompt("Project name", slug(cur.name))
    const name = raw?.trim()
    if (!name) return

    const next = await fs
      .create({ parent: root, name: slug(name), files: materialize(cur, name) })
      .catch((err) => {
        showToast({
          variant: "error",
          title: "Could not create project",
          description: err instanceof Error ? err.message : String(err),
        })
        return
      })
    if (!next) return

    layout.projects.open(next)
    server.projects.touch(next)
    navigate(`/${base64Encode(next)}`)
    showToast({
      title: "Project created",
      description: next,
    })
  }

  const loadPick = async () => {
    const cur = tpl()
    if (!cur) return
    const cached = docCache()[cur.id]
    if (cached) {
      setDoc(cached)
      setPick(true)
      return
    }
    const link = previewUrl(cur)
    const text = html()
    const hasPreviewHtml = text.trim() && templateGalleryPreviewReady(text)
    setWait(true)
    try {
      const next =
        hasPreviewHtml
          ? text
          : link
            ? await (platform.fetch ?? fetch)(link)
                .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
                .catch(() => text)
            : text
      if (!next.trim()) {
        showToast({
          variant: "error",
          title: "Could not load template picker",
          description: "No preview document was available for this template.",
        })
        return
      }
      const value = previewDoc(link, next, cur.parts)
      setDocCache((prev) => ({ ...prev, [cur.id]: value }))
      setDoc(value)
      setPick(true)
    } catch (err) {
      showToast({
        variant: "error",
        title: "Could not load template picker",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setWait(false)
    }
  }

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow) return
      if (typeof event.data !== "object" || !event.data) return
      if ((event.data as { source?: string }).source !== "paddie-studio-template") return
      if ((event.data as { type?: string }).type === "cancel") {
        setPick(false)
        setDoc("")
        setWait(false)
        return
      }
      if ((event.data as { type?: string }).type !== "pick") return
      const data = (event.data as {
        payload?: {
          id?: string
          selector?: string
          label?: string
          html?: string
          text?: string
        }
      }).payload
      if (!data) return
      const cur = tpl()
      const item = cur && data.id ? part(cur, data.id) : undefined
      setPID(item?.id ?? "full")
      setParts(true)
      attach(item?.id ?? "full", {
        selector: data.selector,
        label: data.label,
        html: data.html,
        text: data.text,
        focus: false,
        toast: false,
      })
      showToast({
        title: "Template element added",
        description: item ? `${cur?.name} - ${item.name} - picker still active` : "Picker still active",
      })
    }

    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  createEffect(() => {
    view()
    parts()
    device()
    desk()
    queueMicrotask(fit)
    requestAnimationFrame(fit)
  })

  createResizeObserver(
    () => stage,
    fit,
  )

  const deskButton = (value: Desk) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center justify-center border min-w-max": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border": desk() === value && device() === "desktop",
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": desk() !== value || device() !== "desktop",
      }}
      onClick={() => {
        setDevice("desktop")
        setDesk(value)
      }}
    >
      {views[value].label}
    </button>
  )

  const deviceButton = (value: Device, label: string) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center justify-center border": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border": device() === value,
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": device() !== value,
      }}
      onClick={() => setDevice(value)}
    >
      {label}
    </button>
  )

  const tab = (value: StudioSection, label: string) => (
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
    <div class="size-full overflow-hidden">
      <div class="size-full overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)]">
        <Show when={showUpgrade()}>
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div class="w-full max-w-md rounded-[20px] border border-border-weaker-base bg-surface-base p-6 shadow-[var(--shadow-lg-border-base)]">
              <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Upgrade required</div>
              <div class="mt-2 text-18-medium text-text-base">This template requires a higher plan</div>
              <div class="mt-2 text-13-medium text-text-weak">
                Your current plan is <span class="font-semibold text-text-base capitalize">{upgradeInfo()?.current_tier ?? "free"}</span>.
                This template requires the <span class="font-semibold text-text-base capitalize">{upgradeInfo()?.required_tier ?? "pro"}</span> plan or above.
              </div>
              <div class="mt-6 flex gap-3">
                <Button class="flex-1" onClick={() => platform.openLink("https://paddie.io/pricing")}>
                  View plans
                </Button>
                <Button variant="ghost" onClick={() => setShowUpgrade(false)}>
                  Maybe later
                </Button>
              </div>
            </div>
          </div>
        </Show>

        <Show
          when={view() === "detail" && tpl()}
          fallback={
            <div class="size-full overflow-auto bg-background-base">
              <div class="flex min-h-full w-full flex-col gap-3">
                <div class="rounded-[20px] border border-border-weaker-base bg-surface-base px-4 py-4">
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                      <div class="size-10 rounded-xl border border-border-weaker-base bg-background-stronger flex items-center justify-center shadow-xs-border">
                        <Mark class="size-5 text-icon-info-base" />
                      </div>
                      <div class="min-w-0">
                        <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Studio</div>
                        <div class="text-15-medium text-text-base">Templates, inspiration & workflows</div>
                      </div>
                    </div>
                    <div class="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <div class="rounded-xl border border-border-weaker-base bg-background-base p-1 flex items-center gap-1">
                        {tab("templates", "Templates")}
                        {tab("inspiration", "Inspiration")}
                        {tab("workflow", "Workflow Builder")}
                      </div>
                      <Show when={auth.isAuthenticated()}>
                        <div class="flex items-center gap-2 shrink-0">
                          <Show when={section() === "templates"}>
                            <Button
                              variant="ghost"
                              class="h-8 px-2 text-11-medium text-text-weak"
                              onClick={() => void refreshTemplates()}
                              title="Reload templates from Paddie"
                            >
                              Refresh
                            </Button>
                          </Show>
                          <div class="flex items-center gap-2 rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-1.5">
                            <div class="size-2 rounded-full bg-icon-success-base" />
                            <span class="text-11-medium text-text-weak truncate max-w-[160px]">{auth.user()?.email ?? "Signed in"}</span>
                            <Show when={auth.subscription()}>
                              <span class="rounded-full border border-border-weaker-base px-1.5 py-0.5 text-10-medium text-text-weak capitalize">
                                {auth.subscription()!.plan_slug}
                              </span>
                            </Show>
                          </div>
                          <Button
                            variant="ghost"
                            class="h-8 px-2 text-11-medium text-text-weak"
                            onClick={() => {
                              auth.logout()
                              setList([])
                              setListError(undefined)
                            }}
                          >
                            Sign out
                          </Button>
                        </div>
                      </Show>
                    </div>
                  </div>
                  <div class="mt-3 max-w-[780px] text-13-medium text-text-weak">
                    {section() === "workflow"
                      ? "Build and manage Paddie workflows with the same account used for Studio templates."
                      : section() === "inspiration"
                        ? "Browse a public website, capture a selectable snapshot, and attach page or element references to chat."
                        : "Browse a starter first, then open it in a desktop canvas. Curated parts stay hidden until you select one or open them yourself."}
                  </div>
                </div>

                <Show when={section() === "inspiration"}>
                  <InspirationPanel chatHidden={props.chatHidden} onChatToggle={props.onChatToggle} />
                </Show>

                <Show when={section() === "workflow"}>
                  <Show
                    when={auth.isAuthenticated()}
                    fallback={
                      <LoginCard
                        desc="Use your Paddie account to access Workflow Builder"
                        openLink={(url) => platform.openLink(url)}
                      />
                    }
                  >
                    <WorkflowBuilder onAttachWorkflow={attachWorkflow} />
                  </Show>
                </Show>

                <Show when={section() === "templates"}>
                  <Show when={!auth.isAuthenticated()}>
                    <LoginCard openLink={(url) => platform.openLink(url)} />
                  </Show>

                  <Show when={auth.isAuthenticated() && listLoading()}>
                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <For each={[1, 2, 3]}>{() => (
                        <div class="animate-pulse rounded-[20px] border border-border-weaker-base bg-background-stronger p-4">
                          <div class="rounded-[16px] bg-[#111218]" style={{ height: `${miniH + 16}px` }} />
                          <div class="mt-4 h-5 w-3/4 rounded bg-background-base" />
                          <div class="mt-2 h-4 w-full rounded bg-background-base" />
                          <div class="mt-4 h-4 w-1/3 rounded bg-background-base" />
                        </div>
                      )}</For>
                    </div>
                  </Show>

                  <Show when={auth.isAuthenticated() && !listLoading() && listError()}>
                    <div class="rounded-[20px] border border-border-weaker-base bg-surface-base p-6 text-center">
                      <div class="text-14-medium text-text-weak">{listError()}</div>
                      <Button class="mt-3" variant="ghost" onClick={() => void fetchList({ force: true })}>Retry</Button>
                    </div>
                  </Show>

                  <Show when={auth.isAuthenticated() && !listLoading() && !listError()}>
                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <For each={list()}>
                        {(item) => {
                          const locked = () => !canAccess(item.tier)
                          return (
                            <div
                              role="button"
                              tabIndex={0}
                              classList={{
                                "rounded-[20px] border border-border-weaker-base bg-background-stronger p-4 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-weak-base": true,
                                "hover:bg-surface-base-hover": !locked(),
                                "opacity-75": locked(),
                              }}
                              onClick={() => void open(item.id)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return
                                event.preventDefault()
                                void open(item.id)
                              }}
                            >
                            <div
                              class="relative overflow-hidden rounded-[16px] border border-border-weaker-base bg-[#111218]"
                              style={{ height: `${miniH + 16}px` }}
                            >
                              <div class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[#111218] via-[rgba(17,18,24,0.78)] to-transparent" />
                              <div class="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_48%)]" />
                              <div class="absolute inset-0 overflow-hidden p-2 flex items-start justify-center">
                                <div class="relative shrink-0" style={{ width: `${miniW}px`, height: `${miniH}px` }}>
                                  <div
                                    class="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[12px] border border-border-weaker-base bg-[#14151d] shadow-[var(--shadow-lg-border-base)]"
                                    style={{
                                      width: `${mini.w}px`,
                                      height: `${mini.h}px`,
                                      transform: `scale(${mini.scale})`,
                                    }}
                                  >
                                    <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
                                      <div class="size-2 rounded-full bg-[#f87171]" />
                                      <div class="size-2 rounded-full bg-[#fbbf24]" />
                                      <div class="size-2 rounded-full bg-[#34d399]" />
                                      <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                                        {item.name}
                                      </div>
                                    </div>
                                    <img
                                      src={item.thumb_url?.trim() || DEFAULT_TEMPLATE_THUMB_DATA_URL}
                                      class="block h-[calc(100%-40px)] w-full object-cover"
                                      alt={`${item.name} preview`}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#111218] via-[rgba(17,18,24,0.88)] to-transparent" />
                              <div class="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5">
                                <Show when={item.is_active === false}>
                                  <div class="rounded-full border border-border-weaker-base bg-black/35 px-2 py-0.5 text-10-medium text-text-weak backdrop-blur-sm">
                                    Inactive
                                  </div>
                                </Show>
                                <Show when={item.preview_ready === false}>
                                  <div class="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-10-medium text-amber-200 backdrop-blur-sm">
                                    Preview pending
                                  </div>
                                </Show>
                                <Show when={item.tier !== "free"}>
                                  <div classList={{
                                    "rounded-full px-2 py-0.5 text-10-medium backdrop-blur-sm border": true,
                                    "border-yellow-500/30 bg-yellow-500/15 text-yellow-400": item.tier === "basic",
                                    "border-purple-500/30 bg-purple-500/15 text-purple-400": item.tier === "pro",
                                    "border-sky-500/30 bg-sky-500/15 text-sky-400": item.tier === "custom",
                                  }}>
                                    {item.tier.charAt(0).toUpperCase() + item.tier.slice(1)}
                                  </div>
                                </Show>
                                <div class="rounded-full border border-border-weaker-base bg-background-base/85 px-2 py-0.5 text-10-medium text-text-weak backdrop-blur-sm">
                                  {item.stack}
                                </div>
                              </div>
                              <Show when={locked()}>
                                <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                                  <div class="rounded-full border border-border-weaker-base bg-background-base/90 px-3 py-1.5 text-11-medium text-text-base shadow-lg backdrop-blur-sm">
                                    Upgrade to {item.tier}
                                  </div>
                                </div>
                              </Show>
                            </div>
                            <div class="mt-4 flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="text-16-medium text-text-base">{item.name}</div>
                                <div class="mt-2 text-13-medium text-text-weak">{item.description}</div>
                              </div>
                            </div>
                            <div class="mt-4 flex items-center justify-between gap-3">
                              <div class="text-11-medium text-text-weak">{item.parts_count} curated parts</div>
                              <div class="rounded-full border border-border-weaker-base px-3 py-1 text-11-medium text-text-base">
                                {locked() ? "Locked" : "Open template"}
                              </div>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
                </Show>
              </div>
            </div>
          }
        >
          {(cur) => (
            <div class="size-full overflow-auto bg-background-base">
              <Show when={detailLoading()}>
                <div class="flex items-center justify-center py-12">
                  <div class="text-13-medium text-text-weak animate-pulse">Loading template...</div>
                </div>
              </Show>
              <div class="min-h-full min-w-0 flex flex-col gap-3">
                <div class="rounded-[18px] border border-border-weaker-base bg-surface-base px-4 py-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Bundled starter</div>
                      <div class="rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                        {cur().stack}
                      </div>
                      <Show when={parts()}>
                        <div class="rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                          Selected: {hit()?.name ?? "Full template"}
                        </div>
                      </Show>
                    </div>
                    <div class="mt-2 text-18-medium text-text-base">{cur().name}</div>
                    <div class="mt-1 max-w-[820px] text-12-medium text-text-weak">{cur().description}</div>
                    <Show when={!templateGalleryPreviewReady(cur().preview)}>
                      <div class="mt-2 max-w-[820px] rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-12-medium text-text-weak">
                        Gallery preview is not generated yet (or SSR failed for this starter). You can still create a
                        project from the files. Charts and other client-only widgets fill in after{" "}
                        <span class="text-text-base font-medium">npm install</span> and{" "}
                        <span class="text-text-base font-medium">npm run dev</span>.
                      </div>
                    </Show>
                    <Show when={templateIsReactProject(cur())}>
                      <div class="mt-2 max-w-[820px] rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-12-medium text-text-weak">
                        This starter is a full React + Vite project. The canvas shows a server-rendered snapshot plus
                        built styles (no client bundle in the iframe). After you create the project locally, run{" "}
                        <span class="text-text-base font-medium">npm install</span> and{" "}
                        <span class="text-text-base font-medium">npm run dev</span> for the interactive app.
                      </div>
                    </Show>
                  </div>
                </div>

                <div
                  class={
                    parts()
                      ? "min-w-0 flex-1 grid gap-3 items-start xl:grid-cols-[minmax(0,1fr)_320px]"
                      : "min-w-0 flex flex-col"
                  }
                >
                  <div class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)] flex flex-col">
                    <div class="min-h-11 border-b border-border-weaker-base bg-[#111218] flex flex-wrap items-center gap-2 px-4 py-2">
                      <div class="size-2 rounded-full bg-[#f87171]" />
                      <div class="size-2 rounded-full bg-[#fbbf24]" />
                      <div class="size-2 rounded-full bg-[#34d399]" />
                      <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                        {cur().name} preview
                      </div>
                      <Button
                        variant={parts() ? "secondary" : "ghost"}
                        class="h-7 px-2 text-11-medium"
                        onClick={() => setParts((value) => !value)}
                      >
                        {parts() ? "Hide curated parts" : "Show curated parts"}
                      </Button>
                      <Button variant="ghost" class="h-7 px-2 text-11-medium" onClick={() => attach("full")}>
                        Attach full template
                      </Button>
                      <Button class="h-7 px-2 text-11-medium" onClick={() => void create()}>
                        Create starter project
                      </Button>
                      <Button
                        variant={pick() ? "secondary" : "ghost"}
                        class="h-7 px-2 text-11-medium"
                        disabled={wait()}
                        onClick={() => {
                          if (pick()) {
                            setPick(false)
                            setDoc("")
                            setWait(false)
                            return
                          }
                          void loadPick()
                        }}
                      >
                        {pick() ? "Stop selecting" : "Select from preview"}
                      </Button>
                    </div>

                    <div class="border-b border-border-weaker-base p-3 flex flex-col gap-3 bg-background-stronger">
                      <div class="flex flex-wrap items-center gap-2 justify-between">
                        <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2">
                          <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={back}>
                            Back to library
                          </Button>
                          <Button
                            variant="ghost"
                            class="h-8 px-3 text-11-medium"
                            onClick={() => void refreshTemplates()}
                            title="Reload template list and this template from Paddie"
                          >
                            Refresh
                          </Button>
                          <div class="min-w-0 h-9 flex-1 rounded-xl border border-border-weaker-base bg-background-base px-3 flex items-center gap-2">
                            <div class={`size-2 rounded-full ${pick() ? "bg-icon-info-base" : "bg-icon-success-base"}`} />
                            <div class="min-w-0 flex-1 truncate text-11-medium text-text-weak">
                              {wait()
                                ? "Loading the template picker..."
                                : pick()
                                ? "Selection mode is on. Click any highlighted element to add it to chat."
                                : "Browsing in desktop mode by default. Switch sizes when you want to inspect the layout."}
                            </div>
                          </div>
                        </div>
                        <div class="min-w-0 shrink-0 max-w-full rounded-xl border border-border-weaker-base bg-background-base p-1 flex items-center gap-1 overflow-x-auto">
                          <Button
                            variant="ghost"
                            class="h-8 px-2 text-11-medium shrink-0"
                            onClick={zoomOut}
                            disabled={zoom() <= 50}
                          >
                            -
                          </Button>
                          <Button
                            variant="ghost"
                            class="h-8 px-2 text-11-medium shrink-0"
                            onClick={zoomReset}
                          >
                            {zoomText()}
                          </Button>
                          <Button
                            variant="ghost"
                            class="h-8 px-2 text-11-medium shrink-0"
                            onClick={zoomIn}
                            disabled={zoom() >= 200}
                          >
                            +
                          </Button>
                          {deskButton("1920")}
                          {deskButton("1600")}
                          {deskButton("1440")}
                          {deviceButton("tablet", "Tablet")}
                          {deviceButton("mobile", "Mobile")}
                        </div>
                      </div>
                      <div class="text-11-medium text-text-weak">
                        {parts()
                          ? `Curated parts are open for ${hit()?.name ?? "Full template"}.`
                          : "Curated parts stay hidden until you select something or open the panel yourself."}
                      </div>
                    </div>

                    <div class="bg-background-stronger p-3" style={{ height: `${canvasH()}px` }}>
                      <div ref={stage} class="size-full min-w-0 overflow-auto rounded-[22px] bg-[#181922]">
                        <div class="box-border min-h-full min-w-full overflow-hidden flex items-start justify-center p-4">
                          <div class="relative shrink-0" style={{ width: `${scaledW()}px`, height: `${scaledH()}px` }}>
                            <div
                              class="absolute left-0 top-0 box-border overflow-hidden rounded-[22px] border border-border-weaker-base bg-[#14151d] shadow-[var(--shadow-lg-border-base)] flex flex-col"
                              style={{
                                width: `${frameW()}px`,
                                height: `${shellH()}px`,
                                transform: `scale(${scale()})`,
                                "transform-origin": "top left",
                              }}
                            >
                              <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
                                <div class="size-2 rounded-full bg-[#f87171]" />
                                <div class="size-2 rounded-full bg-[#fbbf24]" />
                                <div class="size-2 rounded-full bg-[#34d399]" />
                                <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                                  {cur().name}
                                </div>
                              </div>
                              <iframe
                                ref={frame}
                                src={pick() ? undefined : url() || undefined}
                                srcdoc={pick() ? doc() : (!url() ? browseDoc() : undefined)}
                                sandbox="allow-scripts allow-same-origin"
                                class="block min-h-0 flex-1 w-full border-0 bg-white"
                                title={`${cur().name} preview`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Show when={parts()}>
                    <div class="min-h-0 overflow-auto rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)] p-3">
                      <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Curated parts</div>
                      <div class="mt-2 text-13-medium text-text-base">Selected parts and reference files</div>
                      <div class="mt-3 space-y-2">
                        <For each={cur().parts}>
                          {(item) => (
                            <div
                              classList={{
                                "rounded-[18px] border px-3 py-3 transition-colors cursor-pointer": true,
                                "border-border-weak-base bg-background-stronger shadow-xs-border": pid() === item.id,
                                "border-border-weaker-base bg-surface-base": pid() !== item.id,
                              }}
                              onClick={() => {
                                setPID(item.id)
                                setParts(true)
                              }}
                            >
                              <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                  <div class="text-13-medium text-text-base">{item.name}</div>
                                  <div class="mt-1 text-12-medium text-text-weak">{item.description}</div>
                                </div>
                                <Button
                                  variant="ghost"
                                  class="h-8 px-2 text-11-medium shrink-0"
                                  onClick={(event: MouseEvent) => {
                                    event.stopPropagation()
                                    setPID(item.id)
                                    setParts(true)
                                    attach(item.id)
                                  }}
                                >
                                  Add
                                </Button>
                              </div>
                              <div class="mt-3 flex flex-wrap gap-2">
                                <For each={filesFor(cur(), item)}>
                                  {(file) => (
                                    <div class="rounded-full border border-border-weaker-base px-2 py-1 text-10-medium text-text-weak">
                                      {file.path}
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
