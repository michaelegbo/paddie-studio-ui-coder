import { describe, expect, test } from "bun:test"
import {
  createTemplateVisualContract,
  formatTemplateVisualContract,
  previewDoc,
  previewHtml,
  previewUrl,
  templateCanAccess,
  templateGalleryPreviewReady,
  templateIsReactProject,
  type UITemplate,
} from "./helpers"

const tpl = (value: Partial<UITemplate>) =>
  ({
    id: "t",
    name: "Template",
    description: "desc",
    stack: "React",
    tier: "free",
    preview: "<div>Hello</div>",
    files: [],
    assets: [],
    parts: [{ id: "full", name: "Full", description: "desc", selectors: ["body"], files: [] }],
    is_active: true,
    display_order: 0,
    ...value,
  }) satisfies UITemplate

describe("template helpers", () => {
  test("prefers preview_url when present", () => {
    expect(previewUrl(tpl({ preview_url: "https://example.com/app" }))).toBe("https://example.com/app")
  })

  test("treats preview as url when it is a link", () => {
    expect(previewUrl(tpl({ preview: "https://example.com/app" }))).toBe("https://example.com/app")
    expect(previewHtml(tpl({ preview: "https://example.com/app" }))).toBe("")
  })

  test("builds picker doc with base and host script", () => {
    const html = previewDoc("https://example.com/app/", "<body><div>Hi</div></body>", [
      { id: "full", name: "Full", description: "desc", selectors: ["body"], files: [] },
      { id: "hero", name: "Hero", description: "desc", selectors: ["section.hero"], files: [] },
    ])

    expect(html).toContain('<base href="https://example.com/app/">')
    expect(html).toContain('source: "paddie-studio-template"')
    expect(html).toContain('data-paddie-template')
    expect(html).toContain('"hero"')
  })

  test("builds browse doc with root and index link guard only", () => {
    const html = previewDoc("", '<body><a href="/index.html#features">Features</a><section id="features"></section></body>', [
      { id: "full", name: "Full", description: "desc", selectors: ["body"], files: [] },
    ], "browse")

    expect(html).toContain("const picking = false")
    expect(html).toContain('closest("a[href]")')
    expect(html).toContain("indexSection")
    expect(html).toContain("const section = indexSection")
    expect(html).toContain("if (!section) return")
    expect(html).toContain('"index.html"')
    expect(html).toContain("scrollIntoView")
    expect(html).toContain("if (!picking)")
    expect(html).not.toContain('post("link"')
  })

  test("detects React project templates by tag", () => {
    expect(templateIsReactProject(tpl({ tags: ["paddie:react-package"] }))).toBe(true)
    expect(templateIsReactProject(tpl({ tags: ["react"] }))).toBe(false)
    expect(templateIsReactProject(tpl({}))).toBe(false)
  })

  test("uses RMN access metadata for template locks", () => {
    expect(templateCanAccess({ tier: "pro", can_access: true })).toBe(true)
    expect(templateCanAccess({ tier: "free", can_access: false })).toBe(false)
    expect(templateCanAccess({ tier: "free" })).toBe(false)
    expect(templateCanAccess({ tier: "pro" })).toBe(false)
  })

  test("templateGalleryPreviewReady rejects stubs", () => {
    expect(templateGalleryPreviewReady("<html>ok</html>")).toBe(true)
    expect(templateGalleryPreviewReady("x Preview unavailable y")).toBe(false)
    expect(templateGalleryPreviewReady("SSR build did not run")).toBe(false)
    expect(templateGalleryPreviewReady("")).toBe(false)
  })

  test("creates template visual contracts for full templates and selected elements", () => {
    const template = tpl({
      name: "Landing",
      preview:
        '<main><section class="hero"><h1>Launch faster</h1><button>Start</button></section></main><style>.hero{display:grid;gap:24px;color:#ff5a1f;transition:opacity 200ms}</style>',
      parts: [{ id: "hero", name: "Hero", description: "Hero section", selectors: ["section.hero"], files: ["src/App.tsx"] }],
      files: [{ path: "src/App.tsx", content: ".hero{font-family:Inter;font-size:48px;max-width:960px;animation:fade 300ms}" }],
    })
    const contract = createTemplateVisualContract(template, template.parts[0], {
      selector: "main > section.hero",
      label: "section.hero",
      text: "Launch faster",
      html: '<section class="hero"><h1>Launch faster</h1></section>',
    })

    expect(contract.templateName).toBe("Landing")
    expect(contract.partName).toBe("Hero")
    expect(contract.reference.kind).toBe("html")
    expect(contract.viewports.map((viewport) => viewport.name)).toEqual(["desktop", "tablet", "mobile"])
    expect(contract.styleSignals.text).toContain("Launch faster")
    expect(contract.styleSignals.landmarks).toContain("main > section.hero")
    expect(contract.styleSignals.colors).toContain("#ff5a1f")
    expect(formatTemplateVisualContract(contract)).toContain("Template visual verification contract")
  })
})
