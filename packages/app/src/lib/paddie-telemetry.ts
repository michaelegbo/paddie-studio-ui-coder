type PaddieWindow = Window & {
  __PADDIE_API_URL?: string
  __paddie_fetch?: typeof fetch
}

export type PaddieStudioEventName =
  | "login_browser_opened"
  | "login_submitted"
  | "login_succeeded"
  | "login_failed"
  | "login_deeplink_succeeded"
  | "template_catalog_loaded"
  | "template_catalog_failed"
  | "template_gallery_preview_loaded"
  | "template_gallery_preview_failed"
  | "template_opened"
  | "template_detail_loaded"
  | "template_detail_failed"
  | "template_attached"
  | "template_picker_loaded"
  | "template_picker_failed"
  | "template_create_started"
  | "template_create_succeeded"
  | "template_create_failed"
  | "workflow_attached"

export type PaddieStudioEventStatus = "attempt" | "success" | "failure" | "info"

export type PaddieStudioEventInput = {
  event: PaddieStudioEventName
  status?: PaddieStudioEventStatus
  email?: string
  userID?: string
  tenantID?: string
  templateID?: string
  templateName?: string
  workflowID?: string
  workflowName?: string
  message?: string
  metadata?: Record<string, unknown>
}

export type PaddieStudioEventPayload = {
  event: PaddieStudioEventName
  status: PaddieStudioEventStatus
  email?: string
  user_id?: string
  tenant_id?: string
  session_id: string
  app_version?: string
  platform?: string
  page?: string
  template_id?: string
  template_name?: string
  workflow_id?: string
  workflow_name?: string
  message?: string
  metadata?: Record<string, unknown>
}

const TOKEN_KEY = "paddie_studio_token"
const SESSION_KEY = "paddie_studio_support_session"
const API_BASE =
  typeof window !== "undefined" && (window as PaddieWindow).__PADDIE_API_URL
    ? (window as PaddieWindow).__PADDIE_API_URL!
    : import.meta.env.VITE_PADDIE_API_URL ?? "https://api.paddie.io/api"

const blockedMetadataKey = /(password|passcode|token|secret|credential|authorization|api[_-]?key|jwt|bearer|prompt|content|html)/i

function platformFetch(): typeof fetch {
  return (typeof window !== "undefined" && (window as PaddieWindow).__paddie_fetch) || fetch
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function getSessionID() {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `paddie-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return "paddie-session-unavailable"
  }
}

function cleanString(value: string, max = 500) {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function cleanEmail(value: string | undefined) {
  const next = value?.trim().toLowerCase()
  if (!next || !next.includes("@")) return undefined
  return cleanString(next, 320)
}

function cleanMetadataValue(value: unknown, depth: number): unknown {
  if (value == null) return value
  if (typeof value === "string") return cleanString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return depth > 1 ? "[array]" : value.slice(0, 20).map((item) => cleanMetadataValue(item, depth + 1))
  if (typeof value !== "object") return String(value)
  if (depth > 1) return "[object]"
  return sanitizePaddieStudioMetadata(value as Record<string, unknown>, depth + 1)
}

export function sanitizePaddieStudioMetadata(metadata: Record<string, unknown> | undefined, depth = 0) {
  if (!metadata) return undefined
  const entries = Object.entries(metadata)
    .filter(([key]) => key && !blockedMetadataKey.test(key))
    .slice(0, 40)
    .map(([key, value]) => [cleanString(key, 80), cleanMetadataValue(value, depth)] as const)
  if (!entries.length) return undefined
  return Object.fromEntries(entries)
}

export function buildPaddieStudioEventPayload(
  input: PaddieStudioEventInput,
  runtime?: {
    sessionID?: string
    appVersion?: string
    platform?: string
    page?: string
  },
): PaddieStudioEventPayload {
  return {
    event: input.event,
    status: input.status ?? "info",
    email: cleanEmail(input.email),
    user_id: input.userID ? cleanString(input.userID, 160) : undefined,
    tenant_id: input.tenantID ? cleanString(input.tenantID, 160) : undefined,
    session_id: runtime?.sessionID ?? getSessionID(),
    app_version: runtime?.appVersion,
    platform: runtime?.platform,
    page: runtime?.page,
    template_id: input.templateID ? cleanString(input.templateID, 160) : undefined,
    template_name: input.templateName ? cleanString(input.templateName, 240) : undefined,
    workflow_id: input.workflowID ? cleanString(input.workflowID, 160) : undefined,
    workflow_name: input.workflowName ? cleanString(input.workflowName, 240) : undefined,
    message: input.message ? cleanString(input.message) : undefined,
    metadata: sanitizePaddieStudioMetadata(input.metadata),
  }
}

export function trackPaddieStudioEvent(event: PaddieStudioEventName, input: Omit<PaddieStudioEventInput, "event"> = {}) {
  const payload = buildPaddieStudioEventPayload(
    { ...input, event },
    typeof window === "undefined"
      ? undefined
      : {
          platform: navigator.platform,
          page: window.location.pathname,
        },
  )
  const token = getToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`

  void platformFetch()(`${API_BASE}/studio/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => {
    // Support tracking must never break Studio, login, templates, chat, or code generation.
  })
}
