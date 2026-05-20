import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { LocalPTY } from "@/context/terminal"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const previewUrl = (text: string) => {
  const hit = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9.-]+):\d+(?:\/\S*)?/i)?.[0]
  if (!hit) return
  return hit.replace("0.0.0.0", "localhost").replace("[::1]", "localhost")
}

const metaUrl = (value: unknown) => {
  if (!record(value)) return
  const url = value.url
  if (typeof url !== "string") return
  return previewUrl(url)
}

const partUrl = (part: Part) => {
  if (part.type === "text" || part.type === "reasoning") return previewUrl(part.text)
  if (part.type !== "tool") return
  if (part.state.status === "completed") return metaUrl(part.state.metadata) ?? previewUrl(part.state.output)
  if (part.state.status === "error") return previewUrl(part.state.error)
}

export const previewFromParts = (parts: Part[]) => {
  for (let i = parts.length - 1; i >= 0; i--) {
    const hit = partUrl(parts[i]!)
    if (hit) return hit
  }
}

export const previewFromSession = (messages: Message[], parts: Record<string, Part[] | undefined>) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role !== "assistant") continue
    const hit = previewFromParts(parts[msg.id] ?? [])
    if (hit) return hit
  }
}

export const previewFromTerminals = (all: LocalPTY[]) => {
  for (let i = all.length - 1; i >= 0; i--) {
    const hit = all[i]!.buffer ? previewUrl(all[i]!.buffer!) : undefined
    if (hit) return hit
  }
}
