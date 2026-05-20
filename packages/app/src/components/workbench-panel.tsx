import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { showToast } from "@opencode-ai/ui/toast"
import { TemplatePanel } from "@/components/template-panel"
import { WorkbenchEditor } from "@/components/workbench-editor"
import {
  comment as problemComment,
  label as problemLabel,
  selection as problemSelection,
  type Problem,
} from "@/components/workbench-problem"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { createSizing } from "@/pages/session/helpers"
import { previewFromSession, previewFromTerminals } from "@/utils/preview-url"
import { detectPreview } from "@/utils/workbench-preview"

type Node = {
  name: string
  path: string
  dir: boolean
  file: boolean
}

type Tab = {
  name: string
  path: string
  value: string
  saved: string
  dirty: boolean
}

type Mode = "code" | "split" | "preview"
type Surface = "studio" | "templates"
type Device = "desktop" | "tablet" | "mobile"
type Desk = "1920" | "1600" | "1440"

const views = {
  "1920": { w: 1920, h: 1080, label: "1920x1080" },
  "1600": { w: 1600, h: 900, label: "1600x900" },
  "1440": { w: 1440, h: 900, label: "1440x900" },
  tablet: { w: 834, h: 1194 },
  mobile: { w: 430, h: 932 },
} as const

const base = (path: string) => {
  const trim = path.replace(/[\\/]+$/, "")
  const parts = trim.split(/[\\/]/)
  return parts.at(-1) ?? trim
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const pickDoc = (url: string, html: string) => {
  const css = `<style>
html.__paddie_pick, html.__paddie_pick * { cursor: crosshair !important; }
.__paddie_pick_target { outline: 2px solid #60a5fa !important; outline-offset: 2px !important; }
</style>`
  const js = `<script>
(() => {
  const esc = window.CSS && CSS.escape ? CSS.escape.bind(CSS) : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
  const ok = (el) => el instanceof Element && !["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META"].includes(el.tagName)
  const nth = (el) => {
    const parent = el.parentElement
    if (!parent) return ""
    const kids = Array.from(parent.children).filter((item) => item.tagName === el.tagName)
    if (kids.length <= 1) return ""
    return ":nth-of-type(" + (kids.indexOf(el) + 1) + ")"
  }
  const cls = (el) => {
    const list = Array.from(el.classList).slice(0, 2)
    if (list.length === 0) return ""
    return list.map((item) => "." + esc(item)).join("")
  }
  const line = (el) => {
    let out = el.tagName.toLowerCase()
    if (el.id) out += "#" + el.id
    const list = Array.from(el.classList).slice(0, 2)
    if (list.length) out += "." + list.join(".")
    return out
  }
  const path = (el) => {
    const out = []
    let cur = el
    while (ok(cur)) {
      let item = cur.tagName.toLowerCase()
      if (cur.id) {
        out.unshift(item + "#" + esc(cur.id))
        break
      }
      item += cls(cur) + nth(cur)
      out.unshift(item)
      cur = cur.parentElement
    }
    return out.join(" > ")
  }
  const text = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240)
  let last
  const mark = (el) => {
    if (last === el) return
    if (last) last.classList.remove("__paddie_pick_target")
    last = el
    if (el) el.classList.add("__paddie_pick_target")
  }
  const post = (type, payload = {}) => parent.postMessage({ source: "paddie-studio-preview", type, payload }, "*")
  const find = (target) => {
    if (!(target instanceof Element)) return
    const hit = target.closest("*")
    if (!ok(hit)) return
    return hit
  }
  document.documentElement.classList.add("__paddie_pick")
  document.addEventListener("mousemove", (event) => {
    const hit = find(event.target)
    if (!hit) return
    mark(hit)
  }, true)
  document.addEventListener("click", (event) => {
    const hit = find(event.target)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    post("pick", {
      url: ${JSON.stringify(url)},
      selector: path(hit),
      label: line(hit),
      text: text(hit) || undefined,
      html: (hit.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 4000),
    })
  }, true)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    post("cancel")
  }, true)
  post("ready")
})()
</script>`

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${esc(url)}">${css}${js}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head><base href="${esc(url)}">${css}${js}</head>`)
  }

  return `<!doctype html><html><head><base href="${esc(url)}">${css}${js}</head><body>${html}</body></html>`
}

