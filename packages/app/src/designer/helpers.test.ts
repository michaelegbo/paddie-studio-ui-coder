import { describe, expect, test } from "bun:test"
import {
  applyPaddieDesignOperations,
  createDefaultDesignDocument,
  createPaddieDesignContext,
  designFrames,
  formatPaddieDesignNote,
  generateHtmlReference,
  parsePaddieDesignOperations,
} from "./helpers"

describe("designer helpers", () => {
  test("creates attachable design context from selected frames", () => {
    const document = createDefaultDesignDocument("Landing")
    const frame = designFrames(document)[0]!
    const context = createPaddieDesignContext({ document, selectedIds: [frame.id], mode: "website" })

    expect(context).toMatchObject({
      designId: document.id,
      designName: "Landing",
      frameIds: [frame.id],
      frameNames: [frame.name],
      mode: "website",
      writebackAllowed: false,
    })
    expect(formatPaddieDesignNote(context)).toContain("native Paddie Designer reference")
    expect(formatPaddieDesignNote(context)).toContain("Design JSON")
  })

  test("applies valid AI operations and rejects unsupported operations", () => {
    const document = createDefaultDesignDocument("Landing")
    const operations = parsePaddieDesignOperations(
      JSON.stringify({
        operations: [
          { type: "createFrame", id: "frame-ai", name: "AI frame", x: 10, y: 20, width: 320, height: 240 },
          { type: "createText", id: "text-ai", parentId: "frame-ai", text: "Generated", x: 30, y: 40 },
          { type: "group", id: "bad" },
        ],
      }),
    )
    const result = applyPaddieDesignOperations(document, operations)

    expect(designFrames(result.document).some((frame) => frame.id === "frame-ai")).toBe(true)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]?.reason).toContain("Unsupported operation")
  })

  test("exports selected frames as HTML reference", () => {
    const document = createDefaultDesignDocument("Landing")
    const frame = designFrames(document)[0]!
    const html = generateHtmlReference(document, [frame.id])

    expect(html).toContain(`data-frame-id="${frame.id}"`)
    expect(html).toContain("Design directly inside Paddie")
  })
})
