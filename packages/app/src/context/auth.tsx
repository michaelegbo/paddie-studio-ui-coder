import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, onMount } from "solid-js"
import { isStudioAuthUrl } from "@/lib/paddie-links"
import { trackPaddieStudioEvent } from "@/lib/paddie-telemetry"

export type AuthUser = {
  userId: string
  email: string
  tenantId: string
}

export type AuthSubscription = {
  plan_slug: string
  status: string
  access_allowed?: boolean
  billing_required?: boolean
  trial_required?: boolean
  trial_expired?: boolean
  trial_ends_at?: string | null
  trial_days_remaining?: number | null
  message?: string
  upgrade_url?: string
}

export type AuthState = {
  user: () => AuthUser | undefined
  subscription: () => AuthSubscription | undefined
  token: () => string | undefined
  isAuthenticated: () => boolean
  isLoading: () => boolean
  login: (email: string, password: string) => Promise<boolean>
  refresh: () => Promise<void>
  logout: () => void
}

export const TOKEN_KEY = "paddie_studio_token"
const RMN_TOKEN_KEY = "rmn_token"
const API_BASE =
  typeof window !== "undefined" && (window as any).__PADDIE_API_URL
    ? (window as any).__PADDIE_API_URL
    : import.meta.env.VITE_PADDIE_API_URL ?? "https://api.paddie.io/api"

const platformFetch = (): typeof fetch =>
  (typeof window !== "undefined" && (window as any).__paddie_fetch) || fetch

