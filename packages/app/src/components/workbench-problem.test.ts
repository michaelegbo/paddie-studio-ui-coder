import { expect, test } from "bun:test"
import { comment, from, label, pick, selection } from "./workbench-problem"

test("pick prefers the most severe overlapping problem", () => {
  const list = [
    from("/repo/src/App.tsx", {
      severity: 4,
      message: "warning",
      startLineNumber: 12,
      startColumn: 1,
      endLineNumber: 12,
      endColumn: 20,
    }),
    from("/repo/src/App.tsx", {
      severity: 8,
      message: "error",
      startLineNumber: 12,
      startColumn: 4,
      endLineNumber: 12,
      endColumn: 10,
    }),
  ]

  expect(pick(list, 12, 5)?.message).toBe("error")
})

test("label and selection keep the exact marker range", () => {
  const item = from("/repo/src/App.tsx", {
    severity: 8,
    message: "Missing closing tag",
    source: "typescript",
    code: { value: "17008" },
    startLineNumber: 209,
    startColumn: 7,
    endLineNumber: 209,
    endColumn: 42,
  })

  expect(label(item)).toBe("line 209, columns 7-42")
  expect(selection(item)).toEqual({
    startLine: 209,
    startChar: 6,
    endLine: 209,
    endChar: 41,
  })
})

test("comment includes the diagnostic details used for Studio context", () => {
  const item = from("/repo/src/App.tsx", {
    severity: 8,
    message: " JSX element 'nav' has no corresponding closing tag. ",
    source: "typescript",
    code: "17008",
    startLineNumber: 209,
    startColumn: 7,
    endLineNumber: 209,
    endColumn: 42,
  })

  expect(comment(item)).toBe(
    "Fix this workspace diagnostic at line 209, columns 7-42. Message: JSX element 'nav' has no corresponding closing tag. Severity: Error. Source: typescript. Code: 17008.",
  )
})
