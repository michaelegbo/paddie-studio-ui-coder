import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  BASE_DESIGN_PACK,
  createDesignPackContextItem,
  createDesignPackVariants,
  designPackContextKey,
} from "@/design-pack/helpers"
import { buildRequestParts } from "./build-request-parts"

describe("buildRequestParts", () => {
  test("builds typed request and optimistic parts without cast path", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
      text: "hello @src/foo.ts @planner",
      messageID: "msg_1",
      sessionID: "ses_1",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts[0]?.type).toBe("text")
    expect(result.requestParts.some((part) => part.type === "agent")).toBe(true)
    expect(
      result.requestParts.some((part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts")),
    ).toBe(true)
    expect(result.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect(
      result.requestParts.some(
        (part) =>
          part.type === "text" &&
          part.synthetic &&
          part.metadata?.opencodeComment &&
          (part.metadata.opencodeComment as { comment?: string }).comment === "check this",
      ),
    ).toBe(true)

    expect(result.optimisticParts).toHaveLength(result.requestParts.length)
    expect(result.optimisticParts.every((part) => part.sessionID === "ses_1" && part.messageID === "msg_1")).toBe(true)
  })

  test("keeps multiple uploaded attachments in order", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "check these", start: 0, end: 11 }],
      context: [],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
        {
          type: "image",
          id: "img_2",
          filename: "b.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,BBB",
        },
      ],
      text: "check these",
      messageID: "msg_multi",
      sessionID: "ses_multi",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file" && part.url.startsWith("data:"))

    expect(files).toHaveLength(2)
    expect(files.map((part) => (part.type === "file" ? part.filename : ""))).toEqual(["a.png", "b.pdf"])
  })

  test("does not add Autopilot context to normal prompts", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "normal chat", start: 0, end: 11 }],
      context: [],
      images: [],
      text: "normal chat",
      messageID: "msg_normal",
      sessionID: "ses_normal",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts).toHaveLength(1)
    expect(result.requestParts[0]).toMatchObject({ type: "text", text: "normal chat" })
    expect(result.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(false)
  })

  test("deduplicates context files when prompt already includes same path", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
      ],
      images: [],
      text: "@src/foo.ts",
      messageID: "msg_2",
      sessionID: "ses_2",
      sessionDirectory: "/repo",
    })

    const fooFiles = result.requestParts.filter(
      (part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts"),
    )
    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)

    expect(fooFiles).toHaveLength(2)
    expect(synthetic).toHaveLength(1)
  })

  test("adds template visual verification instructions when template context is attached", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "redesign this with the template", start: 0, end: 31 }],
      context: [
        {
          key: "template:tpl_1:hero:part",
          type: "template",
          templateID: "tpl_1",
          templateName: "Landing",
          description: "Marketing landing page",
          stack: "React",
          partID: "hero",
          partName: "Hero",
          files: [{ path: "src/App.tsx", content: "export function App() { return <main /> }" }],
          visualContract: {
            templateID: "tpl_1",
            templateName: "Landing",
            description: "Marketing landing page",
            stack: "React",
            partID: "hero",
            partName: "Hero",
            reference: { kind: "html", value: "<main><h1>Launch faster</h1></main>" },
            viewports: [{ name: "desktop", width: 1440, height: 900 }],
            styleSignals: {
              colors: ["#ff5a1f"],
              typography: ["font-size: 48px"],
              layout: ["display: grid"],
              motion: ["transition: opacity 200ms"],
              landmarks: ["main", "h1"],
              text: ["Launch faster"],
            },
            acceptanceNotes: ["Compare design intent, not exact pixels."],
          },
        },
      ],
      images: [],
      text: "redesign this with the template",
      messageID: "msg_template",
      sessionID: "ses_template",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Template visual verification contract")
      expect(synthetic.text).toContain("Playwright visual comparison")
      expect(synthetic.text).toContain("PADDIE_TEMPLATE_VISUAL_REPORT")
      expect(synthetic.text).toContain("Launch faster")
    }
  })

  test("adds Paddie workflow context with generated client code and graph", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "wire this workflow into the app", start: 0, end: 31 }],
      context: [
        {
          key: "workflow:studio_flow_1:javascript",
          type: "workflow",
          workflowID: "studio_flow_1",
          workflowName: "Order triage",
          description: "Classify incoming orders",
          status: "active",
          method: "POST",
          webhookUrl: "https://api.paddie.io/api/studio/webhooks/studio_wh_1",
          language: "javascript",
          code: "export async function runStudioFlow(payload = {}) { return fetch('/webhook') }",
          nodes: [
            { id: "n1", type: "webhook", name: "Webhook", config: { method: "POST" } },
            { id: "n2", type: "ai", name: "Classify", config: { prompt: "Classify order urgency" } },
          ],
          edges: [{ id: "e1", source: "n1", target: "n2", condition: "always" }],
          revision: 4,
          updatedAt: "2026-05-19T12:00:00.000Z",
        },
      ],
      images: [],
      text: "wire this workflow into the app",
      messageID: "msg_workflow",
      sessionID: "ses_workflow",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Paddie Studio workflow")
      expect(synthetic.text).toContain("Order triage")
      expect(synthetic.text).toContain("Generated javascript client code")
      expect(synthetic.text).toContain("Workflow graph JSON")
      expect(synthetic.text).toContain("Classify order urgency")
    }
  })

  test("adds selected design pack context as synthetic prompt context", () => {
    const variant = createDesignPackVariants(BASE_DESIGN_PACK, "Build a dashboard")[0]
    const item = createDesignPackContextItem(BASE_DESIGN_PACK, variant, "Build a dashboard")
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "Build a dashboard", start: 0, end: 17 }],
      context: [{ key: designPackContextKey(item), type: "design-pack", ...item }],
      images: [],
      text: "Build a dashboard",
      messageID: "msg_design",
      sessionID: "ses_design",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Paddie Design Pack")
      expect(synthetic.text).toContain("Pack: Base")
      expect(synthetic.text).toContain("Selected variant: Calm Product")
      expect(synthetic.text).toContain("Design context scoping")
    }
  })

  test("adds Paddie Memory context with the data integration skill instruction", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "wire memory into this app", start: 0, end: 25 }],
      context: [
        {
          key: "memory:dynamic-user:integration:Paddie Memory service",
          type: "memory",
          userID: "<DYNAMIC_USER_ID>",
          mode: "integration",
          label: "Paddie Memory service",
          query: "What should this app remember?",
          content: "Integrate Memory Router through a server route and pass a dynamic user_id for each app user.",
          endpoint: "POST /memory/router",
          apiBase: "https://api.paddie.io/api",
          apiKeyEnv: "PADDIE_API_KEY",
          userIDStrategy: "Create or resolve a stable app-specific Paddie Memory user_id for each end user.",
          llm: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
          metadata: { selectedExplorerUserID: "user_1" },
        },
      ],
      images: [],
      text: "wire memory into this app",
      messageID: "msg_memory",
      sessionID: "ses_memory",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Paddie Memory as a service integration")
      expect(synthetic.text).toContain("paddie-data-integrator")
      expect(synthetic.text).toContain("This is not a static dump of individual memory records")
      expect(synthetic.text).toContain("API key environment variable: PADDIE_API_KEY")
      expect(synthetic.text).toContain("LLM runtime required")
      expect(synthetic.text).toContain("OPENAI_API_KEY")
      expect(synthetic.text).toContain("Dynamic user ID strategy")
      expect(synthetic.text).toContain("What should this app remember?")
      expect(synthetic.text).toContain("Do not hardcode the Studio explorer user ID")
      expect(synthetic.text).not.toContain("Included memories:")
    }
  })

  test("adds Paddie Knowledge Base context as a runtime RAG integration", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "add document search", start: 0, end: 19 }],
      context: [
        {
          key: "knowledge-base:kb_1:integration:onboarding",
          type: "knowledge-base",
          knowledgeBaseID: "kb_1",
          knowledgeBaseName: "Onboarding",
          mode: "integration",
          label: "Knowledge Base integration",
          query: "How should onboarding work?",
          endpoint: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
          apiBase: "https://api.paddie.io/api",
          apiKeyEnv: "PADDIE_API_KEY",
          llm: { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", model: "claude-3-5-sonnet-latest" },
          integrationNote: "Query this KB through a trusted server route.",
          knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
        },
      ],
      images: [],
      text: "add document search",
      messageID: "msg_kb",
      sessionID: "ses_kb",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Knowledge Base / AI RAG")
      expect(synthetic.text).toContain("paddie-data-integrator")
      expect(synthetic.text).toContain("This is not a static query answer or source-chunk dump")
      expect(synthetic.text).toContain("Knowledge base: Onboarding (kb_1)")
      expect(synthetic.text).toContain("Endpoint: https://api.paddie.io/api/knowledge-bases/kb_1/query")
      expect(synthetic.text).toContain("API key environment variable: PADDIE_API_KEY")
      expect(synthetic.text).toContain("LLM runtime required")
      expect(synthetic.text).toContain("ANTHROPIC_API_KEY")
      expect(synthetic.text).toContain("Onboarding (kb_1) - 1 docs, 12 chunks")
      expect(synthetic.text).toContain("Keep API keys out of client bundles")
      expect(synthetic.text).toContain("preserve RMN plan gates")
      expect(synthetic.text).not.toContain("Source chunks:")
    }
  })

  test("adds Paddie Data Playground context as a dynamic integration contract", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "build this playground into my app", start: 0, end: 33 }],
      context: [
        {
          key: "data-playground:router:conversation:preference:kb_1",
          type: "data-playground",
          label: "Paddie Data Playground",
          apiBase: "https://api.paddie.io/api",
          apiKeyEnv: "PADDIE_API_KEY",
          mode: "router",
          routerMode: "conversation",
          memoryType: "preference",
          persona: "default",
          model: "openai/gpt-4.1-mini",
          selectedExplorerUserID: "user_1",
          userIDStrategy: "Create or resolve a stable app-specific Paddie Memory user_id for each end user.",
          sampleQuery: "How should onboarding work?",
          conversationID: "conversation_1",
          integrationNote: "Build Memory Router and Knowledge Base services, not static answers.",
          implementationCode: "// File: src/lib/paddie-data.ts\nexport async function runPaddiePlaygroundTurn() {}",
          memoryService: true,
          knowledgeBaseMode: "selected",
          llm: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
          knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
          metadata: { service: "paddie-data-playground" },
        },
      ],
      images: [],
      text: "build this playground into my app",
      messageID: "msg_playground",
      sessionID: "ses_playground",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Paddie Data Playground")
      expect(synthetic.text).toContain("paddie-data-integrator")
      expect(synthetic.text).toContain("dynamic Memory/RAG implementation contract")
      expect(synthetic.text).toContain("Memory mode: router")
      expect(synthetic.text).toContain("Memory service attached: yes")
      expect(synthetic.text).toContain("Knowledge base attachment mode: selected")
      expect(synthetic.text).toContain("LLM runtime required")
      expect(synthetic.text).toContain("Router mode default: conversation")
      expect(synthetic.text).toContain("Memory type filter/hint: preference")
      expect(synthetic.text).toContain("Onboarding (kb_1) - 1 docs, 12 chunks")
      expect(synthetic.text).toContain("Sample runtime query: How should onboarding work?")
      expect(synthetic.text).toContain("Do not embed the current playground transcript")
      expect(synthetic.text).toContain("Keep Paddie and LLM API keys server-side")
      expect(synthetic.text).toContain("Full portable playground implementation code")
      expect(synthetic.text).toContain("src/lib/paddie-data.ts")
      expect(synthetic.text).not.toContain("Source chunks:")
      expect(synthetic.text).not.toContain("Included memories:")
    }
  })

  test("adds public website inspiration context as a design reference note", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "make this page feel like the reference", start: 0, end: 39 }],
      context: [
        {
          key: "inspiration:https://example.com/:element:main",
          type: "inspiration",
          url: "https://example.com/",
          pageTitle: "Example",
          mode: "element",
          selector: "main > section.hero",
          label: "section.hero",
          text: "Design faster",
          html: "<section class=\"hero\">Design faster</section>",
          styleSignals: {
            colors: ["rgb(10, 20, 30)", "rgb(240, 248, 255)"],
            typography: ["font-size: 48px", "font-family: Inter"],
            layout: ["display: grid", "gap: 32px"],
            borders: ["border-radius: 24px"],
            shadows: ["box-shadow: 0 20px 60px #0003"],
            transitions: ["transition-duration: 200ms"],
            animations: ["animation-name: fade-in"],
            keyframes: ["@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }"],
          },
        },
      ],
      images: [],
      text: "make this page feel like the reference",
      messageID: "msg_inspiration",
      sessionID: "ses_inspiration",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("public website")
      expect(synthetic.text).toContain("https://example.com/")
      expect(synthetic.text).toContain("Reference mode: element")
      expect(synthetic.text).toContain("main > section.hero")
      expect(synthetic.text).toContain("font-size: 48px")
      expect(synthetic.text).toContain("@keyframes fade-in")
      expect(synthetic.text).toContain("Do not copy private assets")
    }
  })

  test("adds Autopilot context as a scoped orchestration note", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "start the run", start: 0, end: 13 }],
      context: [
        {
          key: "autopilot:run-1",
          type: "autopilot",
          runID: "run-1",
          goal: "Build and verify a dashboard",
          tasks: ["Build a dashboard", "Verify it"],
          workspace: "/repo",
          status: "running",
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
          plan: [
            {
              id: "verify",
              title: "Verify in loop",
              description: "Run tests and preview the UI.",
              owner: "opencode",
              status: "pending",
            },
          ],
          events: [
            {
              id: "run-1:goal",
              source: "user",
              title: "Goal accepted",
              body: "Build and verify a dashboard",
              at: "2026-05-22T10:00:00.000Z",
            },
          ],
          safeguards: ["Ask before destructive git actions."],
        },
      ],
      images: [],
      text: "start the run",
      messageID: "msg_autopilot",
      sessionID: "ses_autopilot",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.find((part) => part.type === "text" && part.synthetic)
    expect(synthetic?.type).toBe("text")
    if (synthetic?.type === "text") {
      expect(synthetic.text).toContain("Paddie Studio Autopilot")
      expect(synthetic.text).toContain("Build and verify a dashboard")
      expect(synthetic.text).toContain("Task queue")
      expect(synthetic.text).toContain("1. [pending] Build a dashboard")
      expect(synthetic.text).toContain("Selected model: openai/gpt-5 (high)")
      expect(synthetic.text).toContain("two-way loop")
      expect(synthetic.text).toContain("Run tests and preview the UI")
      expect(synthetic.text).toContain("Ask before destructive git actions")
    }
  })

  test("adds file parts for @mentions inside comment text", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "look", start: 0, end: 4 }],
      context: [
        {
          key: "ctx:comment-mention",
          type: "file",
          path: "src/review.ts",
          comment: "Compare with @src/shared.ts and @src/review.ts.",
        },
      ],
      images: [],
      text: "look",
      messageID: "msg_comment_mentions",
      sessionID: "ses_comment_mentions",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file")
    expect(files).toHaveLength(2)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/review.ts")).toBe(true)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/shared.ts")).toBe(true)
  })

  test("handles Windows paths correctly (simulated on macOS)", () => {
    const prompt: Prompt = [{ type: "file", path: "src\\foo.ts", content: "@src\\foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\foo.ts",
      messageID: "msg_win_1",
      sessionID: "ses_win_1",
      sessionDirectory: "D:\\projects\\myapp", // Windows path
    })

    // Should create valid file URLs
    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should not have encoded backslashes in wrong place
      expect(filePart.url).not.toContain("%5C")
      // Should have normalized to forward slashes
      expect(filePart.url).toContain("/src/foo.ts")
    }
  })

  test("handles Windows absolute path with special characters", () => {
    const prompt: Prompt = [{ type: "file", path: "file#name.txt", content: "@file#name.txt", start: 0, end: 14 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@file#name.txt",
      messageID: "msg_win_2",
      sessionID: "ses_win_2",
      sessionDirectory: "C:\\Users\\test\\Documents", // Windows path
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Special chars should be encoded
      expect(filePart.url).toContain("file%23name.txt")
      // Should have Windows drive letter properly encoded
      expect(filePart.url).toMatch(/file:\/\/\/[A-Z]:/)
    }
  })

  test("handles Linux absolute paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 10 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src/app.ts",
      messageID: "msg_linux_1",
      sessionID: "ses_linux_1",
      sessionDirectory: "/home/user/project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///home/user/project/src/app.ts")
    }
  })

  test("handles macOS paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "README.md", content: "@README.md", start: 0, end: 9 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@README.md",
      messageID: "msg_mac_1",
      sessionID: "ses_mac_1",
      sessionDirectory: "/Users/kelvin/Projects/opencode",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///Users/kelvin/Projects/opencode/README.md")
    }
  })

  test("handles context files with Windows paths", () => {
    const prompt: Prompt = []

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:1", type: "file", path: "src\\utils\\helper.ts" },
        { key: "ctx:2", type: "file", path: "test\\unit.test.ts", comment: "check tests" },
      ],
      images: [],
      text: "test",
      messageID: "msg_win_ctx",
      sessionID: "ses_win_ctx",
      sessionDirectory: "D:\\workspace\\app",
    })

    const fileParts = result.requestParts.filter((part) => part.type === "file")
    expect(fileParts).toHaveLength(2)

    // All file URLs should be valid
    fileParts.forEach((part) => {
      if (part.type === "file") {
        expect(() => new URL(part.url)).not.toThrow()
        expect(part.url).not.toContain("%5C") // No encoded backslashes
      }
    })
  })

  test("handles absolute Windows paths (user manually specifies full path)", () => {
    const prompt: Prompt = [
      { type: "file", path: "D:\\other\\project\\file.ts", content: "@D:\\other\\project\\file.ts", start: 0, end: 25 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@D:\\other\\project\\file.ts",
      messageID: "msg_abs",
      sessionID: "ses_abs",
      sessionDirectory: "C:\\current\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should handle absolute path that differs from sessionDirectory
      expect(() => new URL(filePart.url)).not.toThrow()
      expect(filePart.url).toContain("/D:/other/project/file.ts")
    }
  })

  test("handles selection with query parameters on Windows", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src\\App.tsx",
        content: "@src\\App.tsx",
        start: 0,
        end: 11,
        selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\App.tsx",
      messageID: "msg_sel",
      sessionID: "ses_sel",
      sessionDirectory: "C:\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should have query parameters
      expect(filePart.url).toContain("?start=10&end=20")
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Query params should parse correctly
      const url = new URL(filePart.url)
      expect(url.searchParams.get("start")).toBe("10")
      expect(url.searchParams.get("end")).toBe("20")
    }
  })

  test("handles file paths with dots and special segments on Windows", () => {
    const prompt: Prompt = [
      { type: "file", path: "..\\..\\shared\\util.ts", content: "@..\\..\\shared\\util.ts", start: 0, end: 21 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@..\\..\\shared\\util.ts",
      messageID: "msg_dots",
      sessionID: "ses_dots",
      sessionDirectory: "C:\\projects\\myapp\\src",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should preserve .. segments (backend normalizes)
      expect(filePart.url).toContain("/..")
    }
  })
})
