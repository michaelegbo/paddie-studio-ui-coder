export const STUDIO_AUTH_SCHEMES = ["paddiestudio", "paddiestudiobeta", "paddiestudiodev"] as const
export const STUDIO_AUTH_SCHEME =
  import.meta.env.VITE_OPENCODE_CHANNEL === "dev"
    ? "paddiestudiodev"
    : import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
      ? "paddiestudiobeta"
      : "paddiestudio"
export const STUDIO_AUTH_REDIRECT = `${STUDIO_AUTH_SCHEME}://auth`
const REDIRECT = encodeURIComponent(STUDIO_AUTH_REDIRECT)

export function isStudioAuthUrl(url: URL) {
  return url.hostname === "auth" && STUDIO_AUTH_SCHEMES.some((scheme) => url.protocol === `${scheme}:`)
}

export const PADDIE_APP_ORIGIN = "https://app.paddie.io"
export const STUDIO_LOGIN_URL = `https://app.paddie.io/login?redirect=${REDIRECT}`
export const STUDIO_SIGNUP_URL = `https://app.paddie.io/signup?redirect=${REDIRECT}`
export const WORKFLOW_BUILDER_URL = "https://app.paddie.io/studio/fullscreen"

export type StudioBillingSource =
  | "templates"
  | "template-upgrade"
  | "data-memory"
  | "data-knowledge"
  | "data-api"
  | "account"
  | "account-manage"
  | "account-upgrade"

export type StudioPaddieSource = StudioBillingSource | "account-dashboard" | "account-analytics"

export function studioPaddieUrl(input?: {
  path?: string
  source?: StudioPaddieSource
  url?: string | null
  plan?: string | null
}) {
  const url = (() => {
    const raw = input?.url?.trim()
    if (!raw) return new URL(input?.path ?? "/dashboard", PADDIE_APP_ORIGIN)
    try {
      const parsed = new URL(raw, PADDIE_APP_ORIGIN)
      if (parsed.origin === PADDIE_APP_ORIGIN) return parsed
    } catch {
      return new URL(input?.path ?? "/dashboard", PADDIE_APP_ORIGIN)
    }
    return new URL(input?.path ?? "/dashboard", PADDIE_APP_ORIGIN)
  })()

  url.searchParams.set("redirect", STUDIO_AUTH_REDIRECT)
  url.searchParams.set("source", "paddie-studio")
  if (input?.source) url.searchParams.set("studio_source", input.source)
  if (input?.plan) url.searchParams.set("plan", input.plan)
  return url.toString()
}

export function studioBillingUrl(input?: {
  source?: StudioBillingSource
  upgradeUrl?: string | null
  plan?: string | null
}) {
  return studioPaddieUrl({ path: "/pricing", source: input?.source, url: input?.upgradeUrl, plan: input?.plan })
}

export const STUDIO_BILLING_URL = studioBillingUrl()
export const STUDIO_DASHBOARD_URL = studioPaddieUrl({ path: "/dashboard", source: "account-dashboard" })
