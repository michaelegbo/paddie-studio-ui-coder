import { describe, expect, test } from "bun:test"
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
        key: "knowledge-base:kb_1:query:onboarding",
        type: "knowledge-base",
        knowledgeBaseID: "kb_1",
        knowledgeBaseName: "Onboarding",
        mode: "query",
        label: "Onboarding query",
        query: "How should onboarding work?",
      }),
    ).toMatchObject({
      label: "Onboarding",
      body: "How should onboarding work?",
      icon: "layout-right-full",
    })
  })
})
