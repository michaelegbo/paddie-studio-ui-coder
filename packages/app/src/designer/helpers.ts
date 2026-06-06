export type PaddieDesignMode = "chat" | "inspiration" | "website" | "template" | "ai-edit"

export type PaddieDesignElementType = "frame" | "rect" | "ellipse" | "line" | "text" | "image" | "component"

export type PaddieDesignTokenSet = {
  colors: Record<string, string>
  typography: Record<string, { fontFamily: string; fontSize: number; fontWeight?: number | string; lineHeight?: number }>
  spacing: Record<string, number>
  radius: Record<string, number>
}

export type PaddieDesignAsset = {
  id: string
  name: string
  kind: "image"
  src: string
  mime?: string
}

export type PaddieDesignElement = {
  id: string
  type: PaddieDesignElementType
  name: string
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  radius?: number
  opacity?: number
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  lineHeight?: number
  assetId?: string
  src?: string
  componentId?: string
  locked?: boolean
  hidden?: boolean
}

export type PaddieDesignFrame = PaddieDesignElement & {
  type: "frame"
}

export type PaddieDesignPage = {
  id: string
  name: string
  frameIds: string[]
  elements: Record<string, PaddieDesignElement>
}

export type PaddieDesignDocument = {
  id: string
  name: string
  version: 1
  currentPageId: string
  pages: PaddieDesignPage[]
  tokens: PaddieDesignTokenSet
  assets: PaddieDesignAsset[]
  createdAt: string
  updatedAt: string
}

export type PaddieDesignTransaction = {
  id: string
  label: string
  before: PaddieDesignDocument
  after: PaddieDesignDocument
  at: string
}

export type PaddieDesignContextPayload = {
  designId: string
  designName: string
  pageId: string
  frameIds: string[]
  frameNames: string[]
  mode: PaddieDesignMode
  document: PaddieDesignDocument
  selectedElements: PaddieDesignElement[]
  tokens: PaddieDesignTokenSet
  assets: PaddieDesignAsset[]
  thumbnailDataUrl?: string
  writebackAllowed: boolean
}

export type PaddieDesignOperation =
  | { type: "createFrame"; id?: string; name?: string; x?: number; y?: number; width?: number; height?: number; fill?: string }
  | { type: "createShape"; id?: string; shape: "rect" | "ellipse"; parentId?: string; name?: string; x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string; radius?: number }
  | { type: "createText"; id?: string; parentId?: string; name?: string; x?: number; y?: number; width?: number; height?: number; text?: string; fill?: string; fontSize?: number; fontWeight?: number | string }
  | { type: "updateBounds"; id: string; x?: number; y?: number; width?: number; height?: number }
  | { type: "updateStyle"; id: string; fill?: string; stroke?: string; strokeWidth?: number; radius?: number; opacity?: number; fontSize?: number; fontWeight?: number | string; text?: string }
  | { type: "deleteElement"; id: string }
  | { type: "createToken"; group: keyof PaddieDesignTokenSet; name: string; value: string | number | { fontFamily: string; fontSize: number; fontWeight?: number | string; lineHeight?: number } }

export type PaddieDesignRejectedOperation = {
  index: number
  reason: string
  operation: unknown
}

export const DESIGNER_CONTEXT_TYPE = "paddie-design" as const

const timestamp = () => new Date().toISOString()

export const createDesignerId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function defaultDesignTokens(): PaddieDesignTokenSet {
  return {
    colors: {
      background: "#0f0f0f",
      surface: "#1a1a1a",
      text: "#f5f5f5",
      muted: "#a1a1aa",
      accent: "#00d4aa",
      border: "#2f2f33",
    },
    typography: {
      display: { fontFamily: "system-ui", fontSize: 48, fontWeight: 700, lineHeight: 1.05 },
      heading: { fontFamily: "system-ui", fontSize: 28, fontWeight: 650, lineHeight: 1.15 },
      body: { fontFamily: "system-ui", fontSize: 16, fontWeight: 450, lineHeight: 1.45 },
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 40,
    },
    radius: {
      sm: 6,
      md: 10,
      lg: 16,
    },
  }
}

