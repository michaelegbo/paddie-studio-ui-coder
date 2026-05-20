import { expect, test } from "bun:test"
import { isStudioAuthUrl, STUDIO_AUTH_REDIRECT } from "./paddie-links"

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
