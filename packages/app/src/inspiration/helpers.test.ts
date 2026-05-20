import { describe, expect, test } from "bun:test"
import {
  createInspirationSnapshot,
  normalizeInspirationPayload,
  normalizeInspirationUrl,
} from "./helpers"

describe("inspiration helpers", () => {
  test("normalizes public http and https URLs", () => {
    expect(normalizeInspirationUrl("example.com/gallery")).toBe("https://example.com/gallery")
    expect(normalizeInspirationUrl("http://example.com")).toBe("http://example.com/")
    expect(() => normalizeInspirationUrl("javascript:alert(1)")).toThrow("http and https")
    expect(() => normalizeInspirationUrl("")).toThrow("public website URL")
  })

  test("builds sanitized snapshots with base, inline CSS, and controller injection", async () => {
    const snapshot = await createInspirationSnapshot({
      url: "https://example.com/pages/home.html",
      html: `
        <html>
          <head>
            <title>Example Home</title>
            <link rel="stylesheet" href="../assets/site.css">
            <script>alert("remove me")</script>
          </head>
          <body onclick="removeMe()">
            <a href="#hero">Hero</a>
            <a href="javascript:alert(1)">Bad</a>
            <section id="hero" style="animation: fade 200ms ease">Hello</section>
          </body>
        </html>
      `,
      fetcher: (async (input) => {
        expect(String(input)).toBe("https://example.com/assets/site.css")
        return new Response(`.hero{background:url("./bg.png")} @keyframes fade{from{opacity:0}to{opacity:1}}`)
      }) as typeof fetch,
    })

    expect(snapshot.pageTitle).toBe("Example Home")
    expect(snapshot.html).toContain('<base href="https://example.com/pages/home.html">')
    expect(snapshot.html).toContain('data-paddie-inlined-stylesheet="https://example.com/assets/site.css"')
    expect(snapshot.html).toContain('url("https://example.com/assets/bg.png")')
    expect(snapshot.html).toContain("paddie-studio-inspiration")
    expect(snapshot.html).toContain("navigate")
    expect(snapshot.html).not.toContain("remove me")
    expect(snapshot.html).not.toContain("onclick=")
    expect(snapshot.html).not.toContain("javascript:alert")
  })

  test("normalizes picker payloads for page and element references", () => {
    const element = normalizeInspirationPayload(
      {
        url: "example.com",
        pageTitle: "Example",
        mode: "element",
        selector: "main > section.hero",
        label: "section.hero",
        text: "A big headline",
        html: "<section>Hero</section>",
        styleSignals: {
          colors: ["rgb(10, 20, 30)"],
          typography: ["font-size: 48px"],
          layout: ["display: grid"],
          borders: [],
          shadows: ["box-shadow: 0 10px 20px #0003"],
          transitions: ["transition-duration: 200ms"],
          animations: ["animation-name: fade"],
          keyframes: ["@keyframes fade { from { opacity: 0; } to { opacity: 1; } }"],
        },
      },
      "https://fallback.test",
    )

    expect(element).toMatchObject({
      url: "https://example.com/",
      pageTitle: "Example",
      mode: "element",
      selector: "main > section.hero",
      label: "section.hero",
      text: "A big headline",
      html: "<section>Hero</section>",
    })
    expect(element.styleSignals.animations).toEqual(["animation-name: fade"])

    const page = normalizeInspirationPayload({ mode: "page", pageTitle: "Fallback page" }, "https://fallback.test")
    expect(page.selector).toBeUndefined()
    expect(page.label).toBe("Fallback page")
    expect(page.url).toBe("https://fallback.test/")
  })
})
