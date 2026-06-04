export type PenpotDesignMode = "chat" | "inspiration" | "website" | "template" | "writeback"

export type PenpotAuthMode = "manual-url" | "token-url" | "oauth"

export type PenpotConnection = {
  id: string
  instanceUrl: string
  mcpName: string
  status: "idle" | "registered" | "connected" | "failed"
  authMode: PenpotAuthMode
  createdAt: string
  updatedAt: string
}

export type PenpotStyleSignals = {
  colors: string[]
  typography: string[]
  layout: string[]
  components: string[]
  interactions: string[]
}

export type PenpotSelectionSource = "bridge" | "manual"

export type PenpotSelectedItem = {
  id: string
  name: string
  type: string
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  path?: string
}

export type PenpotSelection = {
  instanceUrl: string
  fileId: string
  fileName?: string
  pageId: string
  pageName?: string
  items: PenpotSelectedItem[]
  selectedAt: string
}

export type PenpotBridgeSession = {
  id: string
  pairingCode: string
  bridgeToken?: string
  status: "waiting" | "paired" | "expired" | "disconnected"
  expiresAt: string
  manifestUrl?: string
  latestSelection?: PenpotSelection
}

export type PenpotDesignContextPayload = {
  instanceUrl: string
  fileId: string
  fileName?: string
  pageId: string
  pageName?: string
  frameIds: string[]
  frameNames: string[]
  mode: PenpotDesignMode
  mcpName: string
  styleSignals: PenpotStyleSignals
  assets: string[]
  tokens: Record<string, string>
  writebackAllowed: boolean
  selectionSource?: PenpotSelectionSource
  selectionId?: string
  selectedAt?: string
  selectedItems?: PenpotSelectedItem[]
  summary?: string
}

export const PENPOT_PRODUCTION_URL = "https://penpot.paddie.io"
export const PENPOT_PRODUCTION_MCP_NAME = "penpot-production"

export const emptyPenpotStyleSignals = (): PenpotStyleSignals => ({
  colors: [],
  typography: [],
  layout: [],
  components: [],
  interactions: [],
})

export const penbotPresets = [
  {
    id: "frame-to-website",
    mode: "website",
    label: "Build website",
    description: "Generate a website or app from the selected Penpot frame set.",
  },
  {
    id: "frame-to-template",
    mode: "template",
    label: "Create template",
    description: "Turn selected frames into a reusable Paddie starter/template reference.",
  },
  {
    id: "design-inspiration",
    mode: "inspiration",
    label: "Use as inspiration",
    description: "Attach layout, visual language, and component intent as design inspiration.",
  },
  {
    id: "token-sync",
    mode: "chat",
    label: "Extract tokens",
    description: "Ask the model to inspect colors, type, spacing, assets, and component patterns.",
  },
  {
    id: "writeback",
    mode: "writeback",
    label: "Write back",
    description: "Let the worker propose Penpot changes, with approval before any write tool is used.",
  },
] satisfies Array<{
  id: string
  mode: PenpotDesignMode
  label: string
  description: string
}>

export function normalizePenpotInstanceUrl(value: string) {
  const trimmed = value.trim() || PENPOT_PRODUCTION_URL
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(withProtocol)) throw new Error("Enter a valid Penpot URL.")
  return withProtocol.replace(/\/+$/, "")
}

export function buildPenpotMcpUrl(input: {
  instanceUrl: string
  mcpUrl?: string
  userToken?: string
}) {
  const manual = input.mcpUrl?.trim()
  if (manual) {
    const withProtocol = /^https?:\/\//i.test(manual) ? manual : `https://${manual}`
    if (!URL.canParse(withProtocol)) throw new Error("Enter a valid Penpot MCP URL.")
    const url = new URL(withProtocol)
    const token = input.userToken?.trim()
    if (token && !url.searchParams.get("userToken")) url.searchParams.set("userToken", token)
    return url.toString()
  }

  const base = normalizePenpotInstanceUrl(input.instanceUrl)
  const url = new URL(`${base}/mcp/stream`)
  const token = input.userToken?.trim()
  if (token) url.searchParams.set("userToken", token)
  return url.toString()
}

export function penpotMcpUrlIncludesUserToken(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return !!new URL(withProtocol).searchParams.get("userToken")?.trim()
  } catch {
    return false
  }
}

export function parsePenpotFrames(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(/\s*[:|]\s*/)
      if (parts.length > 1) {
        return {
          id: parts[0]!.trim(),
          name: parts.slice(1).join(" - ").trim() || parts[0]!.trim(),
        }
      }
      return {
        id: item,
        name: item,
      }
    })
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
}

export function penpotSelectionFrames(selection?: PenpotSelection) {
  return (selection?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name || item.id,
  }))
}