export function createDefaultDesignDocument(name = "Untitled design"): PaddieDesignDocument {
  const now = timestamp()
  const pageId = createDesignerId("page")
  const heroId = createDesignerId("frame")
  const cardId = createDesignerId("frame")
  const buttonId = createDesignerId("shape")
  const headlineId = createDesignerId("text")
  const bodyId = createDesignerId("text")
  const cardTitleId = createDesignerId("text")
  const cardBodyId = createDesignerId("text")

  return {
    id: createDesignerId("design"),
    name,
    version: 1,
    currentPageId: pageId,
    pages: [
      {
        id: pageId,
        name: "Page 1",
        frameIds: [heroId, cardId],
        elements: {
          [heroId]: {
            id: heroId,
            type: "frame",
            name: "Landing Hero",
            x: 80,
            y: 80,
            width: 960,
            height: 540,
            fill: "#101114",
            stroke: "#2f2f33",
            strokeWidth: 1,
            radius: 18,
          },
          [headlineId]: {
            id: headlineId,
            type: "text",
            parentId: heroId,
            name: "Headline",
            x: 144,
            y: 150,
            width: 560,
            height: 120,
            text: "Design directly inside Paddie",
            fill: "#f5f5f5",
            fontSize: 48,
            fontWeight: 720,
            lineHeight: 1.05,
          },
          [bodyId]: {
            id: bodyId,
            type: "text",
            parentId: heroId,
            name: "Body",
            x: 146,
            y: 286,
            width: 510,
            height: 72,
            text: "Create frames, components, tokens, and production-ready references without leaving Studio.",
            fill: "#a1a1aa",
            fontSize: 18,
            fontWeight: 450,
            lineHeight: 1.35,
          },
          [buttonId]: {
            id: buttonId,
            type: "rect",
            parentId: heroId,
            name: "Primary action",
            x: 146,
            y: 390,
            width: 170,
            height: 46,
            fill: "#00d4aa",
            radius: 8,
          },
          [cardId]: {
            id: cardId,
            type: "frame",
            name: "Feature Card",
            x: 1080,
            y: 120,
            width: 360,
            height: 300,
            fill: "#18181b",
            stroke: "#333338",
            strokeWidth: 1,
            radius: 16,
          },
          [cardTitleId]: {
            id: cardTitleId,
            type: "text",
            parentId: cardId,
            name: "Card title",
            x: 1112,
            y: 164,
            width: 280,
            height: 42,
            text: "Attach frames to chat",
            fill: "#f5f5f5",
            fontSize: 26,
            fontWeight: 680,
          },
          [cardBodyId]: {
            id: cardBodyId,
            type: "text",
            parentId: cardId,
            name: "Card body",
            x: 1114,
            y: 222,
            width: 280,
            height: 110,
            text: "Use a frame as inspiration, generate a website, or turn it into a reusable template.",
            fill: "#a1a1aa",
            fontSize: 16,
            lineHeight: 1.4,
          },
        },
      },
    ],
    tokens: defaultDesignTokens(),
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function currentDesignPage(document: PaddieDesignDocument) {
  return document.pages.find((page) => page.id === document.currentPageId) ?? document.pages[0]
}

export function designElements(document: PaddieDesignDocument) {
  return Object.values(currentDesignPage(document)?.elements ?? {})
}

export function designFrames(document: PaddieDesignDocument) {
  const page = currentDesignPage(document)
  if (!page) return []
  return page.frameIds.flatMap((id) => {
    const element = page.elements[id]
    return element?.type === "frame" ? [element as PaddieDesignFrame] : []
  })
}

export function frameChildren(document: PaddieDesignDocument, frameId: string) {
  return designElements(document).filter((element) => element.parentId === frameId)
}

export function selectedDesignElements(document: PaddieDesignDocument, ids: string[]) {
  const page = currentDesignPage(document)
  if (!page) return []
  return ids.flatMap((id) => {
    const element = page.elements[id]
    return element ? [element] : []
  })
}

export function compactDesignDocument(document: PaddieDesignDocument, frameIds: string[]) {
  const page = currentDesignPage(document)
  if (!page || frameIds.length === 0) return document
  const keep = new Set(frameIds)
  const elements = Object.fromEntries(
    Object.entries(page.elements).filter(([id, element]) => keep.has(id) || (element.parentId && keep.has(element.parentId))),
  )
  return {
    ...document,
    pages: [
      {
        ...page,
        frameIds: page.frameIds.filter((id) => keep.has(id)),
        elements,
      },
    ],
    currentPageId: page.id,
  }
}

export function createPaddieDesignContext(input: {
  document: PaddieDesignDocument
  selectedIds: string[]
  mode: PaddieDesignMode
  thumbnailDataUrl?: string
  writebackAllowed?: boolean
}): PaddieDesignContextPayload {
  const page = currentDesignPage(input.document)
  const selected = selectedDesignElements(input.document, input.selectedIds)
  const explicitFrames = selected.filter((item): item is PaddieDesignFrame => item.type === "frame")
  const childFrames = selected.flatMap((item) => {
    if (!item.parentId) return []
    const frame = page?.elements[item.parentId]
    return frame?.type === "frame" ? [frame as PaddieDesignFrame] : []
  })
  const uniqueFrames = [...explicitFrames, ...childFrames].filter(
    (frame, index, list) => list.findIndex((item) => item.id === frame.id) === index,
  )
  const frames = uniqueFrames.length ? uniqueFrames : designFrames(input.document).slice(0, 1)
  return {
    designId: input.document.id,
    designName: input.document.name,
    pageId: page?.id ?? input.document.currentPageId,
    frameIds: frames.map((frame) => frame.id),
    frameNames: frames.map((frame) => frame.name),
    mode: input.mode,
    document: compactDesignDocument(input.document, frames.map((frame) => frame.id)),
    selectedElements: selected,
    tokens: input.document.tokens,
    assets: input.document.assets,
    thumbnailDataUrl: input.thumbnailDataUrl,
    writebackAllowed: input.writebackAllowed ?? false,
  }
}

export function paddieDesignContextLabel(item: PaddieDesignContextPayload) {
  if (item.frameNames.length === 1) return item.frameNames[0]
  if (item.frameNames.length > 1) return `${item.frameNames.length} design frames`
  return item.designName
}

export function paddieDesignContextBody(item: PaddieDesignContextPayload) {
  const frames = item.frameNames.length ? item.frameNames.join(", ") : "active frame"
  return `${item.mode} - ${frames}`
}

export function formatPaddieDesignNote(item: PaddieDesignContextPayload) {
  const selected = item.selectedElements.map((element) => `- ${element.name} (${element.type}, ${element.id})`)
  const frames = item.frameIds.map((id, index) => `- ${item.frameNames[index] ?? id} (${id})`)
  return [
    "The user attached a native Paddie Designer reference.",
    `Design: ${item.designName} (${item.designId})`,
    `Page: ${item.pageId}`,
    `Mode: ${item.mode}`,
    `Writeback allowed: ${item.writebackAllowed ? "yes, but ask before every design mutation" : "no"}`,
    "Frames:",
    ...(frames.length ? frames : ["- Active frame"]),
    selected.length ? "Selected elements:" : "",
    ...selected,
    "Use the design JSON as the source of truth for layout, hierarchy, spacing, typography, color, and component intent.",
    "Do not change the user's design unless writebackAllowed is true and the user explicitly asks for a design edit.",
    `Design JSON:\n${JSON.stringify(item.document, null, 2).slice(0, 24_000)}`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function designContextPrompt(mode: PaddieDesignMode) {
  if (mode === "template") return "Create a reusable Paddie template from the attached Paddie Designer frame(s)."
  if (mode === "website") return "Build a website or app that faithfully implements the attached Paddie Designer frame(s)."
  if (mode === "inspiration") return "Use the attached Paddie Designer frame(s) as visual inspiration for this task."
  if (mode === "ai-edit") return "Return validated Paddie Designer operations as JSON to edit the selected design."
  return "Use the attached Paddie Designer frame(s) as context for this task."
}

export function generateHtmlReference(document: PaddieDesignDocument, frameIds: string[]) {
  const frames = designFrames(document).filter((frame) => frameIds.includes(frame.id))
  const renderElement = (element: PaddieDesignElement) => {
    const style = [
      "position:absolute",
      `left:${Math.round(element.x)}px`,
      `top:${Math.round(element.y)}px`,
      `width:${Math.round(element.width)}px`,
      `height:${Math.round(element.height)}px`,
      element.fill ? `color:${element.type === "text" ? element.fill : "inherit"}` : "",
      element.fill && element.type !== "text" ? `background:${element.fill}` : "",
      element.stroke ? `border:${element.strokeWidth ?? 1}px solid ${element.stroke}` : "",
      element.radius ? `border-radius:${element.radius}px` : "",
      element.opacity !== undefined ? `opacity:${element.opacity}` : "",
      element.type === "ellipse" ? "border-radius:999px" : "",
      element.type === "text" ? `font-size:${element.fontSize ?? 16}px` : "",
      element.type === "text" ? `font-weight:${element.fontWeight ?? 450}` : "",
      element.type === "text" ? `line-height:${element.lineHeight ?? 1.25}` : "",
      element.type === "text" ? `font-family:${element.fontFamily ?? "system-ui"}` : "",
      "box-sizing:border-box",
    ]
      .filter(Boolean)
      .join(";")
    if (element.type === "text") return `<div data-design-id="${escapeHtml(element.id)}" style="${style}">${escapeHtml(element.text ?? "")}</div>`
    return `<div data-design-id="${escapeHtml(element.id)}" style="${style}"></div>`
  }
  return frames
    .map((frame) => {
      const children = frameChildren(document, frame.id)
      return [
        `<section data-frame-id="${escapeHtml(frame.id)}" aria-label="${escapeHtml(frame.name)}" style="position:relative;width:${frame.width}px;height:${frame.height}px;background:${frame.fill ?? "transparent"};border-radius:${frame.radius ?? 0}px;overflow:hidden;">`,
        ...children.map(renderElement),
        "</section>",
      ].join("\n")
    })
    .join("\n\n")
}

export function parsePaddieDesignOperations(value: string) {
  const parsed = JSON.parse(value) as unknown
  if (Array.isArray(parsed)) return parsed
  if (isRecord(parsed) && Array.isArray(parsed.operations)) return parsed.operations
  throw new Error("Expected a JSON array or an object with an operations array.")
}

export function applyPaddieDesignOperations(document: PaddieDesignDocument, operations: unknown[]) {
  const next = structuredClone(document)
  const page = currentDesignPage(next)
  const rejected: PaddieDesignRejectedOperation[] = []
  if (!page) return { document, rejected: operations.map((operation, index) => ({ index, operation, reason: "No active page." })) }

  operations.forEach((operation, index) => {
    const result = applyOperation(page, next, operation)
    if (result) rejected.push({ index, operation, reason: result })
  })

  return {
    document: rejected.length === operations.length ? document : { ...next, updatedAt: timestamp() },
    rejected,
  }
}

function applyOperation(page: PaddieDesignPage, document: PaddieDesignDocument, operation: unknown) {
  if (!isRecord(operation)) return "Operation must be an object."
  const type = stringValue(operation.type)
  if (type === "createFrame") {
    const id = stringValue(operation.id) || createDesignerId("frame")
    page.elements[id] = {
      id,
      type: "frame",
      name: stringValue(operation.name) || "Frame",
      x: numberValue(operation.x, 80),
      y: numberValue(operation.y, 80),
      width: numberValue(operation.width, 960),
      height: numberValue(operation.height, 540),
      fill: stringValue(operation.fill) || document.tokens.colors.surface,
      stroke: document.tokens.colors.border,
      strokeWidth: 1,
      radius: 16,
    }
    page.frameIds = [...page.frameIds, id]
    return
  }
  if (type === "createShape") {
    const shape = stringValue(operation.shape)
    if (shape !== "rect" && shape !== "ellipse") return "createShape.shape must be rect or ellipse."
    const id = stringValue(operation.id) || createDesignerId("shape")
    page.elements[id] = {
      id,
      type: shape,
      parentId: stringValue(operation.parentId) || undefined,
      name: stringValue(operation.name) || (shape === "rect" ? "Rectangle" : "Ellipse"),
      x: numberValue(operation.x, 120),
      y: numberValue(operation.y, 120),
      width: numberValue(operation.width, 180),
      height: numberValue(operation.height, 120),
      fill: stringValue(operation.fill) || document.tokens.colors.accent,
      stroke: stringValue(operation.stroke) || undefined,
      radius: numberValue(operation.radius, shape === "rect" ? 8 : 0),
    }
    return
  }
  if (type === "createText") {
    const id = stringValue(operation.id) || createDesignerId("text")
    page.elements[id] = {
      id,
      type: "text",
      parentId: stringValue(operation.parentId) || undefined,
      name: stringValue(operation.name) || "Text",
      x: numberValue(operation.x, 120),
      y: numberValue(operation.y, 120),
      width: numberValue(operation.width, 320),
      height: numberValue(operation.height, 60),
      text: stringValue(operation.text) || "Text",
      fill: stringValue(operation.fill) || document.tokens.colors.text,
      fontSize: numberValue(operation.fontSize, 24),
      fontWeight: operation.fontWeight === undefined ? 600 : stringOrNumberValue(operation.fontWeight),
      lineHeight: 1.2,
    }
    return
  }
  if (type === "updateBounds") {
    const element = page.elements[stringValue(operation.id)]
    if (!element) return "updateBounds.id does not match an element."
    page.elements[element.id] = {
      ...element,
      x: operation.x === undefined ? element.x : numberValue(operation.x, element.x),
      y: operation.y === undefined ? element.y : numberValue(operation.y, element.y),
      width: operation.width === undefined ? element.width : numberValue(operation.width, element.width),
      height: operation.height === undefined ? element.height : numberValue(operation.height, element.height),
    }
    return
  }
  if (type === "updateStyle") {
    const element = page.elements[stringValue(operation.id)]
    if (!element) return "updateStyle.id does not match an element."
    page.elements[element.id] = {
      ...element,
      fill: operation.fill === undefined ? element.fill : stringValue(operation.fill),
      stroke: operation.stroke === undefined ? element.stroke : stringValue(operation.stroke),
      strokeWidth: operation.strokeWidth === undefined ? element.strokeWidth : numberValue(operation.strokeWidth, element.strokeWidth ?? 1),
      radius: operation.radius === undefined ? element.radius : numberValue(operation.radius, element.radius ?? 0),
      opacity: operation.opacity === undefined ? element.opacity : numberValue(operation.opacity, element.opacity ?? 1),
      fontSize: operation.fontSize === undefined ? element.fontSize : numberValue(operation.fontSize, element.fontSize ?? 16),
      fontWeight: operation.fontWeight === undefined ? element.fontWeight : stringOrNumberValue(operation.fontWeight),
      text: operation.text === undefined ? element.text : stringValue(operation.text),
    }
    return
  }
  if (type === "deleteElement") {
    const id = stringValue(operation.id)
    if (!page.elements[id]) return "deleteElement.id does not match an element."
    delete page.elements[id]
    page.frameIds = page.frameIds.filter((frameId) => frameId !== id)
    Object.values(page.elements)
      .filter((element) => element.parentId === id)
      .forEach((element) => delete page.elements[element.id])
    return
  }
  if (type === "createToken") {
    const group = stringValue(operation.group)
    const name = stringValue(operation.name)
    if (!name) return "createToken.name is required."
    if (group === "colors" && typeof operation.value === "string") {
      document.tokens.colors[name] = operation.value
      return
    }
    if (group === "spacing" && typeof operation.value === "number") {
      document.tokens.spacing[name] = operation.value
      return
    }
    if (group === "radius" && typeof operation.value === "number") {
      document.tokens.radius[name] = operation.value
      return
    }
    if (group === "typography" && isRecord(operation.value)) {
      document.tokens.typography[name] = {
        fontFamily: stringValue(operation.value.fontFamily) || "system-ui",
        fontSize: numberValue(operation.value.fontSize, 16),
        fontWeight: operation.value.fontWeight === undefined ? undefined : stringOrNumberValue(operation.value.fontWeight),
        lineHeight: operation.value.lineHeight === undefined ? undefined : numberValue(operation.value.lineHeight, 1.2),
      }
      return
    }
    return "createToken.group/value is invalid."
  }
  return `Unsupported operation: ${type || "unknown"}.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringOrNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : stringValue(value)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
