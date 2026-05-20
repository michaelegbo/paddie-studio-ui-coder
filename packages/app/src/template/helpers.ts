/**
 * Template helpers
 *
 * Pure functions for working with UI template data fetched from the Paddie API.
 * These replace the now-deprecated library.ts exports.
 */

export type TemplateFile = {
  path: string
  content: string
  encoding?: "utf-8" | "base64"
}

export type TemplateAsset = {
  path: string
  url: string
  size: number
  mime?: string
}

export type TemplatePart = {
  id: string
  name: string
  description: string
  selectors: string[]
  files: string[]
  hint?: string
}

/** Shown in the template gallery when `thumb_url` is missing. */
export const DEFAULT_TEMPLATE_THUMB_DATA_URL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#14151d"/>
          <stop offset="100%" style="stop-color:#1f2129"/>
        </linearGradient>
      </defs>
      <rect width="640" height="400" fill="url(#g)"/>
      <text x="320" y="188" text-anchor="middle" fill="#8b92a8" font-family="system-ui,sans-serif" font-size="20">Template preview</text>
      <text x="320" y="218" text-anchor="middle" fill="#5c6378" font-family="system-ui,sans-serif" font-size="14">Open to view full canvas</text>
    </svg>`,
  )

export type UITemplateMeta = {
  id: string
  name: string
  description: string
  stack: string
  tier: string
  thumb_url?: string | null
  tags?: string[]
  parts_count: number
  parts_summary: string[]
  is_active: boolean
  /** From API: false when preview snapshot is still placeholder or empty */
  preview_ready?: boolean
  display_order: number
}

export type UITemplate = {
  id: string
  name: string
  description: string
  stack: string
  tier: string
  thumb_url?: string | null
  preview_url?: string | null
  preview: string
  files: TemplateFile[]
  assets: TemplateAsset[]
  parts: TemplatePart[]
  tags?: string[]
  is_active: boolean
  display_order: number
}

export const part = (tpl: UITemplate, id?: string) => tpl.parts.find((item) => item.id === (id || "full"))

/** Templates imported as full Vite + React trees (API may tag with `paddie:react-package`). */
export const templateIsReactProject = (tpl: UITemplate) =>
  Boolean(tpl.tags?.includes("paddie:react-package"))

/** Matches RMN `uiTemplatePreviewIsUnavailableStub` — gallery HTML is a real snapshot, not the import stub. */
export function templateGalleryPreviewReady(preview: string | undefined): boolean {
  if (preview == null) return false
  const p = String(preview)
  if (p.trim() === "") return false
  if (p.includes("Preview unavailable")) return false
  if (p.includes("SSR build did not run")) return false
  return true
}

const url = (value: string) => /^https?:\/\//i.test(value)

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

export const previewUrl = (tpl: UITemplate) => {
  const next = tpl.preview_url?.trim()
  if (next) return next
  const value = tpl.preview.trim()
  if (!url(value)) return ""
  return value
}

export const previewHtml = (tpl: UITemplate) => {
  const link = previewUrl(tpl)
  if (link && tpl.preview.trim() === link) return ""
  return tpl.preview
}

export const previewDoc = (link: string, html: string, parts: TemplatePart[], mode: "browse" | "pick" = "pick") => {
  const head = [
    link ? `<base href="${esc(link)}">` : "",
    `<style>
