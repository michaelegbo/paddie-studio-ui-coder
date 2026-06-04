import { describe, expect, test } from "bun:test"
import {
  buildPenpotMcpUrl,
  createPenpotDesignContext,
  formatPenpotDesignNote,
  normalizePenpotInstanceUrl,
  parsePenpotFrames,
  penpotMcpUrlIncludesUserToken,
  penpotGoalNeedsDesign,
} from "./helpers"

describe("Penpot helpers", () => {
  test("normalizes Penpot instance URLs", () => {
    expect(normalizePenpotInstanceUrl("penpot.paddie.io/")).toBe("https://penpot.paddie.io")
    expect(normalizePenpotInstanceUrl("https://penpot.paddie.io/app")).toBe("https://penpot.paddie.io/app")
  })

  test("builds a remote MCP stream URL without exposing tokens to context helpers", () => {
    const url = buildPenpotMcpUrl({
      instanceUrl: "https://penpot.paddie.io",
      userToken: "secret-token",
    })

    expect(url).toBe("https://penpot.paddie.io/mcp/stream?userToken=secret-token")
  })

  test("keeps an explicit MCP URL when no separate key is provided", () => {
    expect(
      buildPenpotMcpUrl({
        instanceUrl: "https://penpot.paddie.io",
        mcpUrl: "https://penpot.paddie.io/custom-mcp",
      }),
    ).toBe("https://penpot.paddie.io/custom-mcp")
  })

  test("adds a separate MCP key to an explicit MCP URL", () => {
    expect(
      buildPenpotMcpUrl({
        instanceUrl: "https://penpot.paddie.io",
        mcpUrl: "https://penpot.paddie.io/custom-mcp",
        userToken: "secret-token",
      }),
    ).toBe("https://penpot.paddie.io/custom-mcp?userToken=secret-token")
  })

  test("detects user-approved remote MCP URLs from Penpot", () => {
    expect(penpotMcpUrlIncludesUserToken("https://penpot.paddie.io/mcp/stream?userToken=secret-token")).toBe(true)
    expect(penpotMcpUrlIncludesUserToken("penpot.paddie.io/mcp/stream?userToken=secret-token")).toBe(true)
    expect(penpotMcpUrlIncludesUserToken("https://penpot.paddie.io/mcp/stream")).toBe(false)
  })

  test("parses one or more Penpot frames", () => {
    expect(parsePenpotFrames("frame-1: Hero\nframe-2 | Pricing, frame-3")).toEqual([
      { id: "frame-1", name: "Hero" },
      { id: "frame-2", name: "Pricing" },
      { id: "frame-3", name: "frame-3" },
    ])
  })

  test("creates a design context with safe defaults", () => {
    expect(
      createPenpotDesignContext({
        instanceUrl: "penpot.paddie.io",
        frames: "hero: Hero",
        mode: "website",
      }),
    ).toMatchObject({
      instanceUrl: "https://penpot.paddie.io",
      fileId: "active Penpot file",
      pageId: "active Penpot page",
      frameIds: ["hero"],
      frameNames: ["Hero"],
      mode: "website",
      mcpName: "penpot-production",
      writebackAllowed: false,
      selectionSource: "manual",
      selectedItems: [],
    })
  })

  test("creates a design context from a bridge selection", () => {
    expect(
      createPenpotDesignContext({
        instanceUrl: "https://penpot.paddie.io",
        mode: "template",
        selectionId: "session-1",
        selection: {
          instanceUrl: "https://penpot.paddie.io",
          fileId: "file-1",
          fileName: "Landing",
          pageId: "page-1",
          pageName: "Screens",
          selectedAt: "2026-06-04T10:00:00.000Z",
          items: [{ id: "frame-1", name: "Hero", type: "frame", path: "Screens/Hero" }],
        },
      }),
    ).toMatchObject({
      fileId: "file-1",
      fileName: "Landing",
      pageId: "page-1",
      pageName: "Screens",
      frameIds: ["frame-1"],
      frameNames: ["Hero"],
      selectionSource: "bridge",
      selectionId: "session-1",
      selectedAt: "2026-06-04T10:00:00.000Z",
      selectedItems: [{ id: "frame-1", name: "Hero", type: "frame", path: "Screens/Hero" }],
    })
  })

  test("formats attached Penpot context without the remote MCP token", () => {
    const note = formatPenpotDesignNote(
      createPenpotDesignContext({
        instanceUrl: "https://penpot.paddie.io",
        fileId: "file-1",
        pageId: "page-1",
        frames: "frame-1: Hero",
        mode: "writeback",
        mcpName: "penpot-production",
        writebackAllowed: true,
        summary: "Use this as the landing page source.",
      }),
    )

    expect(note).toContain("Penpot design context")
    expect(note).toContain("MCP server: penpot-production")
    expect(note).toContain("Hero (frame-1)")
    expect(note).toContain("Writeback allowed: yes")
    expect(note).toContain("ask for explicit approval")
    expect(note).not.toContain("userToken")
    expect(note).not.toContain("secret-token")
  })

  test("detects Penpot design goals", () => {
    expect(penpotGoalNeedsDesign("convert these Penpot frames into a site")).toBe(true)
    expect(penpotGoalNeedsDesign("fix the unit tests")).toBe(false)
  })
})
