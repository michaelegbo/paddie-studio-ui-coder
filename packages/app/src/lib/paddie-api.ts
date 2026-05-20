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
  constructor(required: string, current: string) {
    super("Upgrade required")
    this.name = "UpgradeRequiredError"
    this.required_tier = required
    this.current_tier = current
  }
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

  let body: any
  try {
    body = await res.json()
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response`)
  }

  if (res.status === 402 && body.upgrade_required) {
    throw new UpgradeRequiredError(
      body.required_tier ?? "",
      body.current_tier ?? "",
    )
  }

  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  return body.data ?? body
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
