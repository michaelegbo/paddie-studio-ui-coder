import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { LocalPTY } from "@/context/terminal"
import { previewFromSession, previewFromTerminals, previewUrl } from "./preview-url"

const assistant = (id: string) =>
  ({
    id,
    sessionID: "s",
    role: "assistant",
    time: { created: 1 },
    agent: "a",
    model: { providerID: "p", modelID: "m" },
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as unknown as Message

const text = (id: string, value: string) =>
  ({
    id,
    sessionID: "s",
    messageID: "m",
    type: "text",
    text: value,
    time: { start: 1, end: 2 },
  }) as unknown as Part

const tool = (id: string, value: string) =>
  ({
    id,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: "c",
    tool: "terminal",
    state: {
      status: "completed",
      input: {},
      output: value,
      title: "Preview",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }) as unknown as Part

describe("preview-url", () => {
  test("normalizes localhost variants", () => {
    expect(previewUrl("ready at http://0.0.0.0:4173")).toBe("http://localhost:4173")
    expect(previewUrl("ready at http://[::1]:3000")).toBe("http://localhost:3000")
  })

  test("prefers the latest assistant url", () => {
    const messages = [assistant("a1"), assistant("a2")]
    const parts = {
      a1: [tool("p1", "URL: http://localhost:3000")],
      a2: [text("p2", "The app is running at http://localhost:4173/")],
    } satisfies Record<string, Part[]>

    expect(previewFromSession(messages, parts)).toBe("http://localhost:4173/")
  })

  test("falls back to terminal buffers", () => {
    const all = [
      { id: "1", title: "Terminal 1", titleNumber: 1, buffer: "vite v6" },
      { id: "2", title: "Terminal 2", titleNumber: 2, buffer: "Local: http://127.0.0.1:5173/" },
    ] satisfies LocalPTY[]

    expect(previewFromTerminals(all)).toBe("http://127.0.0.1:5173/")
  })
})
