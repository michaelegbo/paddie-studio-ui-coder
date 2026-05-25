import { describe, expect, test } from "bun:test"
import {
  markStudioProviderOnboardingSeen,
  shouldShowStudioProviderOnboarding,
  studioProviderOnboardingSeen,
} from "./studio-provider-onboarding"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

describe("studio provider onboarding", () => {
  test("waits for provider catalog before showing", () => {
    expect(
      shouldShowStudioProviderOnboarding({
        providerCatalogReady: false,
        connectedProviderCount: 0,
        seen: false,
      }),
    ).toBe(false)
  })

  test("does not show after a provider is connected", () => {
    expect(
      shouldShowStudioProviderOnboarding({
        providerCatalogReady: true,
        connectedProviderCount: 1,
        seen: false,
      }),
    ).toBe(false)
  })

  test("shows once when catalog is ready, no provider is connected, and user has not seen it", () => {
    expect(
      shouldShowStudioProviderOnboarding({
        providerCatalogReady: true,
        connectedProviderCount: 0,
        seen: false,
      }),
    ).toBe(true)
  })

  test("persists the seen flag", () => {
    const storage = memoryStorage()
    expect(studioProviderOnboardingSeen(storage)).toBe(false)
    markStudioProviderOnboardingSeen(storage)
    expect(studioProviderOnboardingSeen(storage)).toBe(true)
  })

  test("fails closed when storage is unavailable", () => {
    const storage = {
      getItem() {
        throw new Error("blocked")
      },
      setItem() {
        throw new Error("blocked")
      },
    }
    expect(studioProviderOnboardingSeen(storage)).toBe(false)
    expect(() => markStudioProviderOnboardingSeen(storage)).not.toThrow()
  })
})
