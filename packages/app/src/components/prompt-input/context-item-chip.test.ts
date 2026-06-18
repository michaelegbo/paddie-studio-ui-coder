import { describe, expect, test } from "bun:test"
import {
  BASE_DESIGN_PACK,
  createDesignPackContextItem,
  createDesignPackVariants,
  designPackContextKey,
} from "@/design-pack/helpers"
import { contextItemChip } from "./context-item-chip"

const styleSignals = {
  colors: [],
  typography: [],
  layout: [],
  borders: [],
  shadows: [],
  transitions: [],
  animations: [],
  keyframes: [],
  components: [],
  interactions: [],
}

describe("contextItemChip", () => {
  test("labels page inspiration references by page title", () => {
    expect(
      contextItemChip({
        key: "inspiration:page",
        type: "inspiration",
        url: "https://example.com/",
        pageTitle: "Example Home",
        mode: "page",
        label: "Full page",
        html: "<body />",
        styleSignals,
      }),
    ).toMatchObject({
      label: "Example Home",
      body: "https://example.com/",
      icon: "window-cursor",
    })
  })

  test("labels element inspiration references by selected element", () => {
    expect(
      contextItemChip({
        key: "inspiration:element",
        type: "inspiration",
        url: "https://example.com/",
        pageTitle: "Example Home",
        mode: "element",
        selector: "main > section.hero",
        label: "section.hero",
        text: "Hero copy",
        html: "<section />",
        styleSignals,
      }),
    ).toMatchObject({
      label: "section.hero",
      body: "Hero copy",
      icon: "window-cursor",
    })
  })

  test("labels Autopilot references by goal", () => {
    expect(
      contextItemChip({
        key: "autopilot:run-1",
        type: "autopilot",
        runID: "run-1",
        goal: "Build and verify a dashboard",
        workspace: "/repo",
        status: "running",
        plan: [],
        events: [],
        safeguards: [],
      }),
    ).toMatchObject({
      label: "Autopilot",
      body: "Build and verify a dashboard",
      icon: "brain",
    })
  })

  test("labels Paddie Memory integration references by service strategy", () => {
    expect(
      contextItemChip({
        key: "memory:dynamic-user:integration:Paddie Memory service",
        type: "memory",
        userID: "<DYNAMIC_USER_ID>",
        mode: "integration",
        label: "Paddie Memory service",
        content: "Integrate Memory Router.",
        endpoint: "POST /memory/router",
        userIDStrategy: "Create a stable app-specific Paddie Memory user_id per end user.",
      }),
    ).toMatchObject({
      label: "Paddie Memory service",
      body: "Create a stable app-specific Paddie Memory user_id per end user.",
      icon: "brain",
    })
  })

  test("labels Paddie Knowledge Base references by KB name", () => {
    expect(
      contextItemChip({
        key: "knowledge-base:kb_1:integration:onboarding",
        type: "knowledge-base",
        knowledgeBaseID: "kb_1",
        knowledgeBaseName: "Onboarding",
        mode: "integration",
        label: "Knowledge Base integration",
        endpoint: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
      }),
    ).toMatchObject({
      label: "Onboarding",
      body: "https://api.paddie.io/api/knowledge-bases/kb_1/query",
      icon: "layout-right-full",
    })
  })

  test("labels Paddie Data Playground references by selected runtime scope", () => {
    expect(
      contextItemChip({
        key: "data-playground:router:conversation:preference:kb_1",
        type: "data-playground",
        label: "Paddie Data Playground",
        apiBase: "https://api.paddie.io/api",
        apiKeyEnv: "PADDIE_API_KEY",
        mode: "router",
        routerMode: "conversation",
        memoryType: "preference",
        userIDStrategy: "Create a stable app-specific Paddie Memory user_id per end user.",
        integrationNote: "Build runtime Memory/RAG services.",
        llm: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
        knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
      }),
    ).toMatchObject({
      label: "Paddie Data Playground",
      body: "router memory, 1 KB via openai",
      icon: "brain",
    })
  })

  test("labels design pack variants by selected direction", () => {
    const variant = createDesignPackVariants(BASE_DESIGN_PACK, "Build a dashboard")[1]
    const item = createDesignPackContextItem(BASE_DESIGN_PACK, variant, "Build a dashboard")

    expect(
      contextItemChip({
        key: designPackContextKey(item),
        type: "design-pack",
        ...item,
      }),
    ).toMatchObject({
      label: "Dense Utility",
      body: "Base design variant",
      icon: "layout-right-full",
    })
  })
})