export function createPenpotDesignContext(input: {
  instanceUrl: string
  fileId?: string
  fileName?: string
  pageId?: string
  pageName?: string
  frames?: string
  selection?: PenpotSelection
  selectionSource?: PenpotSelectionSource
  selectionId?: string
  selectedAt?: string
  mode: PenpotDesignMode
  mcpName?: string
  writebackAllowed?: boolean
  summary?: string
}): PenpotDesignContextPayload {
  const selectedFrames = penpotSelectionFrames(input.selection)
  const frames = selectedFrames.length ? selectedFrames : parsePenpotFrames(input.frames ?? "")
  const frameIds = frames.map((frame) => frame.id)
  const frameNames = frames.map((frame) => frame.name)
  return {
    instanceUrl: normalizePenpotInstanceUrl(input.selection?.instanceUrl ?? input.instanceUrl),
    fileId: input.selection?.fileId || input.fileId?.trim() || "active Penpot file",
    fileName: input.selection?.fileName || input.fileName?.trim() || undefined,
    pageId: input.selection?.pageId || input.pageId?.trim() || "active Penpot page",
    pageName: input.selection?.pageName || input.pageName?.trim() || undefined,
    frameIds,
    frameNames,
    mode: input.mode,
    mcpName: input.mcpName?.trim() || PENPOT_PRODUCTION_MCP_NAME,
    styleSignals: emptyPenpotStyleSignals(),
    assets: [],
    tokens: {},
    writebackAllowed: input.writebackAllowed === true,
    selectionSource: input.selectionSource ?? (input.selection ? "bridge" : "manual"),
    selectionId: input.selectionId?.trim() || undefined,
    selectedAt: input.selectedAt || input.selection?.selectedAt,
    selectedItems: input.selection?.items ?? [],
    summary: input.summary?.trim() || undefined,
  }
}

export function penpotGoalNeedsDesign(goal: string) {
  return /\b(penpot|frame|frames|design file|design system|design tokens|figma-like|prototype|mockup|wireframe|component map|writeback)\b/i.test(goal)
}

export function penpotMcpRuntimeInstruction() {
  return [
    "Use the connected Penpot MCP server only when the user explicitly attached Penpot context or asked for Penpot/design-frame work.",
    "Read selected files, pages, frames, design tokens, assets, text, layout, component hierarchy, and prototype flow before generating code or templates.",
    "Do not call Penpot write/update/delete/create tools unless the attached context says writebackAllowed: true and the user has approved that specific action.",
    "When converting frames to code, preserve visible hierarchy, spacing, typography, colors, assets, responsive intent, component states, and route/prototype relationships.",
  ].join("\n")
}

export function formatPenpotDesignNote(item: PenpotDesignContextPayload) {
  const frames = item.frameIds.length
    ? item.frameIds.map((frame, index) => {
        const name = item.frameNames[index]
        return name && name !== frame ? `- ${name} (${frame})` : `- ${frame}`
      })
    : ["- Active or currently selected Penpot frame(s)"]
  const tokenLines = Object.entries(item.tokens).map(([key, value]) => `- ${key}: ${value}`)
  const selectedItemLines = (item.selectedItems ?? []).map((selected) => {
    const path = selected.path ? `, path: ${selected.path}` : ""
    return `- ${selected.name || selected.id} (${selected.type}, ${selected.id}${path})`
  })
  const lines = [
    "The user attached Penpot design context for this task.",
    `Penpot instance: ${item.instanceUrl}`,
    `MCP server: ${item.mcpName}`,
    `File: ${item.fileName ? `${item.fileName} (${item.fileId})` : item.fileId}`,
    `Page: ${item.pageName ? `${item.pageName} (${item.pageId})` : item.pageId}`,
    `Selection source: ${item.selectionSource ?? "manual"}`,
    item.selectionId ? `Selection ID: ${item.selectionId}` : "",
    item.selectedAt ? `Selected at: ${item.selectedAt}` : "",
    `Mode: ${item.mode}`,
    `Writeback allowed: ${item.writebackAllowed ? "yes, but ask for explicit approval before every Penpot write" : "no"}`,
    item.summary ? `User note: ${item.summary}` : "",
    "Selected frames:",
    ...frames,
    selectedItemLines.length ? "Selected objects:" : "",
    ...selectedItemLines,
    "",
    penpotMcpRuntimeInstruction(),
  ]
  if (item.assets.length) lines.push("", "Assets:", ...item.assets.map((asset) => `- ${asset}`))
  if (tokenLines.length) lines.push("", "Design tokens:", ...tokenLines)
  return lines.filter((line) => line !== "").join("\n")
}

export function penpotContextLabel(item: PenpotDesignContextPayload) {
  if (item.frameNames.length === 1) return item.frameNames[0]!
  if (item.frameNames.length > 1) return `${item.frameNames.length} Penpot frames`
  if (item.fileName) return item.fileName
  return "Penpot design"
}

export function penpotContextBody(item: PenpotDesignContextPayload) {
  const mode = item.mode === "website" ? "website" : item.mode === "template" ? "template" : item.mode
  const count = item.frameIds.length || item.frameNames.length
  return count ? `${mode} - ${count} frame${count === 1 ? "" : "s"}` : `${mode} - active frame`
}
