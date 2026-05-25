import { describe, expect, test } from "bun:test"
import { UpgradeRequiredError, paddieApiErrorFromResponse, paddieApiErrorMessage } from "./paddie-api"

describe("paddie api errors", () => {
  test("parses structured Studio access errors", () => {
    const err = paddieApiErrorFromResponse(402, {
      success: false,
      upgrade_required: true,
      code: "STUDIO_FLOW_LIMIT_EXCEEDED",
      message: "You've used all 5 Studio flows on your current plan.",
      current_plan: "free",
      required_tier: "pro",
      limit: 5,
      current: 5,
      upgrade_url: "/pricing",
    })

    expect(err).toBeInstanceOf(UpgradeRequiredError)
    expect(err).toMatchObject({
      code: "STUDIO_FLOW_LIMIT_EXCEEDED",
      message: "You've used all 5 Studio flows on your current plan.",
      current_plan: "free",
      current_tier: "free",
      required_tier: "pro",
      limit: 5,
      current: 5,
      upgrade_url: "/pricing",
    })
    expect(paddieApiErrorMessage(err)).toBe("You've used all 5 Studio flows on your current plan. (5/5)")
  })

  test("keeps generic errors plain", () => {
    expect(paddieApiErrorFromResponse(500, { error: "Nope" }).message).toBe("Nope")
  })
})
