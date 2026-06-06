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

  test("parses legacy RMN plan fields for Data limit errors", () => {
    const err = paddieApiErrorFromResponse(402, {
      success: false,
      upgrade_required: true,
      code: "KB_QUERY_LIMIT_EXCEEDED",
      error: "RAG query limit exceeded",
      plan: "free",
      limit: 20,
      current: 20,
    })

    expect(err).toBeInstanceOf(UpgradeRequiredError)
    expect(err).toMatchObject({
      code: "KB_QUERY_LIMIT_EXCEEDED",
      message: "RAG query limit exceeded",
      current_plan: "free",
      current_tier: "free",
      limit: 20,
      current: 20,
    })
    expect(paddieApiErrorMessage(err)).toBe("RAG query limit exceeded (20/20)")
  })

  test("parses card-backed trial billing blockers", () => {
    const err = paddieApiErrorFromResponse(402, {
      success: false,
      upgrade_required: true,
      code: "TRIAL_REQUIRED",
      message: "Choose a plan and add a card to start your 14-day Paddie trial.",
      current_plan: "trial",
      billing_required: true,
      trial_required: true,
      upgrade_url: "/pricing",
    })

    expect(err).toBeInstanceOf(UpgradeRequiredError)
    expect(err).toMatchObject({
      code: "TRIAL_REQUIRED",
      message: "Choose a plan and add a card to start your 14-day Paddie trial.",
      current_plan: "trial",
      current_tier: "trial",
      billing_required: true,
      trial_required: true,
      upgrade_url: "/pricing",
    })
  })

  test("parses nested RMN billing blockers", () => {
    const err = paddieApiErrorFromResponse(402, {
      success: false,
      upgrade_required: true,
      current_plan: "trial",
      blocker: {
        code: "TRIAL_REQUIRED",
        message: "Choose a plan and add a card to start your 14-day Paddie trial.",
        upgrade_url: "/pricing?plan=pro",
        required_tier: "pro",
        billing_required: true,
        trial_required: true,
      },
    })

    expect(err).toBeInstanceOf(UpgradeRequiredError)
    expect(err).toMatchObject({
      code: "TRIAL_REQUIRED",
      message: "Choose a plan and add a card to start your 14-day Paddie trial.",
      current_plan: "trial",
      required_tier: "pro",
      billing_required: true,
      trial_required: true,
      upgrade_url: "/pricing?plan=pro",
    })
  })
})