function Tree(props: {
  path: string
  level: number
  active: () => string
  load: (path: string, force?: boolean) => Promise<void>
  open: (path: string) => boolean
  wait: (path: string) => boolean
  tree: () => Record<string, Node[]>
  toggle: (path: string) => void
  file: (path: string) => Promise<void>
}) {
  const kids = createMemo(() => props.tree()[props.path] ?? [])
  const name = createMemo(() => base(props.path) || props.path)

  return (
    <div class="min-w-0">
      <button
        type="button"
        class="w-full h-7 px-2 rounded-md flex items-center gap-1.5 text-left hover:bg-surface-base-hover"
        style={{ "padding-left": `${8 + props.level * 12}px` }}
        onClick={() => {
          props.toggle(props.path)
          if (!props.tree()[props.path]) void props.load(props.path)
        }}
      >
        <Icon size="small" name={props.open(props.path) ? "chevron-down" : "chevron-right"} class="text-icon-base" />
        <FileIcon node={{ path: props.path, type: "directory" }} expanded={props.open(props.path)} class="size-4" />
        <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">{name()}</span>
      </button>

      <Show when={props.open(props.path)}>
        <Show when={props.wait(props.path) && kids().length === 0}>
          <div class="px-3 py-2 text-11-medium text-text-weak" style={{ "padding-left": `${34 + props.level * 12}px` }}>
            Loading...
          </div>
        </Show>
        <For each={kids()}>
          {(item) => (
            <Show
              when={item.dir}
              fallback={
                <button
                  type="button"
                  classList={{
                    "w-full h-7 px-2 rounded-md flex items-center gap-1.5 text-left hover:bg-surface-base-hover": true,
                    "bg-surface-base-active": props.active() === item.path,
                  }}
                  style={{ "padding-left": `${32 + props.level * 12}px` }}
                  onClick={() => void props.file(item.path)}
                >
                  <div class="size-3.5 shrink-0" />
                  <FileIcon node={{ path: item.path, type: "file" }} class="size-4" />
                  <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">{item.name}</span>
                </button>
              }
            >
              <Tree
                path={item.path}
                level={props.level + 1}
                active={props.active}
                load={props.load}
                open={props.open}
                wait={props.wait}
                tree={props.tree}
                toggle={props.toggle}
                file={props.file}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  )
}

export function WorkbenchPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
  onClose?: VoidFunction
}) {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const prompt = usePrompt()
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const terminal = useTerminal()
  const size = createSizing()
  const api = () => platform.workbench
  const root = createMemo(() => sync.data.path.directory || sdk.directory)
  const [state, setState] = createStore({
    files: true,
    left: 280,
    right: 420,
    box: 0,
    previewW: 0,
    previewH: 0,
    mode: "split" as Mode,
    surface: "studio" as Surface,
    device: "desktop" as Device,
    desk: "1920" as Desk,
    zoom: 100,
    tree: {} as Record<string, Node[]>,
    wait: {} as Record<string, boolean>,
    open: {} as Record<string, boolean>,
    tabs: [] as Tab[],
    active: "",
    staticUrl: "",
    staticPath: "",
    staticLabel: "",
    staticScan: false,
    pick: false,
    doc: "",
    waitPick: false,
  })

  let body: HTMLDivElement | undefined
  let frame: HTMLIFrameElement | undefined
  let stage: HTMLDivElement | undefined
  let stop: VoidFunction | undefined
  let tick: number | undefined
  let scan = 0
  const delay = 500
  const saves = new Map<string, number>()

  const tab = createMemo(() => state.tabs.find((item) => item.path === state.active))
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const detected = createMemo(
    () => previewFromSession(messages(), sync.data.part) ?? terminal.url() ?? previewFromTerminals(terminal.all()) ?? "",
  )
  const previewUrl = createMemo(() => detected() || state.staticUrl)
  const previewLabel = createMemo(() => detected() || state.staticLabel)
  const previewSource = createMemo(() => (detected() ? "live" : state.staticUrl ? "static" : "none"))
  const tree = () => state.tree
  const showFiles = createMemo(() => state.mode !== "preview" && state.files)
  const box = createMemo(() => state.box || 1200)
  const leftMin = 220
  const rightMin = 320
  const editMin = 320
  const leftMax = createMemo(() => {
    if (!showFiles()) return 0
    const keep = (state.mode === "split" ? Math.max(rightMin, state.right) : 0) + editMin
    return Math.max(0, Math.min(420, box() - keep))
  })
  const rightMax = createMemo(() => {
    if (state.mode !== "split") return box()
    const keep = (showFiles() ? Math.min(420, Math.max(leftMin, state.left)) : 0) + editMin
    return Math.max(0, box() - keep)
  })
  const leftFloor = createMemo(() => Math.min(leftMin, leftMax()))
  const rightFloor = createMemo(() => Math.min(rightMin, rightMax()))
  const left = createMemo(() => (showFiles() ? Math.max(0, Math.min(state.left, leftMax())) : 0))
  const right = createMemo(() => {
    if (state.mode === "code") return 0
    if (state.mode === "preview") return box()
    return Math.max(0, Math.min(state.right, rightMax()))
  })
  const edit = createMemo(() => Math.max(0, box() - left() - right()))
  const previewW = createMemo(() => Math.max(0, (state.previewW || right()) - 32))
  const previewH = createMemo(() => Math.max(0, state.previewH - 32))
  const chrome = 40
  const preset = createMemo(() => {
    if (state.device === "desktop") return views[state.desk]
    if (state.device === "tablet") return views.tablet
    if (state.device === "mobile") return views.mobile
    return null
  })
  const frameW = createMemo(() => {
    return preset()?.w ?? 1440
  })
  const shellH = createMemo(() => (preset()?.h ?? 900) + chrome)
  const fit = createMemo(() => {
    const w = previewW()
    if (!w) return 1
    if (state.device === "desktop") return Math.min(1, w / frameW())
    const h = previewH()
    if (!h) return Math.min(1, w / frameW())
    return Math.min(1, w / frameW(), h / shellH())
  })
  const scale = createMemo(() => fit() * (state.zoom / 100))
  const frameH = createMemo(() => {
    return shellH()
  })
  const scaledW = createMemo(() => Math.max(0, Math.floor(frameW() * scale())))
  const scaledH = createMemo(() => Math.max(0, Math.floor(frameH() * scale())))
  const zoom = createMemo(() => `${state.zoom}%`)
  const compact = createMemo(() => right() > 0 && right() < 760)
  const anim = createMemo(() =>
    size.active()
      ? "transition-none"
      : "transition-[width,opacity,transform] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
  )
  const open = (path: string) => !!state.open[path]
  const wait = (path: string) => !!state.wait[path]
  const setMode = (mode: Mode) => {
    setState("mode", mode)
    if (mode === "preview" || state.files) return
    openFiles()
  }
  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }
  const seed = (text: string) => {
    const cur = prompt.current()
    if (cur.length !== 1 || cur[0].type !== "text" || cur[0].content.trim()) return
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
  }
  const fix = (item: Problem) => {
    prompt.context.add({
      type: "file",
      path: item.path,
      selection: problemSelection(item),
      comment: problemComment(item),
    })
    seed("Fix this problem in the workspace.")
    focus()
    showToast({
      title: "Problem added to chat",
      description: `${base(item.path)} · ${problemLabel(item)}`,
    })
  }
  const stopPick = () => {
    setState("pick", false)
    setState("doc", "")
    setState("waitPick", false)
  }
  const pick = () => {
    const url = previewUrl()
    if (!url) {
      showToast({
        variant: "error",
        title: "No preview is running",
        description: "Run the app or open a workspace with an index.html file, then turn on element selection.",
      })
      return
    }

    if (state.pick) return stopPick()

    setState("waitPick", true)
    const run = platform.fetch ?? fetch
    const html =
      previewSource() === "static" && state.staticPath && api()
        ? api()!.read(state.staticPath)
        : run(url).then((res) => res.text())
    void html
      .then((html) => {
        setState("doc", pickDoc(url, html))
        setState("pick", true)
        setState("waitPick", false)
      })
      .catch(() => {
        setState("waitPick", false)
        showToast({
          variant: "error",
          title: "Could not load preview picker",
          description: url,
        })
      })
  }

  const reload = () => {
    const url = previewUrl()
    if (!url || !frame) return
    stopPick()
    frame.src = "about:blank"
    requestAnimationFrame(() => {
      if (!frame) return
      frame.src = url
    })
  }

  const openPreview = () => {
    const url = previewUrl()
    if (!url) return
    if (previewSource() === "static" && state.staticPath && platform.openPath) {
      void platform.openPath(state.staticPath)
      return
    }
    platform.openLink(url)
  }

  const zoomOut = () => setState("zoom", (value) => clamp(value - 10, 50, 200))
  const zoomIn = () => setState("zoom", (value) => clamp(value + 10, 50, 200))
  const zoomReset = () => setState("zoom", 100)

  const load = async (path: string, force = false) => {
    if (!api()) return
    if (!force && (state.tree[path] || state.wait[path])) return
    setState("wait", path, true)
    const next = await api()!
      .list(path)
      .then((list) => list.map((item) => ({ name: item.name, path: item.path, dir: item.dir, file: item.file })))
      .catch(() => null)
    setState("wait", path, false)
    if (!next) return
    setState("tree", path, next)
  }

  const read = async (path: string) => {
    if (!api()) return
    const hit = state.tabs.find((item) => item.path === path)
    if (hit) {
      setState("active", path)
      return
    }

    const next = await api()!.read(path).catch(() => null)
    if (next === null) {
      showToast({
        variant: "error",
        title: "Could not open file",
        description: path,
      })
      return
    }

    setState("tabs", (list) => [...list, { name: base(path), path, value: next, saved: next, dirty: false }])
    setState("active", path)
    if (state.mode === "preview") setState("mode", "split")
  }

  const save = async (path = tab()?.path, opts?: { quiet?: boolean }) => {
    if (!path || !api()) return false
    const cur = state.tabs.find((item) => item.path === path)
    if (!cur) return false
    const value = cur.value
    const ok = await api()!
      .write(path, value)
      .then(() => true)
      .catch(() => false)

    if (!ok) {
      if (!opts?.quiet) {
        showToast({
          variant: "error",
          title: "Could not save file",
          description: path,
        })
      }
      return false
    }

    setState("tabs", (list) =>
      list.map((item) => {
        if (item.path !== path) return item
        if (item.value !== value) return item
        return { ...item, saved: value, dirty: false }
      }),
    )
    return true
  }

  const queue = (path: string) => {
    const prev = saves.get(path)
    if (prev !== undefined) clearTimeout(prev)
    saves.set(
      path,
      window.setTimeout(() => {
        saves.delete(path)
        void save(path, { quiet: true })
      }, delay),
    )
  }

  const change = (path: string, value: string) => {
    setState("tabs", (list) =>
      list.map((item) => (item.path === path ? { ...item, value, dirty: value !== item.saved } : item)),
    )
    queue(path)
  }

  const close = async (path: string) => {
    const pending = saves.get(path)
    if (pending !== undefined) {
      clearTimeout(pending)
      saves.delete(path)
    }

    const cur = state.tabs.find((item) => item.path === path)
    if (cur?.dirty) {
      const ok = await save(path)
      if (!ok) return
    }

    const list = state.tabs.filter((item) => item.path !== path)
    setState("tabs", list)
    if (state.active !== path) return
    setState("active", list.at(-1)?.path ?? "")
  }

  const refresh = (paths?: string[]) => {
    if (tick !== undefined) clearTimeout(tick)
    tick = window.setTimeout(async () => {
      const dirs = Object.keys(state.open).filter((path) => state.open[path])
      await Promise.all(dirs.map((path) => load(path, true)))
      const clean = state.tabs.filter((item) => !item.dirty && (!paths || paths.some((path) => path === item.path)))
      await Promise.all(
        clean.map(async (item) => {
          if (!api()) return
          const next = await api()!.read(item.path).catch(() => null)
          if (next === null) return
          setState("tabs", (list) =>
            list.map((tab) => (tab.path === item.path ? { ...tab, value: next, saved: next, dirty: false } : tab)),
          )
        }),
      )
      void scanPreview()
    }, 180)
  }

  const scanPreview = async () => {
    const fs = api()
    const dir = root()
    const id = ++scan
    if (!fs || !dir) return

    setState("staticScan", true)
    const targets = await detectPreview({ fs, root: dir, os: platform.os }).catch(() => [])
    if (id !== scan) return

    const target = targets.find((item) => item.kind === "static")
    if (!target || target.kind !== "static" || !fs.previewUrl) {
      setState({
        staticUrl: "",
        staticPath: "",
        staticLabel: "",
        staticScan: false,
      })
      return
    }

    const url = await fs.previewUrl(target.path).catch(() => null)
    if (id !== scan) return
    setState({
      staticUrl: url ?? "",
      staticPath: url ? target.path : "",
      staticLabel: url ? target.label : "",
      staticScan: false,
    })
  }

  const openFiles = () => {
    setState("files", true)
    const next = Math.max(leftFloor(), Math.min(280, leftMax()))
    if (state.left <= 0 && next > 0) setState("left", next)
    void load(root(), true)
  }

  const fitPreview = () => {
    const nextW = Math.ceil(stage?.clientWidth ?? 0)
    const nextH = Math.ceil(stage?.clientHeight ?? 0)
    if (!nextW || !nextH) return
    if (nextW === state.previewW && nextH === state.previewH) return
    setState("previewW", nextW)
    setState("previewH", nextH)
  }

  const fitBody = () => {
    if (!body) return
    const style = getComputedStyle(body)
    const next = Math.ceil(
      body.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
    )
    if (!next || next === state.box) return
    setState("box", next)
  }

  createResizeObserver(
    () => body,
    fitBody,
  )

  createResizeObserver(
    () => stage,
    fitPreview,
  )

  createEffect(() => {
    state.mode
    state.surface
    state.device
    state.desk
    props.chatHidden
    queueMicrotask(fitBody)
    queueMicrotask(fitPreview)
    requestAnimationFrame(fitBody)
    requestAnimationFrame(fitPreview)
  })

  createEffect(() => {
    const dir = root()
    const fs = api()
    if (!dir || !fs) return
    stop?.()
    setState("open", dir, true)
    void load(dir, true)
    void scanPreview()
    void fs.watch(dir, (event) => refresh(event.paths)).then((fn) => {
      stop = fn
    })
  })

  createEffect(() => {
    const max = leftMax()
    if (!showFiles()) return
    if (state.left <= 0 && max > 0) {
      setState("left", Math.max(leftFloor(), Math.min(280, max)))
      return
    }
    if (state.left <= max) return
    setState("left", Math.round(max))
  })

  createEffect(() => {
    const max = rightMax()
    if (state.right <= max) return
    setState("right", Math.round(max))
  })

  command.register("workbench.preview", () => {
    const list = [
      {
        id: "workbench.surface.studio",
        title: "Show Workspace",
        category: "Workbench",
        disabled: state.surface === "studio",
        onSelect: () => setState("surface", "studio"),
      },
      {
        id: "workbench.surface.templates",
        title: "Show Studio",
        category: "Workbench",
        disabled: state.surface === "templates",
        onSelect: () => setState("surface", "templates"),
      },
      {
        id: "workbench.mode.code",
        title: "Show Code",
        category: "Workbench",
        disabled: state.mode === "code" || state.surface !== "studio",
        onSelect: () => setMode("code"),
      },
      {
        id: "workbench.mode.split",
        title: "Show Code + Preview",
        category: "Workbench",
        disabled: state.mode === "split" || state.surface !== "studio",
        onSelect: () => setMode("split"),
      },
      {
        id: "workbench.mode.preview",
        title: "Show Preview",
        category: "Workbench",
        disabled: state.mode === "preview" || state.surface !== "studio",
        onSelect: () => setMode("preview"),
      },
      {
        id: "workbench.explorer.toggle",
        title: state.files ? "Hide Explorer" : "Show Explorer",
        category: "Workbench",
        disabled: state.surface !== "studio",
        onSelect: () => {
          if (state.files) {
            setState("files", false)
            return
          }
          openFiles()
        },
      },
    ]

    if (props.onChatToggle) {
      list.push({
        id: "workbench.chat.toggle",
        title: props.chatHidden ? "Show Chat" : "Hide Chat",
        category: "Workbench",
        disabled: false,
        onSelect: props.onChatToggle,
      })
    }

    return list
  })

  createEffect(
    on(
      previewUrl,
      (next, prev) => {
        if (!next || next === prev) return
        stopPick()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => `${root()}\n${params.id ?? ""}`,
      () => {
        stopPick()
        setState({
          staticUrl: "",
          staticPath: "",
          staticLabel: "",
          staticScan: false,
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow) return
      if (typeof event.data !== "object" || !event.data) return
      if ((event.data as { source?: string }).source !== "paddie-studio-preview") return

      const type = (event.data as { type?: string }).type
      if (type === "cancel") {
        stopPick()
        return
      }

      if (type !== "pick") return
      const data = (event.data as { payload?: Record<string, unknown> }).payload
      if (!data) return
      const url = typeof data.url === "string" ? data.url : previewUrl()
      const selector = typeof data.selector === "string" ? data.selector : ""
      const label = typeof data.label === "string" ? data.label : selector || "selected element"
      const html = typeof data.html === "string" ? data.html : ""
      const text = typeof data.text === "string" ? data.text : undefined
      if (!url || !selector || !html) return

      prompt.context.items()
        .filter((item) => item.type === "element" && item.url === url && item.selector === selector)
        .forEach((item) => prompt.context.remove(item.key))

      prompt.context.add({
        type: "element",
        url,
        selector,
        label,
        html,
        text,
      })
      if (props.chatHidden) props.onChatToggle?.()
      requestAnimationFrame(() => {
        const node = document.querySelector('[data-component="prompt-input"]')
        if (node instanceof HTMLElement) node.focus()
      })
      showToast({
        title: "Element added to chat",
        description: `${label} · picker still active`,
      })
    }

    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  onCleanup(() => {
    stop?.()
    if (tick !== undefined) clearTimeout(tick)
    Array.from(saves.values()).forEach((id) => clearTimeout(id))
    state.tabs.filter((item) => item.dirty).forEach((item) => void save(item.path, { quiet: true }))
  })

  const pane = "h-full shrink-0 min-w-0 overflow-hidden will-change-[width,opacity]"
  const seg = "h-10 shrink-0 rounded-2xl border border-border-weaker-base bg-surface-base/95 p-1 shadow-xs-border backdrop-blur-sm flex items-center gap-1"
  const surfaceButton = (value: Surface, icon: "dot-grid" | "layout-right-full", label: string) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center gap-1.5 border": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border": state.surface === value,
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": state.surface !== value,
      }}
      onClick={() => setState("surface", value)}
    >
      <Icon name={icon} size="small" />
      {label}
    </button>
  )

  if (!api()) {
    return (
      <div class="size-full flex items-center justify-center bg-background-base">
        <div class="text-14-medium text-text-weak">Workbench is only available in the desktop app.</div>
      </div>
    )
  }

  const modeButton = (value: Mode, icon: "code" | "layout-right-partial" | "eye", label: string) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center gap-1.5 border": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border": state.mode === value,
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": state.mode !== value,
      }}
      onClick={() => setMode(value)}
    >
      <Icon name={icon} size="small" />
      {label}
    </button>
  )
  const deviceButton = (value: Device, label: string) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center justify-center border": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border": state.device === value,
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": state.device !== value,
      }}
      onClick={() => setState("device", value)}
    >
      {label}
    </button>
  )
  const deskLabel = (value: Desk) => `${views[value].w}x${views[value].h}`
  const deskButton = (value: Desk) => (
    <button
      type="button"
      classList={{
        "h-8 shrink-0 px-3 rounded-xl text-11-medium transition-all duration-150 flex items-center justify-center border min-w-max": true,
        "border-border-weak-base bg-background-stronger text-text-strong shadow-xs-border":
          state.desk === value && state.device === "desktop",
        "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base":
          state.desk !== value || state.device !== "desktop",
      }}
      onClick={() => {
        setState("device", "desktop")
        setState("desk", value)
      }}
      title={deskLabel(value)}
    >
      {deskLabel(value)}
    </button>
  )

  return (
    <div
      class="size-full bg-background-base flex flex-col overflow-hidden"
      style={{ background: "radial-gradient(circle at top, rgba(255,255,255,0.04), transparent 34%)" }}
    >
      <div class="shrink-0 border-b border-border-weaker-base bg-background-base/95 backdrop-blur-sm px-3 py-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2.5">
            <div class="h-10 shrink-0 min-w-0 max-w-full px-3.5 rounded-2xl border border-border-weaker-base bg-surface-base/95 flex items-center gap-2.5 shadow-xs-border backdrop-blur-sm">
              <div class="size-8 rounded-xl bg-background-stronger flex items-center justify-center text-icon-info-base shadow-xs-border">
                <Mark class="size-4.5 text-icon-info-base" />
              </div>
              <div class="min-w-0 flex items-center gap-2.5">
                <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-weak shrink-0">Studio</div>
                <div class="h-4 w-px bg-border-weaker-base shrink-0" />
                <div class="max-w-40 truncate text-13-medium text-text-strong">{base(root()) || root()}</div>
              </div>
            </div>

            <div class={seg}>
              {surfaceButton("studio", "dot-grid", "Workspace")}
              {surfaceButton("templates", "layout-right-full", "Studio")}
            </div>

            <Show when={state.surface === "studio"}>
              <div class={seg}>
                {modeButton("code", "code", "Code")}
                {modeButton("split", "layout-right-partial", "Split")}
                {modeButton("preview", "eye", "Preview")}
              </div>
              <Show when={state.mode !== "preview"}>
                <button
                  type="button"
                  classList={{
                    "h-10 shrink-0 px-3.5 rounded-2xl text-11-medium transition-all duration-150 flex items-center gap-2 border shadow-xs-border": true,
                    "border-border-weak-base bg-surface-base-active text-text-strong": state.files,
                    "border-border-weaker-base bg-surface-base/95 text-text-weak hover:bg-surface-base-hover hover:text-text-base": !state.files,
                  }}
                  onClick={() => {
                    if (state.files) {
                      setState("files", false)
                      return
                    }
                    openFiles()
                  }}
                >
                  <Icon name={state.files ? "file-tree-active" : "file-tree"} size="small" />
                  Explorer
                </button>
              </Show>
            </Show>
          </div>

          <div class="shrink-0 flex flex-wrap items-center justify-end gap-2">
            <Show when={props.onChatToggle}>
              <Button variant="ghost" class="h-10 rounded-2xl px-3.5 text-12-medium border border-transparent hover:border-border-weaker-base" onClick={props.onChatToggle}>
                {props.chatHidden ? "Show chat" : "Hide chat"}
              </Button>
            </Show>
            <Show when={props.onClose}>
              <Button variant="ghost" class="h-10 rounded-2xl px-3.5 text-12-medium border border-transparent hover:border-border-weaker-base" onClick={props.onClose}>
                {language.t("common.close")}
              </Button>
            </Show>
          </div>
        </div>
      </div>

      <Show
        when={state.surface === "studio"}
        fallback={<TemplatePanel chatHidden={props.chatHidden} onChatToggle={props.onChatToggle} />}
      >
        <div ref={body} class="min-h-0 flex-1 flex overflow-hidden p-3 gap-3">
          <aside
            class={`${pane} ${anim()} bg-background-stronger`}
            classList={{
              "pointer-events-none opacity-0": left() === 0,
            }}
            style={{ width: `${left()}px` }}
          >
            <div class="size-full overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)] flex flex-col">
              <div class="h-12 px-3 border-b border-border-weaker-base flex items-center justify-between gap-2">
                <div>
                  <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Explorer</div>
                  <div class="text-12-medium text-text-base">Files</div>
                </div>
                <Button
                  variant="ghost"
                  class="h-8 px-2 text-12-medium"
                  onClick={() => void load(root(), true)}
                  aria-label="Refresh files"
                >
                  <Icon name="reset" size="small" />
                </Button>
              </div>
              <div class="h-[calc(100%-48px)] overflow-auto p-2.5">
                <Tree
                  path={root()}
                  level={0}
                  active={() => state.active}
                  load={load}
                  open={open}
                  wait={wait}
                  tree={tree}
                  toggle={(path) => setState("open", path, (value) => !value)}
                  file={read}
                />
              </div>
            </div>
          </aside>

          <Show when={state.files && state.mode !== "preview"}>
            <div class="relative shrink-0" onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={state.left}
                min={leftFloor()}
                max={leftMax()}
                onResize={(next) => {
                  size.touch()
                  setState("left", next)
                }}
              />
            </div>
          </Show>

          <section
            class={`${pane} ${anim()} flex flex-col`}
            classList={{
              "pointer-events-none opacity-0": edit() === 0,
            }}
            style={{ width: `${edit()}px` }}
          >
            <div class="size-full overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)] flex flex-col">
              <div class="h-12 border-b border-border-weaker-base flex items-center justify-between gap-3 px-3">
                <div class="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto">
                  <For each={state.tabs}>
                    {(item) => (
                      <div
                        classList={{
                          "h-8 pl-2 pr-1 rounded-lg flex items-center gap-2 shrink-0 border": true,
                          "bg-surface-base-active border-border-weak-base shadow-xs-border": state.active === item.path,
                          "bg-transparent border-transparent hover:bg-surface-base-hover": state.active !== item.path,
                        }}
                      >
                        <button
                          type="button"
                          class="min-w-0 flex-1 flex items-center gap-2"
                          onClick={() => setState("active", item.path)}
                        >
                          <FileIcon node={{ path: item.path, type: "file" }} class="size-4" />
                          <span class="max-w-48 truncate text-12-medium text-text-base">{item.name}</span>
                          <Show when={item.dirty}>
                            <div class="size-1.5 rounded-full bg-icon-info-base" />
                          </Show>
                        </button>
                        <button
                          type="button"
                          class="size-5 rounded-sm flex items-center justify-center hover:bg-surface-raised-base-hover"
                          onClick={(event) => {
                            event.stopPropagation()
                            close(item.path)
                          }}
                          aria-label={`Close ${item.name}`}
                        >
                          <Icon name="close-small" size="small" class="text-icon-base" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                  <Show when={tab()?.dirty}>
                    <Button variant="ghost" class="h-8 px-3 text-12-medium" onClick={() => void save()}>
                      {language.t("common.save")}
                    </Button>
                  </Show>
                </div>
              </div>

              <div class="min-h-0 flex-1 bg-background-base">
                <Show
                  when={tab()}
                  fallback={
                    <div class="size-full flex flex-col items-center justify-center gap-3 text-text-weak">
                      <div class="size-14 rounded-[18px] border border-border-weaker-base bg-surface-base flex items-center justify-center shadow-xs-border">
                        <Icon name="code" class="size-8" />
                      </div>
                      <div class="text-14-medium">Open a file from the tree to start editing.</div>
                    </div>
                  }
                >
                  {(item) => (
                    <WorkbenchEditor
                      path={item().path}
                      value={item().value}
                      onChange={(value) => change(item().path, value)}
                      onProblem={fix}
                      onSave={() => void save()}
                    />
                  )}
                </Show>
              </div>
            </div>
          </section>

          <Show when={state.mode === "split"}>
            <div class="relative shrink-0" onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={state.right}
                min={rightFloor()}
                max={rightMax()}
                onResize={(next) => {
                  size.touch()
                  setState("right", next)
                }}
              />
            </div>
          </Show>

          <aside
            class={`${pane} ${anim()} bg-background-stronger flex flex-col`}
            classList={{
              "pointer-events-none opacity-0": right() === 0,
            }}
            style={{ width: `${right()}px` }}
          >
            <div class={state.mode === "preview" ? "size-full pl-3 pb-3 pr-3" : "size-full"}>
              <div class="size-full overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)] flex flex-col">
                <div class="p-3 border-b border-border-weaker-base flex flex-col gap-3">
                  <div
                    classList={{
                      "flex min-w-0 gap-3": true,
                      "items-start justify-between": !compact(),
                      "flex-col": compact(),
                    }}
                  >
                    <div class="min-w-0 flex-1">
                      <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Preview</div>
                      <div class="text-13-medium text-text-base">Live browser canvas</div>
                    </div>
                    <div class="min-w-0 shrink-0 flex items-center gap-2 self-start max-w-full overflow-x-auto">
                      <Show when={previewUrl()}>
                        <Button
                          variant="ghost"
                          class="h-8 px-3 gap-2 text-11-medium"
                          onClick={reload}
                          aria-label="Reload preview"
                          title="Reload preview"
                        >
                          <Icon name="reset" class="size-4" />
                          <Show when={!compact()}>
                            <span>Reload</span>
                          </Show>
                        </Button>
                        <Button
                          variant="ghost"
                          class="h-8 px-2"
                          onClick={openPreview}
                          aria-label="Open preview in browser"
                          title="Open preview in browser"
                        >
                          <Icon name="open-file" class="size-4" />
                        </Button>
                      </Show>
                      <Button
                        variant="ghost"
                        class={state.pick ? "h-8 px-2 bg-surface-base-active text-text-strong" : "h-8 px-2"}
                        disabled={!previewUrl() || state.waitPick}
                        onClick={pick}
                        aria-label={state.pick ? "Stop selecting elements" : "Select an element from preview"}
                        title={state.pick ? "Stop selecting elements" : "Select an element from preview"}
                      >
                        <Icon name="window-cursor" class="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div
                    classList={{
                      "min-w-0 gap-2": true,
                      "flex flex-wrap items-center": !compact(),
                      "flex flex-col items-stretch": compact(),
                    }}
                  >
                    <div class="min-w-0 h-9 flex-1 rounded-xl border border-border-weaker-base bg-background-stronger px-3 flex items-center gap-2">
                      <div class={`size-2 rounded-full ${previewUrl() ? "bg-icon-success-base" : "bg-icon-disabled"}`} />
                      <div class="min-w-0 flex-1 truncate text-11-medium text-text-weak">
                        {previewLabel() ||
                          (state.staticScan ? "Scanning workspace preview targets..." : "Waiting for a preview target")}
                      </div>
                    </div>
                    <div class="min-w-0 shrink-0 max-w-full rounded-xl border border-border-weaker-base bg-background-stronger p-1 flex items-center gap-1 overflow-x-auto">
                      <Button
                        variant="ghost"
                        class="h-8 px-2 text-11-medium shrink-0"
                        onClick={zoomOut}
                        disabled={state.zoom <= 50}
                        aria-label="Zoom out preview"
                        title="Zoom out preview"
                      >
                        -
                      </Button>
                      <Button
                        variant="ghost"
                        class="h-8 px-2 text-11-medium shrink-0"
                        onClick={zoomReset}
                        aria-label="Reset preview zoom"
                        title="Reset preview zoom"
                      >
                        {zoom()}
                      </Button>
                      <Button
                        variant="ghost"
                        class="h-8 px-2 text-11-medium shrink-0"
                        onClick={zoomIn}
                        disabled={state.zoom >= 200}
                        aria-label="Zoom in preview"
                        title="Zoom in preview"
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
                    {state.waitPick
                        ? "Loading the picker snapshot..."
                        : state.pick
                          ? "Click any element in the preview to add it to the chat box."
                          : previewSource() === "live"
                            ? "Following the latest localhost app from chat or terminal."
                            : previewSource() === "static"
                              ? `Previewing ${state.staticLabel} directly from this workspace.`
                              : state.staticScan
                                ? "Looking for a dev server script or a plain index.html file in this workspace."
                                : "Run the app in the main terminal, or open a workspace with a plain index.html file."}
                  </div>
                </div>

                <div class="min-h-0 flex-1 bg-background-stronger p-3">
                  <div ref={stage} class="size-full min-w-0 overflow-auto rounded-[22px] bg-[#181922]">
                    <Show
                      when={previewUrl()}
                      fallback={
                        <div class="size-full flex items-center justify-center px-6 text-center text-13-medium text-text-weak">
                          {state.staticScan
                            ? "Scanning this workspace for previewable HTML."
                            : "Preview will appear automatically when a localhost app is running or a plain index.html file is found."}
                        </div>
                      }
                    >
                      {(url) => (
                        <div class="box-border min-h-full min-w-full overflow-hidden flex items-start justify-center p-4">
                          <div
                            class="relative shrink-0"
                            style={{ width: `${scaledW()}px`, height: `${scaledH()}px` }}
                          >
                            <div
                              class="absolute left-0 top-0 box-border overflow-hidden rounded-[22px] border border-border-weaker-base bg-[#14151d] shadow-[var(--shadow-lg-border-base)] flex flex-col"
                              style={{
                                width: `${frameW()}px`,
                                height: `${frameH()}px`,
                                transform: `scale(${scale()})`,
                                "transform-origin": "top left",
                              }}
                            >
                              <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
                                <div class="size-2 rounded-full bg-[#f87171]" />
                                <div class="size-2 rounded-full bg-[#fbbf24]" />
                                <div class="size-2 rounded-full bg-[#34d399]" />
                                <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                                  {previewLabel() || url()}
                                </div>
                              </div>
                              <iframe
                                ref={frame}
                                src={state.pick && state.doc ? undefined : url()}
                                srcdoc={state.pick && state.doc ? state.doc : undefined}
                                class="block min-h-0 flex-1 w-full border-0 bg-white"
                                title="Preview"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </Show>
    </div>
  )
}