html.__paddie_pick, html.__paddie_pick * { cursor: crosshair !important; }
.__paddie_pick_target { outline: 2px solid #60a5fa !important; outline-offset: 2px !important; }
</style>`,
    `<script>
(() => {
  const parts = ${JSON.stringify(parts.map((item) => ({ id: item.id, selectors: item.selectors })))}
  const picking = ${mode === "pick" ? "true" : "false"}
  const esc = window.CSS && CSS.escape ? CSS.escape.bind(CSS) : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
  const ok = (el) => el instanceof Element && !["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META"].includes(el.tagName)
  const stop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  const decode = (value) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const target = (value) => {
    if (!value || value === "#") return document.body
    const id = decode(value.startsWith("#") ? value.slice(1) : value)
    if (!id) return document.body
    return document.getElementById(id) || document.querySelector("[name='" + esc(id) + "']")
  }
  const indexSection = (raw) => {
    const value = String(raw || "").trim()
    if (!value) return "#"
    if (/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(value)) return ""
    if (value.startsWith("#")) return value
    const hashIndex = value.indexOf("#")
    const hash = hashIndex >= 0 ? value.slice(hashIndex) || "#" : ""
    const clean = value
      .split("#")[0]
      .split("?")[0]
      .replace(/\\\\/g, "/")
      .replace(/\\/+$/, "")
    if (!clean || clean === "." || clean === "..") return hash || "#"
    const last = clean.split("/").filter(Boolean).pop()
    return last === "index.html" || last === "index" ? hash || "#" : ""
  }
  const post = (type, payload = {}) => parent.postMessage({ source: "paddie-studio-template", type, payload }, "*")
  document.addEventListener("click", (event) => {
    if (picking) return
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : undefined
    if (!anchor) return
    const hit = target(indexSection(anchor.getAttribute("href")))
    if (!hit) return
    stop(event)
    hit.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" })
  }, true)
  if (!picking) {
    document.body?.setAttribute("data-paddie-template", "")
    return
  }
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
  const find = (target) => {
    if (!(target instanceof Element)) return
    const hit = target.closest("*")
    if (!ok(hit)) return
    return hit
  }
  const match = (el) => {
    let cur = el
    while (ok(cur)) {
      const hit = parts.find((item) =>
        item.id !== "full" &&
        item.selectors.some((selector) => {
          try {
            return cur.matches(selector)
          } catch {
            return false
          }
        }),
      )
      if (hit) return hit.id
      cur = cur.parentElement
    }
    return "full"
  }
  let last
  const mark = (el) => {
    if (last === el) return
    if (last) last.classList.remove("__paddie_pick_target")
    last = el
    if (el) el.classList.add("__paddie_pick_target")
  }
  document.documentElement.classList.add("__paddie_pick")
  document.body?.setAttribute("data-paddie-template", "")
  document.addEventListener("mousemove", (event) => {
    const hit = find(event.target)
    if (!hit) return
    mark(hit)
  }, true)
  document.addEventListener("click", (event) => {
    const hit = find(event.target)
    if (!hit) return
    stop(event)
    post("pick", {
      id: match(hit),
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
})()
</script>`,
  ].join("")

  if (/<body[\s>]/i.test(html)) {
    const next = html.replace(/<body([^>]*)>/i, '<body$1 data-paddie-template="">')
    if (/<head[\s>]/i.test(next)) return next.replace(/<head([^>]*)>/i, `<head$1>${head}`)
    if (/<html[\s>]/i.test(next)) return next.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`)
    return `<!doctype html><html><head>${head}</head>${next}</html>`
  }

  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${head}`)
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head><body data-paddie-template="">`)
  return `<!doctype html><html><head>${head}</head><body data-paddie-template="">${html}</body></html>`
}

export const filesFor = (tpl: UITemplate, item?: TemplatePart) => {
  const pick = new Set((item?.files.length ? item.files : tpl.files.map((file) => file.path)).map((path) => path))
  return tpl.files.filter((file) => pick.has(file.path))
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "paddie-site"

export const materialize = (tpl: UITemplate, name: string) => {
  const id = slugify(name)
  return tpl.files.map((file) => ({
    path: file.path,
    content:
      file.encoding === "base64"
        ? file.content
        : file.content.replaceAll("__PADDIE_TEMPLATE_NAME__", name).replaceAll("__PADDIE_TEMPLATE_SLUG__", id),
    encoding: file.encoding,
  }))
}
