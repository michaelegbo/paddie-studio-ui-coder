import { expect, test } from "bun:test"
import { isStudioAuthUrl, STUDIO_AUTH_REDIRECT, studioBillingUrl, studioPaddieUrl } from "./paddie-links"

test("studio auth redirect defaults to stable scheme", () => {
  expect(STUDIO_AUTH_REDIRECT).toBe("paddiestudio://auth")
})

test("studio auth url accepts each desktop channel scheme", () => {
  expect(isStudioAuthUrl(new URL("paddiestudio://auth?token=stable"))).toBe(true)
  expect(isStudioAuthUrl(new URL("paddiestudiobeta://auth?token=beta"))).toBe(true)
  expect(isStudioAuthUrl(new URL("paddiestudiodev://auth?token=dev"))).toBe(true)
})

test("studio auth url rejects other schemes and hosts", () => {
  expect(isStudioAuthUrl(new URL("paddiestudio://login?token=no"))).toBe(false)
  expect(isStudioAuthUrl(new URL("https://app.paddie.io/auth?token=no"))).toBe(false)
})

test("studio billing url includes the desktop return link and source metadata", () => {
  const url = new URL(studioBillingUrl({ source: "templates" }))
  expect(url.origin).toBe("https://app.paddie.io")
  expect(url.pathname).toBe("/pricing")
  expect(url.searchParams.get("redirect")).toBe(STUDIO_AUTH_REDIRECT)
  expect(url.searchParams.get("source")).toBe("paddie-studio")
  expect(url.searchParams.get("studio_source")).toBe("templates")
})

test("studio billing url preserves safe RMN upgrade urls", () => {
  const url = new URL(studioBillingUrl({ source: "template-upgrade", upgradeUrl: "/pricing?plan=pro" }))
  expect(url.origin).toBe("https://app.paddie.io")
  expect(url.pathname).toBe("/pricing")
  expect(url.searchParams.get("plan")).toBe("pro")
  expect(url.searchParams.get("studio_source")).toBe("template-upgrade")
})

test("studio billing url ignores external upgrade urls", () => {
  const url = new URL(studioBillingUrl({ upgradeUrl: "https://example.com/pricing?plan=pro" }))
  expect(url.origin).toBe("https://app.paddie.io")
  expect(url.pathname).toBe("/pricing")
  expect(url.searchParams.get("plan")).toBe(null)
})

test("studio paddie url builds safe dashboard links", () => {
  const url = new URL(studioPaddieUrl({ path: "/dashboard", source: "account-dashboard" }))
  expect(url.origin).toBe("https://app.paddie.io")
  expect(url.pathname).toBe("/dashboard")
  expect(url.searchParams.get("redirect")).toBe(STUDIO_AUTH_REDIRECT)
  expect(url.searchParams.get("studio_source")).toBe("account-dashboard")
})

test("studio paddie url preserves safe app urls", () => {
  const url = new URL(studioPaddieUrl({ url: "https://app.paddie.io/account/billing?tab=usage", source: "account-manage" }))
  expect(url.origin).toBe("https://app.paddie.io")
  expect(url.pathname).toBe("/account/billing")
  expect(url.searchParams.get("tab")).toBe("usage")
  expect(url.searchParams.get("studio_source")).toBe("account-manage")
})
