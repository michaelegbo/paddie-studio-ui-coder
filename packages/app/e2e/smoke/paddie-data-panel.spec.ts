import { expect, test, type Page, type Route } from "@playwright/test"
import { trackPageErrors } from "../utils/errors"

test.describe("smoke: Paddie Data panel", () => {
  test.setTimeout(180_000)

  test("loads Playground, Memory, Knowledge Base, and API data through mocked RMN endpoints", async ({ page }) => {
    const errors = trackPageErrors(page)
    const calls: Array<{ method: string; path: string }> = []
    const playgroundBodies: unknown[] = []

    await mockPaddieApi(page, calls, playgroundBodies)
    await configureAuthenticatedStudio(page)

    await page.goto("/e2e/harness/paddie-data.html", { waitUntil: "domcontentloaded", timeout: 120_000 })

    await expect(page.getByText("Paddie Data")).toBeVisible()
    await expect(page.getByText("Chat Playground")).toBeVisible()
    await page.getByLabel("Memory type hint").selectOption("preference")
    await page.locator("label").filter({ hasText: "Onboarding" }).locator('input[type="checkbox"]').check()
    await page.getByPlaceholder("Paste full API key for playground").fill("paddie_live_test")
    await page.getByPlaceholder("Ask Paddie Memory and AI RAG...").fill("How should onboarding work?")
    await page.getByRole("button", { name: "Attach playground" }).click()
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled()
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Hello from playground.")).toBeVisible()
    await expect(page.getByText("Retrieved useful memory.")).toBeVisible()

    await page.getByRole("button", { name: "Memory", exact: true }).click()
    await expect(page.getByText("User prefers compact dashboards.")).toBeVisible()
    await expect(page.getByText("Explorer only")).toBeVisible()
    await expect(page.getByRole("button", { name: "Attach service" }).first()).toBeVisible()

    await page.getByRole("button", { name: "Knowledge Base" }).click()
    await expect(page.getByRole("button", { name: /Onboarding/ })).toBeVisible()
    await page.getByPlaceholder("Ask this knowledge base a question").fill("How should onboarding work?")
    await page.getByRole("button", { name: "Query" }).click()
    await expect(page.getByText("Use a short checklist.")).toBeVisible()

    await page.getByRole("button", { name: "API", exact: true }).click()
    await expect(page.getByText("Studio key")).toBeVisible()
    await expect(page.getByText("Memory Router")).toBeVisible()
    await expect(page.getByText("Knowledge Base API")).toBeVisible()

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(
      expect.arrayContaining([
        "GET /api/auth/me",
        "GET /api/users/me/subscription",
        "GET /api/memories/users",
        "GET /api/knowledge-bases",
        "GET /api/users/me/api-keys",
        "GET /api/playground/models",
        "GET /api/playground/conversations",
        "POST /api/playground/chat",
        "POST /api/playground/conversations",
        "POST /api/knowledge-bases/kb_1/query",
      ]),
    )
    expect(playgroundBodies[0]).toMatchObject({
      memoryType: "preference",
      knowledgeBaseIds: ["kb_1"],
    })
    expect(errors).toEqual([])
  })
})

async function configureAuthenticatedStudio(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("paddie_studio_token", "e2e-token")
    localStorage.setItem("paddie_studio_provider_onboarding_seen_v1", "1")
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          paddieStudioFeatures: true,
          betaFeatures: true,
          inspiration: true,
          autopilot: true,
          showFileTree: true,
          showNavigation: true,
          showSearch: true,
          showStatus: true,
          showTerminal: true,
          showReasoningSummaries: true,
          showSessionProgressBar: true,
        },
      }),
    )
  })
}

async function mockPaddieApi(page: Page, calls: Array<{ method: string; path: string }>, playgroundBodies: unknown[]) {
  await page.route("https://api.paddie.io/api/**", async (route) => {
    const url = new URL(route.request().url())
    calls.push({ method: route.request().method(), path: url.pathname })

    if (url.pathname === "/api/auth/me") {
      return json(route, { success: true, data: { id: "user_1", email: "user@example.com", tenant_id: "tenant_1" } })
    }
    if (url.pathname === "/api/users/me/subscription") {
      return json(route, { success: true, data: { plan: { slug: "pro" }, subscription: { status: "active" } } })
    }
    if (url.pathname === "/api/studio/ui-templates") {
      return json(route, { success: true, data: [] })
    }
    if (url.pathname === "/api/memories/users") {
      return json(route, { success: true, data: [{ user_id: "user_1", count: 2 }] })
    }
    if (url.pathname === "/api/memories") {
      return json(route, {
        success: true,
        data: {
          items: [{ id: "mem_1", memory: "User prefers compact dashboards.", type: "preference", user_id: "user_1" }],
          total: 1,
          page: 1,
          limit: 25,
          has_more: false,
        },
      })
    }
    if (url.pathname === "/api/knowledge-bases") {
      return json(route, {
        success: true,
        data: [{ _key: "kb_1", name: "Onboarding", document_count: 1, chunk_count: 2, status: "active" }],
      })
    }
    if (url.pathname === "/api/knowledge-bases/kb_1/documents") {
      return json(route, { success: true, data: [{ _key: "doc_1", name: "Guide.md", chunk_count: 1, status: "indexed" }] })
    }
    if (url.pathname === "/api/knowledge-bases/kb_1/api") {
      return json(route, {
        success: true,
        data: {
          knowledge_base_id: "kb_1",
          name: "Onboarding",
          endpoint: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
          method: "POST",
          auth: "Use x-api-key",
          request_body: { query: "Question" },
          curl: "curl -X POST https://api.paddie.io/api/knowledge-bases/kb_1/query",
        },
      })
    }
    if (url.pathname === "/api/knowledge-bases/kb_1/query") {
      return json(route, {
        success: true,
        data: {
          answer: "Use a short checklist.",
          results: [{ document_id: "doc_1", document_name: "Guide.md", text: "Keep API keys server-side.", score: 0.91 }],
        },
      })
    }
    if (url.pathname === "/api/users/me/api-keys") {
      return json(route, { success: true, data: [{ id: "key_1", name: "Studio key", key_prefix: "paddie_live_123", usage_count: 3 }] })
    }
    if (url.pathname === "/api/playground/models") {
      return json(route, { success: true, data: [{ id: "openai/gpt-4.1-mini", name: "GPT 4.1 mini", description: "Fast playground model" }] })
    }
    if (url.pathname === "/api/playground/conversations") {
      if (route.request().method() === "POST") {
        return json(route, { success: true, data: { id: "conversation_1" } })
      }
      return json(route, { success: true, data: [] })
    }
    if (url.pathname === "/api/playground/chat") {
      playgroundBodies.push(route.request().postDataJSON())
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        body: [
          'data: {"type":"router_action","action":"conversation","explanation":"Retrieved useful memory.","context_count":1,"storage_queued":true}\n\n',
          'data: {"type":"memories","count":1,"memories":[{"id":"mem_1","memory":"User prefers compact dashboards.","type":"preference"}]}\n\n',
          'data: {"type":"knowledge_bases","count":1,"knowledge_bases":[{"name":"Onboarding"}]}\n\n',
          'data: {"type":"content","content":"Hello from playground."}\n\n',
          'data: {"type":"done"}\n\n',
        ].join(""),
      })
    }
    if (url.pathname === "/api/studio/events") {
      return json(route, { success: true })
    }

    return json(route, { success: true, data: null })
  })
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
