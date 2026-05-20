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
