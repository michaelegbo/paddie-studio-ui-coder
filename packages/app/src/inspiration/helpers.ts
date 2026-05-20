export type InspirationMode = "page" | "element"

export type InspirationStyleSignals = {
  colors: string[]
  typography: string[]
  layout: string[]
  borders: string[]
  shadows: string[]
  transitions: string[]
  animations: string[]
  keyframes: string[]
}

export type InspirationContextPayload = {
  url: string
  pageTitle: string
  mode: InspirationMode
  selector?: string
  label: string
  text?: string
  html: string
  styleSignals: InspirationStyleSignals
}

export type InspirationSnapshot = {
  url: string
  pageTitle: string
  html: string
}

const MAX_TEXT = 1_500
const MAX_HTML = 12_000
const MAX_SIGNAL = 1_200
const DEFAULT_STYLESHEET_LIMIT = 8
const DEFAULT_STYLESHEET_BYTES = 80_000
const SOURCE = "paddie-studio-inspiration"
const HOST_SOURCE = "paddie-studio-inspiration-host"

const emptyStyleSignals = (): InspirationStyleSignals => ({
  colors: [],
  typography: [],
  layout: [],
  borders: [],
  shadows: [],
  transitions: [],
  animations: [],
  keyframes: [],
})

export const INSPIRATION_MESSAGE_SOURCE = SOURCE
export const INSPIRATION_HOST_MESSAGE_SOURCE = HOST_SOURCE

export function normalizeInspirationUrl(value: string) {
  const raw = value.trim()
  if (!raw) throw new Error("Enter a public website URL.")
  if (/^(?:javascript|data|file|ftp|mailto|tel|blob):/i.test(raw)) {
    throw new Error("Only public http and https URLs are supported.")
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error("Enter a valid public website URL.")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only public http and https URLs are supported.")
  }
  return parsed.href
}

const trim = (value: string | undefined, limit: number) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

const textFromUnknown = (value: unknown, limit: number) => (typeof value === "string" ? trim(value, limit) : "")

const arrayFromUnknown = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = textFromUnknown(item, MAX_SIGNAL)
    return text ? [text] : []
  })
}

const recordFromUnknown = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const styleSignalsFromUnknown = (value: unknown): InspirationStyleSignals => {
  const record = recordFromUnknown(value)
  return {
    colors: arrayFromUnknown(record.colors),
    typography: arrayFromUnknown(record.typography),
    layout: arrayFromUnknown(record.layout),
    borders: arrayFromUnknown(record.borders),
    shadows: arrayFromUnknown(record.shadows),
    transitions: arrayFromUnknown(record.transitions),
    animations: arrayFromUnknown(record.animations),
    keyframes: arrayFromUnknown(record.keyframes),
  }
}

export function normalizeInspirationPayload(value: unknown, fallbackUrl: string): InspirationContextPayload {
  const record = recordFromUnknown(value)
  const url = normalizeInspirationUrl(textFromUnknown(record.url, 2_000) || fallbackUrl)
  const mode: InspirationMode = record.mode === "element" ? "element" : "page"
  const pageTitle = textFromUnknown(record.pageTitle, 180) || new URL(url).hostname
  const selector = mode === "element" ? textFromUnknown(record.selector, 1_000) : undefined
  const label =
    textFromUnknown(record.label, 180) ||
    (mode === "element" ? selector || "Selected element" : pageTitle || "Full page")
  const text = textFromUnknown(record.text, MAX_TEXT)
  return {
    url,
    pageTitle,
    mode,
    selector,
    label,
    text: text || undefined,
    html: textFromUnknown(record.html, MAX_HTML),
    styleSignals: styleSignalsFromUnknown(record.styleSignals),
  }
}

const ensureHead = (doc: Document) => {
  if (doc.head) return doc.head
  const head = doc.createElement("head")
  doc.documentElement.insertBefore(head, doc.body ?? doc.documentElement.firstChild)
  return head
}

const stripUnsafeDocumentParts = (doc: Document) => {
  doc.querySelectorAll("script").forEach((node) => node.remove())
  doc.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith("on")) {
        node.removeAttribute(attribute.name)
        return
      }
      if ((name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction") && /^javascript:/i.test(value)) {
        node.removeAttribute(attribute.name)
      }
    })
  })
}

