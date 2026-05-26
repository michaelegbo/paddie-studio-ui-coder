import { describe, expect, test } from "bun:test"
import {
  addAutopilotEvent,
  autopilotContextFromRun,
  autopilotGoalNeedsTemplate,
  autopilotGoalNeedsWorkflow,
  autopilotHandoffFromText,
  autopilotPhaseFromText,
  autopilotPhaseStatuses,
  autopilotTaskQueueFromText,
  autopilotTaskStatusMarkers,
  bindAutopilotSession,
  classifyAutopilotApproval,
  completeAutopilotRun,
  createAutopilotRun,
  extractAutopilotTasks,
  formatAutopilotModel,
  markAutopilotSubmitted,
  migrateAutopilotStore,
  nativePlannerPrompt,
  nativeVerificationPrompt,
  nativeWorkerPrompt,
  normalizeAutopilotGoal,
  normalizeAutopilotWorkspaces,
  selectedTemplateFromText,
  selectedWorkflowFromText,
  setAutopilotTaskStatuses,
  transitionAutopilotRun,
  updateAutopilotTaskQueue,
} from "./helpers"

describe("autopilot helpers", () => {
  test("normalizes goals and rejects empty input", () => {
    expect(normalizeAutopilotGoal("  build   a dashboard  ")).toBe("build a dashboard")
    expect(normalizeAutopilotGoal(" build   a dashboard \n\n test   it ")).toBe("build a dashboard\ntest it")
    expect(() => normalizeAutopilotGoal("  ")).toThrow("Autopilot goal")
  })

  test("extracts explicit task queues from multiline and semicolon goals", () => {
    expect(extractAutopilotTasks("1. Build app\n2. Test app\n- Preview app; Fix bugs")).toEqual([
      "Build app",
      "Test app",
      "Preview app",
      "Fix bugs",
    ])
    expect(extractAutopilotTasks("Convert to Angular and then convert back to React then compare both")).toEqual([
      "Convert to Angular",
      "convert back to React",
      "compare both",
    ])
  })

  test("creates a scoped native run with the selected agent and model", () => {
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
      runtime: "paddie-native",
      goal: "Build and test the landing page",
      workspace: "C:/repo/app",
      status: "running",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    })
    expect(run.plan.map((step) => step.id)).toEqual([
      "understand",
      "gather",
      "plan",
      "choose",
      "implement",
      "verify",
      "preview",
      "summarize",
    ])
    expect(run.plan.map((step) => step.owner)).toEqual([
      "autopilot",
      "paddie",
      "opencode",
      "paddie",
      "opencode",
      "opencode",
      "browser",
      "autopilot",
    ])
    expect(run.taskItems).toEqual([{ id: "task-1", title: "Build and test the landing page", status: "pending" }])
    expect(run.events.map((event) => event.source)).toEqual(["user", "paddie", "autopilot"])
  })

  test("formats model labels and native prompts", () => {
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
    expect(nativePlannerPrompt(run)).toContain("PADDIE_AUTOPILOT_PHASE: planning")
    expect(nativeWorkerPrompt(run)).toContain("Use the existing opencode file, edit, shell, task/subagent")
    expect(nativeVerificationPrompt(run)).toContain("PADDIE_AUTOPILOT_PHASE: verifying")
  })

  test("normalizes selected Autopilot workspaces", () => {
    expect(normalizeAutopilotWorkspaces("C:/repo/current", [])).toEqual(["C:/repo/current"])
    expect(
      normalizeAutopilotWorkspaces("C:/repo/current", [
        " C:/repo/current/ ",
        "C:/repo/other",
        "c:/repo/current",
      ]),
    ).toEqual(["C:/repo/current", "C:/repo/other"])
  })

  test("adds template and workflow catalogs to native prompts", () => {
    const run = autopilotContextFromRun(
      createAutopilotRun({
        runID: "run-resources",
        now: "2026-05-22T10:00:00.000Z",
        goal: "Build a workflow dashboard from a template",
        workspace: "/repo",
      }),
    )
    const prompt = nativeWorkerPrompt(run, {
      templates: [{ id: "tpl_1", name: "CRM", description: "Sales UI", stack: "react" }],
      templateAccess: "available",
      workflows: [{ id: "flow_1", name: "Lead intake", status: "active", nodeCount: 2, edgeCount: 1 }],
      workflowAccess: "available",
      selectedTemplate: {
        id: "tpl_1",
        name: "CRM",
        description: "Sales UI",
        stack: "react",
        files: [{ path: "src/App.tsx", content: "export function App() { return null }" }],
      },
      selectedWorkflow: {
        id: "flow_1",
        name: "Lead intake",
        status: "active",
        nodeCount: 2,
        edgeCount: 1,
        language: "javascript",
        code: "export async function runStudioFlow() {}",
        webhookUrl: "https://api.paddie.io/webhook",
        nodes: [{ id: "n1", type: "webhook", name: "Webhook" }],
        edges: [],
      },
    })

    expect(prompt).toContain("Paddie template catalog")
    expect(prompt).toContain("Selected Paddie template: CRM")
    expect(prompt).toContain("Selected Paddie workflow: Lead intake")
    expect(prompt).toContain("Generated javascript client code")
  })

  test("detects selected template and workflow markers", () => {
    expect(selectedTemplateFromText("PADDIE_TEMPLATE_ID: tpl_123\nPADDIE_TEMPLATE_NAME: Dashboard")).toEqual({
      id: "tpl_123",
      name: "Dashboard",
    })
    expect(selectedWorkflowFromText("PADDIE_WORKFLOW_ID: flow_123\nPADDIE_WORKFLOW_NAME: Intake")).toEqual({
      id: "flow_123",
      name: "Intake",
    })
  })

  test("maps native phase markers to planner statuses", () => {
    expect(autopilotPhaseFromText("PADDIE_AUTOPILOT_PHASE: executing")).toBe("executing")
    expect(autopilotPhaseStatuses("verifying")).toMatchObject({
      plan: "done",
      implement: "done",
      verify: "active",
    })
    expect(autopilotPhaseStatuses("previewing")).toMatchObject({
      preview: "active",
    })
  })

  test("parses planner task queues and worker task status markers", () => {
    expect(
      autopilotTaskQueueFromText(`
PADDIE_TASK_QUEUE:
1. Convert the app to Angular
2. Convert the result back to React
3. Compare both implementations in a report
PADDIE_TASK_QUEUE_END
`),
    ).toEqual([
      "Convert the app to Angular",
      "Convert the result back to React",
      "Compare both implementations in a report",
    ])
    const markers = autopilotTaskStatusMarkers("PADDIE_TASK_START: 2\nPADDIE_TASK_DONE: 1\nPADDIE_TASK_BLOCKED: 3 - needs approval")
    expect(markers.map((marker) => ({ index: marker.index, status: marker.status }))).toEqual([
      { index: 2, status: "active" },
      { index: 1, status: "done" },
      { index: 3, status: "blocked" },
    ])
    expect(markers[0]?.detail).toBeUndefined()
    expect(markers[1]?.detail).toBeUndefined()
    expect(markers[2]?.detail).toBe("needs approval")
  })

  test("updates task queues and task statuses without changing normal chat state", () => {
    const run = createAutopilotRun({
      runID: "run-tasks",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Build the site",
      workspace: "/repo",
    })
    const expanded = updateAutopilotTaskQueue(run, ["Choose template", "Implement pages", "Verify preview"], "2026-05-22T10:01:00.000Z")
    const active = setAutopilotTaskStatuses(expanded, { 1: "done", 2: "active" }, "2026-05-22T10:02:00.000Z")

    expect(expanded.tasks).toEqual(["Choose template", "Implement pages", "Verify preview"])
    expect(expanded.events.at(-1)).toMatchObject({ title: "Task plan expanded" })
    expect(active.taskItems?.map((task) => [task.title, task.status])).toEqual([
      ["Choose template", "done"],
      ["Implement pages", "active"],
      ["Verify preview", "pending"],
    ])
  })

  test("extracts worker handoff blocks for the final Autopilot summary", () => {
    expect(
      autopilotHandoffFromText(`noise
PADDIE_AUTOPILOT_HANDOFF:
Outcome: Done
Changed files: app.tsx`),
    ).toBe("Outcome: Done\nChanged files: app.tsx")
  })

  test("classifies approval-gated actions", () => {
    expect(classifyAutopilotApproval("git push origin dev")).toBe("approval-required")
    expect(classifyAutopilotApproval("bun test")).toBe("safe")
  })

  test("detects goals that need Studio resources", () => {
    expect(autopilotGoalNeedsTemplate("use one of my templates")).toBe(true)
    expect(autopilotGoalNeedsWorkflow("wire the workflow builder flow")).toBe(true)
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

  test("bounds event detail when timeline body is shortened", () => {
    const run = createAutopilotRun({
      runID: "run-detail",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Build a todo app",
      workspace: "/repo",
    })
    const detail = "Native worker stack\n".repeat(3_000)
    const withEvent = addAutopilotEvent(run, {
      id: "run-detail:opencode-error",
      source: "opencode",
      title: "Worker error",
      body: detail,
      at: "2026-05-22T10:01:00.000Z",
    })

    expect(withEvent.events.at(-1)?.body.length).toBeLessThan(detail.length)
    expect(withEvent.events.at(-1)?.detail?.length).toBeLessThan(detail.length)
    expect(withEvent.events.at(-1)?.detail).toContain("[Autopilot output truncated.]")
    expect(autopilotContextFromRun(withEvent).events.at(-1)).not.toHaveProperty("detail")
  })

  test("migrates stale running persisted runs into stopped sanitized runs", () => {
    const run = addAutopilotEvent(
      createAutopilotRun({
        runID: "run-stale",
        now: "2026-05-22T10:00:00.000Z",
        goal: "Build a todo app",
        workspace: "/repo",
      }),
      {
        id: "run-stale:large-detail",
        source: "opencode",
        title: "Large worker output",
        body: "x".repeat(40_000),
        detail: "x".repeat(40_000),
        at: "2026-05-22T10:01:00.000Z",
      },
    )
    const migrated = migrateAutopilotStore({
      currentRunID: "run-stale",
      current: run,
      runs: [run],
    }) as { current: typeof run; runs: Array<typeof run> }

    expect(migrated.current.status).toBe("stopped")
    expect(migrated.current.events.at(-1)?.title).toBe("Stale run restored as stopped")
    expect(migrated.current.events.find((event) => event.id === "run-stale:large-detail")?.detail?.length).toBeLessThan(40_000)
    expect(migrated.runs).toHaveLength(1)
  })

  test("marks submitted runs and binds the worker session without duplicate events", () => {
    const run = createAutopilotRun({
      runID: "run-4",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Build a todo app",
      workspace: "/repo",
    })
    const submitted = markAutopilotSubmitted(run, "2026-05-22T10:01:00.000Z")
    const bound = bindAutopilotSession(submitted, "session-1", "2026-05-22T10:02:00.000Z")
    const duplicate = bindAutopilotSession(bound, "session-1", "2026-05-22T10:03:00.000Z")

    expect(submitted.plan.map((step) => [step.id, step.status])).toEqual([
      ["understand", "done"],
      ["gather", "done"],
      ["plan", "active"],
      ["choose", "pending"],
      ["implement", "pending"],
      ["verify", "pending"],
      ["preview", "pending"],
      ["summarize", "pending"],
    ])
    expect(bound.sessionID).toBe("session-1")
    expect(duplicate.events).toHaveLength(bound.events.length)
    expect(autopilotContextFromRun(bound)).toMatchObject({
      runID: "run-4",
      sessionID: "session-1",
    })
  })

  test("hydrates legacy persisted runs before reading plan and task progress fields", () => {
    const run = createAutopilotRun({
      runID: "legacy-run",
      now: "2026-05-22T10:00:00.000Z",
      goal: "Build and test the app",
      workspace: "/repo",
    })
    const legacy = {
      ...run,
      tasks: undefined as unknown as typeof run.tasks,
      taskItems: undefined as unknown as typeof run.taskItems,
      plan: undefined as unknown as typeof run.plan,
      events: undefined as unknown as typeof run.events,
      safeguards: undefined as unknown as typeof run.safeguards,
    }

    const submitted = markAutopilotSubmitted(legacy, "2026-05-22T10:01:00.000Z")
    const context = autopilotContextFromRun(submitted)

    expect(submitted.plan).toHaveLength(8)
    expect(submitted.events.at(-1)).toMatchObject({ title: "Native worker prompt submitted" })
    expect(context.taskItems).toHaveLength(1)
    expect(context.safeguards.length).toBeGreaterThan(0)
  })

  test("marks a run complete from the worker outcome", () => {
    const completed = completeAutopilotRun(
      markAutopilotSubmitted(
        createAutopilotRun({
          runID: "run-5",
          now: "2026-05-22T10:00:00.000Z",
          goal: "Build a todo app",
          workspace: "/repo",
        }),
        "2026-05-22T10:01:00.000Z",
      ),
      "Implemented app.js and verified the local server.",
      "2026-05-22T10:05:00.000Z",
    )

    expect(completed.status).toBe("completed")
    expect(completed.plan.map((step) => [step.id, step.status])).toEqual([
      ["understand", "done"],
      ["gather", "done"],
      ["plan", "done"],
      ["choose", "done"],
      ["implement", "done"],
      ["verify", "done"],
      ["preview", "done"],
      ["summarize", "done"],
    ])
    expect(completed.events.at(-1)).toMatchObject({
      source: "autopilot",
      title: "Run completed",
    })
  })
})
