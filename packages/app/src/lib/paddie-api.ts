/**
 * Paddie API Client
 *
 * Typed fetch wrapper for communication with the Paddie (RMN) backend.
 * Attaches the JWT from localStorage and handles common error flows.
 */

import { TOKEN_KEY } from "@/context/auth"

const API_BASE =
  typeof window !== "undefined" && (window as any).__PADDIE_API_URL
    ? (window as any).__PADDIE_API_URL
    : import.meta.env.VITE_PADDIE_API_URL ?? "https://api.paddie.io/api"

const platformFetch = (): typeof fetch =>
  (typeof window !== "undefined" && (window as any).__paddie_fetch) || fetch

function getToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export class UpgradeRequiredError extends Error {
  required_tier: string
  current_tier: string
  current_plan: string
  code?: string
  limit?: number
  current?: number
  upgrade_url?: string
  constructor(
    required:
      | string
      | {
          message?: string
          code?: string
          required_tier?: string
          current_tier?: string
          current_plan?: string
          limit?: number
          current?: number
          upgrade_url?: string
        },
    current?: string,
  ) {
    const payload = typeof required === "string" ? { required_tier: required, current_tier: current } : required
    super(payload.message || "Upgrade required")
    this.name = "UpgradeRequiredError"
    this.required_tier = payload.required_tier ?? ""
    this.current_tier = payload.current_tier ?? payload.current_plan ?? ""
    this.current_plan = payload.current_plan ?? this.current_tier
    this.code = payload.code
    this.limit = payload.limit
    this.current = payload.current
    this.upgrade_url = payload.upgrade_url
  }
}

export const paddieApiErrorMessage = (err: unknown) => {
  if (err instanceof UpgradeRequiredError) {
    const usage =
      typeof err.limit === "number" && err.limit >= 0 && typeof err.current === "number"
        ? ` (${err.current}/${err.limit})`
        : ""
    return `${err.message}${usage}`
  }
  return err instanceof Error ? err.message : String(err)
}

export function paddieApiErrorFromResponse(status: number, body: unknown) {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (status === 402 && data.upgrade_required) {
    return new UpgradeRequiredError({
      message: typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "Upgrade required",
      code: typeof data.code === "string" ? data.code : undefined,
      required_tier: typeof data.required_tier === "string" ? data.required_tier : undefined,
      current_tier: typeof data.current_tier === "string" ? data.current_tier : undefined,
      current_plan:
        typeof data.current_plan === "string"
          ? data.current_plan
          : typeof data.current_tier === "string"
            ? data.current_tier
            : typeof data.plan === "string"
              ? data.plan
            : undefined,
      limit: typeof data.limit === "number" ? data.limit : undefined,
      current: typeof data.current === "number" ? data.current : undefined,
      upgrade_url: typeof data.upgrade_url === "string" ? data.upgrade_url : undefined,
    })
  }
  return new Error(
    typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${status}`,
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await platformFetch()(`${API_BASE}${path}`, {
    ...init,
    headers,
    // Avoid stale template payloads when the API updates Mongo (iframes were showing old placeholder HTML).
    cache: init?.cache ?? "no-store",
  })

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new CustomEvent("paddie:logout"))
    throw new Error("unauthorized")
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response`)
  }

  if (!res.ok) {
    throw paddieApiErrorFromResponse(res.status, body)
  }

  const data = body && typeof body === "object" ? (body as { data?: T }) : undefined
  return data?.data ?? (body as T)
}

export const paddieApi = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