const rewriteCssUrls = (css: string, stylesheetUrl: string) =>
  css.replace(/url\(([^)]+)\)/gi, (full, raw: string) => {
    const value = raw.trim().replace(/^["']|["']$/g, "")
    if (!value || /^(?:data:|blob:|#|javascript:|https?:\/\/)/i.test(value)) return full
    try {
      return `url("${new URL(value, stylesheetUrl).href}")`
    } catch {
      return full
    }
  })

async function inlineStylesheets(input: {
  doc: Document
  url: string
  fetcher: typeof fetch
  limit: number
  maxBytes: number
}) {
  const links = Array.from(input.doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).slice(
    0,
    input.limit,
  )
  await Promise.all(
    links.map(async (link) => {
      const href = link.getAttribute("href")
      if (!href) return
      const stylesheetUrl = new URL(href, input.url).href
      const response = await input.fetcher(stylesheetUrl).catch(() => undefined)
      if (!response?.ok) return
      const css = await response.text().catch(() => "")
      if (!css || css.length > input.maxBytes) return
      const style = input.doc.createElement("style")
      style.setAttribute("data-paddie-inlined-stylesheet", stylesheetUrl)
      style.textContent = rewriteCssUrls(css, stylesheetUrl)
      link.replaceWith(style)
    }),
  )
}

const controllerScript = (url: string) => `
(() => {
  const source = ${JSON.stringify(SOURCE)}
  const hostSource = ${JSON.stringify(HOST_SOURCE)}
  const pageUrl = ${JSON.stringify(url)}
  let picking = false
  let last
  const post = (type, payload = {}) => parent.postMessage({ source, type, payload }, "*")
  const stop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  const esc = window.CSS && CSS.escape ? CSS.escape.bind(CSS) : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
  const unique = (items) => Array.from(new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)))
  const usefulColor = (value) => value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent"
  const ok = (el) => el instanceof Element && !["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META", "BASE"].includes(el.tagName)
  const text = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 1500)
  const cleanHtml = (el, limit) => {
    const clone = el.cloneNode(true)
    if (clone instanceof Element) {
      clone.querySelectorAll("script").forEach((node) => node.remove())
      clone.classList.remove("__paddie_inspiration_target")
    }
    return (clone.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, limit)
  }
  const nth = (el) => {
    const parent = el.parentElement
    if (!parent) return ""
    const kids = Array.from(parent.children).filter((item) => item.tagName === el.tagName)
    if (kids.length <= 1) return ""
    return ":nth-of-type(" + (kids.indexOf(el) + 1) + ")"
  }
  const cls = (el) => Array.from(el.classList).slice(0, 2).map((item) => "." + esc(item)).join("")
  const selector = (el) => {
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
  const label = (el) => {
    let out = el.tagName.toLowerCase()
    if (el.id) out += "#" + el.id
    const list = Array.from(el.classList).filter((item) => item !== "__paddie_inspiration_target").slice(0, 2)
    if (list.length) out += "." + list.join(".")
    return out
  }
  const styleList = (elements, names) => unique(elements.flatMap((el) => {
    const style = getComputedStyle(el)
    return names.map((name) => {
      const value = style.getPropertyValue(name)
      return value && value !== "none" && value !== "normal" && value !== "0px" ? name + ": " + value : ""
    })
  })).slice(0, 18)
  const keyframes = (names) => {
    const wanted = unique(names.flatMap((value) => value.split(",").map((item) => item.trim()).filter((item) => item && item !== "none")))
    if (!wanted.length) return []
    const out = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = []
      try {
        rules = Array.from(sheet.cssRules || [])
      } catch {
        rules = []
      }
      for (const rule of rules) {
        if ("name" in rule && wanted.includes(rule.name)) out.push(rule.cssText.slice(0, 1800))
      }
    }
    return unique(out).slice(0, 8)
  }
  const signals = (el, mode) => {
    const visible = mode === "page"
      ? Array.from(document.body?.querySelectorAll("*") || []).filter((item) => {
          const rect = item.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }).slice(0, 60)
      : []
    const elements = mode === "page" ? [document.body, ...visible].filter(Boolean) : [el]
    const animationNames = elements.map((item) => getComputedStyle(item).animationName)
    return {
      colors: unique(elements.flatMap((item) => {
        const style = getComputedStyle(item)
        return [style.color, style.backgroundColor, style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].filter(usefulColor)
      })).slice(0, 18),
      typography: styleList(elements, ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform"]),
      layout: styleList(elements, ["display", "position", "grid-template-columns", "grid-template-rows", "flex-direction", "justify-content", "align-items", "gap", "width", "max-width", "min-height", "padding", "margin"]),
      borders: styleList(elements, ["border-radius", "border-top-width", "border-top-style", "border-top-color", "border-bottom-width", "outline-width", "outline-color"]),
      shadows: styleList(elements, ["box-shadow", "text-shadow"]),
      transitions: styleList(elements, ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"]),
      animations: styleList(elements, ["animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction"]),
      keyframes: keyframes(animationNames),
    }
  }
  const payload = (mode, el) => ({
    url: pageUrl,
    pageTitle: document.title || new URL(pageUrl).hostname,
    mode,
    selector: mode === "element" ? selector(el) : undefined,
    label: mode === "element" ? label(el) : "Full page",
    text: text(el) || undefined,
    html: cleanHtml(mode === "page" ? document.body || document.documentElement : el, mode === "page" ? 12000 : 6000),
    styleSignals: signals(el, mode),
  })
  const mark = (el) => {
    if (last === el) return
    if (last) last.classList.remove("__paddie_inspiration_target")
    last = el
    if (el) el.classList.add("__paddie_inspiration_target")
  }
  const setPicking = (value) => {
    picking = value
    document.documentElement.classList.toggle("__paddie_inspiration_pick", value)
    if (!value) mark(undefined)
  }
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== hostSource) return
    if (event.data.type === "set-picking") setPicking(Boolean(event.data.picking))
    if (event.data.type === "capture-page") post("capture", payload("page", document.body || document.documentElement))
  })
  document.addEventListener("mousemove", (event) => {
    if (!picking) return
    const hit = event.target instanceof Element ? event.target.closest("*") : undefined
    if (!hit || !ok(hit)) return
    mark(hit)
  }, true)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    setPicking(false)
    post("cancel")
  }, true)
  document.addEventListener("click", (event) => {
    const hit = event.target instanceof Element ? event.target.closest("*") : undefined
    if (picking) {
      if (!hit || !ok(hit)) return
      stop(event)
      post("pick", payload("element", hit))
      setPicking(false)
      return
    }
    const anchor = hit?.closest("a[href]")
    if (!anchor) return
    const href = anchor.getAttribute("href") || ""
    let next
    try {
      next = new URL(href, pageUrl)
    } catch {
      return
    }
    if (next.href === pageUrl || (next.origin + next.pathname + next.search === new URL(pageUrl).origin + new URL(pageUrl).pathname + new URL(pageUrl).search && next.hash)) {
      const target = next.hash ? document.getElementById(decodeURIComponent(next.hash.slice(1))) || document.querySelector("[name='" + esc(decodeURIComponent(next.hash.slice(1))) + "']") : document.body
      if (!target) return
      stop(event)
      target.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" })
      return
    }
    stop(event)
    post("navigate", { url: next.href })
  }, true)
})()
`

function injectSnapshotControls(doc: Document, url: string) {
  const head = ensureHead(doc)
  doc.querySelectorAll("base").forEach((node) => node.remove())
  const base = doc.createElement("base")
  base.href = url
  head.prepend(base)

  const style = doc.createElement("style")
  style.setAttribute("data-paddie-inspiration-control", "style")
  style.textContent = `
html.__paddie_inspiration_pick, html.__paddie_inspiration_pick * { cursor: crosshair !important; }
.__paddie_inspiration_target { outline: 2px solid #38bdf8 !important; outline-offset: 2px !important; }
`
  head.append(style)

  const script = doc.createElement("script")
  script.setAttribute("data-paddie-inspiration-control", "script")
  script.textContent = controllerScript(url)
  head.append(script)
}

export async function createInspirationSnapshot(input: {
  url: string
  html: string
  fetcher?: typeof fetch
  inlineStylesheetLimit?: number
  maxStylesheetBytes?: number
}): Promise<InspirationSnapshot> {
  const url = normalizeInspirationUrl(input.url)
  const doc = new DOMParser().parseFromString(input.html, "text/html")
  stripUnsafeDocumentParts(doc)
  await inlineStylesheets({
    doc,
    url,
    fetcher: input.fetcher ?? fetch,
    limit: input.inlineStylesheetLimit ?? DEFAULT_STYLESHEET_LIMIT,
    maxBytes: input.maxStylesheetBytes ?? DEFAULT_STYLESHEET_BYTES,
  })
  injectSnapshotControls(doc, url)
  return {
    url,
    pageTitle: trim(doc.title, 180) || new URL(url).hostname,
    html: `<!doctype html>\n${doc.documentElement.outerHTML}`,
  }
}
