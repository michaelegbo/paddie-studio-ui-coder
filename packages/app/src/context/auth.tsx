import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, onMount } from "solid-js"

export type AuthUser = {
  userId: string
  email: string
  tenantId: string
}

export type AuthSubscription = {
  plan_slug: string
  status: string
}

export type AuthState = {
  user: () => AuthUser | undefined
  subscription: () => AuthSubscription | undefined
  token: () => string | undefined
  isAuthenticated: () => boolean
  isLoading: () => boolean
  login: (email: string, password: string) => Promise<boolean>
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
            })
          } else {
            setSubscription({ plan_slug: "free", status: "none" })
          }
        } else {
          setSubscription({ plan_slug: "free", status: "none" })
        }
      } catch (err) {
        if (err instanceof Error && err.message === "unauthorized") {
          logout()
        }
      } finally {
        setIsLoading(false)
      }
    }

    const login = async (email: string, password: string): Promise<boolean> => {
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
          return false
        }
        const body = await res.json()
        if (!body.success || !body.data?.token) return false

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

        await hydrate(jwt)
        return true
      } catch (err) {
        console.warn("Login error:", err)
        return false
      } finally {
        setIsLoading(false)
      }
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

      // Handle deep link: paddiestudio://auth?token=JWT
      const onDeepLink = (e: Event) => {
        const urls: string[] = (e as CustomEvent).detail?.urls ?? []
        for (const url of urls) {
          try {
            const u = new URL(url)
            if (u.protocol === "paddiestudio:" && u.hostname === "auth") {
              const jwt = u.searchParams.get("token")
              if (jwt) {
                localStorage.setItem(TOKEN_KEY, jwt)
                localStorage.setItem(RMN_TOKEN_KEY, jwt)
                setToken(jwt)
                void hydrate(jwt)
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
      logout,
    } satisfies AuthState
  },
})
