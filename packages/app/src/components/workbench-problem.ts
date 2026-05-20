import type { FileSelection } from "@/context/file"

type Marker = {
  code?: string | { value: string }
  severity: number
  message: string
  source?: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type Problem = {
  path: string
  code?: string
  severity: number
  message: string
  source?: string
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

const col = (value: number) => Math.max(0, value - 1)
const clean = (value: string) => value.trim().replace(/[. ]+$/g, "")
const code = (value: Marker["code"]) => {
  if (typeof value === "string") return value
  return value?.value
}
const size = (item: Problem) => {
  const rows = item.endLine - item.startLine
  const cols = item.endChar - item.startChar
  return rows * 100000 + cols
}
const hit = (item: Problem, line: number, char: number) => {
  if (line < item.startLine || line > item.endLine) return false
  if (line === item.startLine && char < item.startChar + 1) return false
  if (line === item.endLine && char > item.endChar + 1) return false
  return true
}
const tone = (value: number) => {
  if (value >= 8) return "Error"
  if (value >= 4) return "Warning"
  if (value >= 2) return "Info"
  return "Hint"
}

export const from = (path: string, item: Marker): Problem => ({
  path,
  code: code(item.code),
  severity: item.severity,
  message: item.message,
  source: item.source,
  startLine: item.startLineNumber,
  startChar: col(item.startColumn),
  endLine: item.endLineNumber,
  endChar: col(item.endColumn),
})

export const pick = (list: Problem[], line: number, char: number) =>
  list
    .filter((item) => hit(item, line, char))
    .sort((a, b) => b.severity - a.severity || size(a) - size(b))[0]

export const selection = (item: Problem): FileSelection => ({
  startLine: item.startLine,
  startChar: item.startChar,
  endLine: item.endLine,
  endChar: item.endChar,
})

export const label = (item: Problem) => {
  const start = item.startChar + 1
  const end = Math.max(start, item.endChar + 1)
  if (item.startLine === item.endLine) {
    if (start === end) return `line ${item.startLine}, column ${start}`
    return `line ${item.startLine}, columns ${start}-${end}`
  }
  return `lines ${item.startLine}-${item.endLine}, columns ${start}-${end}`
}

export const comment = (item: Problem) => {
  const lines = [
    `Fix this workspace diagnostic at ${label(item)}.`,
    `Message: ${clean(item.message)}.`,
    `Severity: ${tone(item.severity)}.`,
  ]
  if (item.source) lines.push(`Source: ${clean(item.source)}.`)
  if (item.code) lines.push(`Code: ${clean(item.code)}.`)
  return lines.join(" ")
}