async function fetchJSON(url: string, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await platformFetch()(url, { headers })
  if (res.status === 401) throw new Error("unauthorized")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: () => {
    const [token, setToken] = createSignal<string | undefined>(
      typeof localStorage !== "undefined" ? (localStorage.getItem(TOKEN_KEY) ?? undefined) : undefined,
    )
    const [user, setUser] = createSignal<AuthUser | undefined>()
    const [subscription, setSubscription] = createSignal<AuthSubscription | undefined>()
    const [isLoading, setIsLoading] = createSignal(false)

    const hydrate = async (jwt: string) => {
      try {
        setIsLoading(true)

        // Restore user profile
        try {
          const meRes = await fetchJSON(`${API_BASE}/auth/me`, jwt)
          if (meRes.success && meRes.data) {
            setUser({
              userId: meRes.data.id ?? "",
              email: meRes.data.email ?? "",
              tenantId: meRes.data.tenant_id ?? "",
            })
          }
        } catch (err) {
          if (err instanceof Error && err.message === "unauthorized") {
            logout()
            return
          }
        }

        // Restore subscription
        const subRes = await fetchJSON(`${API_BASE}/users/me/subscription`, jwt)
        if (subRes.success && subRes.data) {
          if (subRes.data.plan) {
            setSubscription({
              plan_slug: subRes.data.plan.slug,
              status: subRes.data.subscription?.status ?? "active",
              access_allowed: subRes.data.access_allowed,
              billing_required: subRes.data.billing_required,
              trial_required: subRes.data.trial_required,
              trial_expired: subRes.data.trial_expired,
              trial_ends_at: subRes.data.trial_ends_at,
              trial_days_remaining: subRes.data.trial_days_remaining,
              message: subRes.data.blocker?.message,
              upgrade_url: subRes.data.blocker?.upgrade_url,
            })
          } else {
            setSubscription({
              plan_slug: "trial",
              status: subRes.data.blocker?.code ?? "subscription_required",
              access_allowed: false,
              billing_required: subRes.data.billing_required ?? true,
              trial_required: subRes.data.trial_required ?? true,
              trial_expired: subRes.data.trial_expired,
              trial_ends_at: subRes.data.trial_ends_at,
              trial_days_remaining: subRes.data.trial_days_remaining,
              message: subRes.data.blocker?.message,
              upgrade_url: subRes.data.blocker?.upgrade_url,
            })
          }
        } else {
          setSubscription({ plan_slug: "unknown", status: "unavailable", access_allowed: false })
        }
      } catch (err) {
        if (err instanceof Error && err.message === "unauthorized") {
          logout()
          return
        }
        setSubscription({ plan_slug: "unknown", status: "unavailable", access_allowed: false })
      } finally {
        setIsLoading(false)
      }
    }

    const login = async (email: string, password: string): Promise<boolean> => {
      const emailForTracking = email.trim().toLowerCase()
      trackPaddieStudioEvent("login_submitted", {
        status: "attempt",
        email: emailForTracking,
      })
      try {
        setIsLoading(true)
        const res = await platformFetch()(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          if (body?.error) console.warn("Login failed:", body.error)
          trackPaddieStudioEvent("login_failed", {
            status: "failure",
            email: emailForTracking,
            message: body?.error ?? `HTTP ${res.status}`,
          })
          return false
        }
        const body = await res.json()
        if (!body.success || !body.data?.token) {
          trackPaddieStudioEvent("login_failed", {
            status: "failure",
            email: emailForTracking,
            message: body?.error ?? "Login response did not include a token",
          })
          return false
        }

        const jwt = body.data.token
        localStorage.setItem(TOKEN_KEY, jwt)
        localStorage.setItem(RMN_TOKEN_KEY, jwt)
        setToken(jwt)

        if (body.data.user) {
          setUser({
            userId: body.data.user.id ?? body.data.user._id ?? "",
            email: body.data.user.email ?? email,
            tenantId: body.data.user.tenant_id ?? body.data.user.id ?? "",
          })
        }

        trackPaddieStudioEvent("login_succeeded", {
          status: "success",
          email: body.data.user?.email ?? emailForTracking,
          userID: body.data.user?.id ?? body.data.user?._id,
          tenantID: body.data.user?.tenant_id ?? body.data.user?.id,
        })
        await hydrate(jwt)
        return true
      } catch (err) {
        console.warn("Login error:", err)
        trackPaddieStudioEvent("login_failed", {
          status: "failure",
          email: emailForTracking,
          message: err instanceof Error ? err.message : String(err),
        })
        return false
      } finally {
        setIsLoading(false)
      }
    }

    const refresh = async () => {
      const stored = token()
      if (stored) await hydrate(stored)
    }

    const logout = () => {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(RMN_TOKEN_KEY)
      setToken(undefined)
      setUser(undefined)
      setSubscription(undefined)
    }

    onMount(() => {
      const stored = token()
      if (stored) {
        localStorage.setItem(RMN_TOKEN_KEY, stored)
        void hydrate(stored)
      }

      const onForceLogout = () => logout()
      window.addEventListener("paddie:logout", onForceLogout)

      // Handle deep link callbacks such as paddiestudio://auth?token=JWT.
      const onDeepLink = (e: Event) => {
        const urls: string[] = (e as CustomEvent).detail?.urls ?? []
        for (const url of urls) {
          try {
            const u = new URL(url)
            if (isStudioAuthUrl(u)) {
              const jwt = u.searchParams.get("token")
              if (jwt) {
                localStorage.setItem(TOKEN_KEY, jwt)
                localStorage.setItem(RMN_TOKEN_KEY, jwt)
                setToken(jwt)
                trackPaddieStudioEvent("login_deeplink_succeeded", { status: "success" })
                void hydrate(jwt)
                continue
              }
              const stored = token()
              if (stored) {
                localStorage.setItem(RMN_TOKEN_KEY, stored)
                void hydrate(stored)
              }
            }
          } catch {
            // ignore malformed URLs
          }
        }
      }
      window.addEventListener("paddiestudio:deep-link", onDeepLink)

      // Also handle any pending deep links that fired before the context mounted
      const pending: string[] = (window as any).__OPENCODE__?.deepLinks ?? []
      if (pending.length) onDeepLink(new CustomEvent("paddiestudio:deep-link", { detail: { urls: pending } }))

      onCleanup(() => {
        window.removeEventListener("paddie:logout", onForceLogout)
        window.removeEventListener("paddiestudio:deep-link", onDeepLink)
      })
    })

    return {
      user,
      subscription,
      token,
      isAuthenticated: () => !!token(),
      isLoading,
      login,
      refresh,
      logout,
    } satisfies AuthState
  },
})
