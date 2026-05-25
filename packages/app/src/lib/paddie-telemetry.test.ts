import { expect, test } from "bun:test"
import {
  buildPaddieStudioEventPayload,
  sanitizePaddieStudioMetadata,
} from "./paddie-telemetry"

test("builds support-safe Studio tracking payloads", () => {
  const payload = buildPaddieStudioEventPayload(
    {
      event: "template_attached",
      status: "success",
      email: " USER@Example.COM ",
      userID: "user_123",
      tenantID: "tenant_123",
      templateID: "landing-page",
      templateName: "Landing Page",
      message: "Template attached",
      metadata: {
        password: "nope",
        token: "secret",
        partID: "hero",
        prompt: "private instruction",
      },
    },
    {
      sessionID: "session_123",
      platform: "Win32",
      page: "/studio",
    },
  )

  expect(payload.email).toBe("user@example.com")
  expect(payload.session_id).toBe("session_123")
  expect(payload.template_id).toBe("landing-page")
  expect(payload.metadata).toEqual({
    partID: "hero",
  })
})

test("strips secret-like metadata keys recursively", () => {
  expect(
    sanitizePaddieStudioMetadata({
      ok: true,
      apiKey: "secret",
      nested: {
        authorization: "Bearer secret",
        safe: "kept",
      },
    }),
  ).toEqual({
    ok: true,
    nested: {
      safe: "kept",
    },
  })
})
