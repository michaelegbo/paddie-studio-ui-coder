export type AutopilotRunStatus = "running" | "paused" | "stopped"

export type AutopilotStepStatus = "pending" | "active" | "done" | "blocked"

export type AutopilotPlanStep = {
  id: string
  title: string
  description: string
  owner: "openclaw" | "opencode" | "paddie"
  status: AutopilotStepStatus
}

export type AutopilotEvent = {
  id: string
  source: "user" | "openclaw" | "opencode" | "paddie" | "browser" | "system"
  title: string
  body: string
  at: string
}

export type AutopilotModelSelection = {
  providerID: string
  modelID: string
  variant?: string
}

export type AutopilotContextPayload = {
  runID: string
  goal: string
  workspace: string
  status: AutopilotRunStatus
  agent?: string
  model?: AutopilotModelSelection
  plan: AutopilotPlanStep[]
  events: AutopilotEvent[]
  safeguards: string[]
}

export type AutopilotRun = AutopilotContextPayload & {
  createdAt: string
  updatedAt: string
}

export type CreateAutopilotRunInput = {
  goal: string
  workspace: string
  agent?: string
  model?: AutopilotModelSelection
  runID?: string
  now?: string
}

const MAX_GOAL = 4_000
const MAX_EVENT_BODY = 1_500

const fallbackSafeguards = [
  "Keep Autopilot isolated from normal chat unless the user attaches or submits an Autopilot context item.",
  "Route implementation work through the existing Paddie/opencode chat and code-builder path.",
  "Ask before destructive file, git, credential, publishing, or external-service actions.",
  "Run available tests, preview the app when possible, and feed results back into the same run timeline.",
  "Preserve upstream-safe boundaries by adding adapters and UI surfaces instead of rewriting core OpenCode flows.",
]

export function normalizeAutopilotGoal(value: string) {
  const goal = value.replace(/\s+/g, " ").trim()
  if (!goal) throw new Error("Enter an Autopilot goal.")
  if (goal.length <= MAX_GOAL) return goal
  return `${goal.slice(0, MAX_GOAL)}...`
}

export function formatAutopilotModel(model: AutopilotModelSelection | undefined) {
  if (!model) return "No model selected"
  const base = `${model.providerID}/${model.modelID}`
  return model.variant ? `${base} (${model.variant})` : base
}

export function createAutopilotRun(input: CreateAutopilotRunInput): AutopilotRun {
  const goal = normalizeAutopilotGoal(input.goal)
  const now = input.now ?? new Date().toISOString()
  const runID = input.runID ?? `autopilot-${Date.now().toString(36)}`
  const plan = [
    {
      id: "understand",
      title: "Understand the request",
      description: "Capture the user's goal, workspace, selected model, constraints, and approval boundaries.",
      owner: "openclaw",
      status: "active",
    },
    {
      id: "handoff",
      title: "Handoff to Paddie chat",
      description: "Send a scoped worker task through the existing Paddie/opencode chat and code-builder path.",
      owner: "paddie",
      status: "pending",
    },
    {
      id: "implement",
      title: "Implement changes",
      description: "Let the code worker edit files inside the selected project while reporting progress back to Autopilot.",
      owner: "opencode",
      status: "pending",
    },
    {
      id: "verify",
      title: "Verify in loop",
      description: "Run typechecks, tests, and browser preview checks when available, then iterate on failures.",
      owner: "opencode",
      status: "pending",
    },
    {
      id: "summarize",
      title: "Summarize outcome",
      description: "Return changed files, test results, residual risks, and next recommended actions.",
      owner: "openclaw",
      status: "pending",
    },
  ] satisfies AutopilotPlanStep[]

  return {
    runID,
    goal,
    workspace: input.workspace,
    status: "running",
    agent: input.agent,
    model: input.model,
    plan,
    events: [
      {
        id: `${runID}:goal`,
        source: "user",
        title: "Goal accepted",
        body: goal,
        at: now,
      },
      {
        id: `${runID}:model`,
        source: "paddie",
        title: "Model selection captured",
        body: `${input.agent ? `Agent ${input.agent}` : "Current agent"} using ${formatAutopilotModel(input.model)}.`,
        at: now,
      },
      {
        id: `${runID}:handoff`,
        source: "system",
        title: "Scoped chat handoff prepared",
        body: "Autopilot will use transient chat context so normal chats and the existing code builder stay unchanged.",
        at: now,
      },
    ],
    safeguards: fallbackSafeguards,
    createdAt: now,
    updatedAt: now,
  }
}

export function transitionAutopilotRun(run: AutopilotRun, status: AutopilotRunStatus, now = new Date().toISOString()) {
  return addAutopilotEvent(
    {
      ...run,
      status,
      updatedAt: now,
    },
    {
      source: "system",
      title: status === "paused" ? "Run paused" : status === "stopped" ? "Run stopped" : "Run resumed",
      body:
        status === "running"
          ? "Autopilot can continue coordinating through the existing chat/code-builder path."
          : "No worker prompt was sent by this status change.",
      at: now,
    },
  )
}

export function addAutopilotEvent(
  run: AutopilotRun,
  event: Omit<AutopilotEvent, "id"> & { id?: string },
): AutopilotRun {
  const body = event.body.length <= MAX_EVENT_BODY ? event.body : `${event.body.slice(0, MAX_EVENT_BODY)}...`
  return {
    ...run,
    updatedAt: event.at,
    events: [
      ...run.events,
      {
        id: event.id ?? `${run.runID}:event-${run.events.length + 1}`,
        source: event.source,
        title: event.title,
        body,
        at: event.at,
      },
    ],
  }
}

export function autopilotContextFromRun(run: AutopilotRun): AutopilotContextPayload {
  return {
    runID: run.runID,
    goal: run.goal,
    workspace: run.workspace,
    status: run.status,
    agent: run.agent,
    model: run.model ? { ...run.model } : undefined,
    plan: run.plan.map((step) => ({ ...step })),
    events: run.events.slice(-8).map((event) => ({ ...event })),
    safeguards: run.safeguards.slice(),
  }
}

export function autopilotWorkerPrompt(run: AutopilotContextPayload) {
  return [
    "Start this Paddie Studio Autopilot run.",
    "",
    `Goal: ${run.goal}`,
    `Workspace: ${run.workspace}`,
    `Model: ${formatAutopilotModel(run.model)}`,
    "",
    "Work through the existing chat/code-builder loop. Plan, edit, test, preview when available, iterate on failures, and report progress or blockers back in this session.",
  ].join("\n")
}
