import { describe, expect, test } from "bun:test"
import {
  autopilotContextFromRun,
  autopilotWorkerPrompt,
  createAutopilotRun,
  formatAutopilotModel,
  normalizeAutopilotGoal,
  transitionAutopilotRun,
} from "./helpers"

describe("autopilot helpers", () => {
  test("normalizes goals and rejects empty input", () => {
    expect(normalizeAutopilotGoal("  build   a dashboard  ")).toBe("build a dashboard")
    expect(() => normalizeAutopilotGoal("  ")).toThrow("Autopilot goal")
  })

  test("creates a scoped run with the selected agent and model", () => {
    const run = createAutopilotRun({
      runID: "run-1",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Build and test the landing page",
      workspace: "C:/repo/app",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    })

    expect(run).toMatchObject({
      runID: "run-1",
      goal: "Build and test the landing page",
      workspace: "C:/repo/app",
      status: "running",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    })
    expect(run.plan.map((step) => step.id)).toEqual(["understand", "handoff", "implement", "verify", "summarize"])
    expect(run.events.map((event) => event.source)).toEqual(["user", "paddie", "system"])
  })

  test("formats model labels and worker prompt handoff text", () => {
    const run = autopilotContextFromRun(
      createAutopilotRun({
        runID: "run-2",
        now: "2026-05-22T10:00:00.000Z",
        goal: "Create a CRM",
        workspace: "/repo",
        model: { providerID: "anthropic", modelID: "claude", variant: "sonnet" },
      }),
    )

    expect(formatAutopilotModel(run.model)).toBe("anthropic/claude (sonnet)")
    expect(autopilotWorkerPrompt(run)).toContain("existing chat/code-builder loop")
    expect(autopilotWorkerPrompt(run)).toContain("Create a CRM")
  })

  test("transitions run state without losing the timeline", () => {
    const run = createAutopilotRun({
      runID: "run-3",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Fix tests",
      workspace: "/repo",
    })
    const paused = transitionAutopilotRun(run, "paused", "2026-05-22T10:05:00.000Z")

    expect(paused.status).toBe("paused")
    expect(paused.events).toHaveLength(run.events.length + 1)
    expect(paused.events.at(-1)).toMatchObject({ title: "Run paused" })
  })
})
