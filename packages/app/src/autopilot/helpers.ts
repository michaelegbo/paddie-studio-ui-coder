import { dataGoalNeedsPaddieSkill, paddieDataSkillInstruction } from "@/paddie-data/helpers"

export type AutopilotRunStatus = "running" | "paused" | "stopped" | "completed"

export type AutopilotStepStatus = "pending" | "active" | "done" | "blocked"

export type AutopilotTaskStatus = "pending" | "active" | "done" | "blocked"

export type AutopilotPhase = "planning" | "gathering" | "choosing" | "executing" | "verifying" | "previewing" | "summarizing"

export type AutopilotTaskItem = {
  id: string
  title: string
  status: AutopilotTaskStatus
}

export type AutopilotPlanStep = {
  id: "understand" | "gather" | "plan" | "choose" | "implement" | "verify" | "preview" | "summarize"
  title: string
  description: string
  owner: "autopilot" | "opencode" | "paddie" | "template" | "workflow" | "browser"
  status: AutopilotStepStatus
}

export type AutopilotEvent = {
  id: string
  source: "user" | "autopilot" | "opencode" | "paddie" | "template" | "workflow" | "browser" | "system"
  title: string
  body: string
  detail?: string
  at: string
}

export type AutopilotModelSelection = {
  providerID: string
  modelID: string
  variant?: string
}

export type AutopilotTemplateSummary = {
  id: string
  name: string
  description?: string
  stack?: string
  tier?: string
  tags?: string[]
  parts?: string[]
}

export type AutopilotTemplateContext = AutopilotTemplateSummary & {
  files: Array<{
    path: string
    content: string
    encoding?: "base64"
  }>
}

export type AutopilotWorkflowSummary = {
  id: string
  name: string
  description?: string
  status: string
  method?: string
  nodeCount: number
  edgeCount: number
}

export type AutopilotWorkflowContext = AutopilotWorkflowSummary & {
  language: "javascript" | "python"
  code: string
  webhookUrl: string
  nodes: Array<{
    id: string
    type: string
    name: string
    config?: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    condition?: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

export type AutopilotResourceInput = {
  templates?: AutopilotTemplateSummary[]
  templateAccess?: "available" | "logged-out" | "unavailable"
  templateError?: string
  selectedTemplate?: AutopilotTemplateContext
  workflows?: AutopilotWorkflowSummary[]
  workflowAccess?: "available" | "logged-out" | "unavailable"
  workflowError?: string
  selectedWorkflow?: AutopilotWorkflowContext
  plannerOutput?: string
}

export type AutopilotTemplateSelectionStatus =
  | "suggesting"
  | "chosen"
  | "applying"
  | "applied"
  | "skipped"

export type AutopilotTemplateSelection = {
  status: AutopilotTemplateSelectionStatus
  id?: string
  name?: string
  stack?: string
  tier?: string
  decidedBy?: "user" | "autopilot" | "planner"
  candidates?: AutopilotTemplateSummary[]
}

export type AutopilotContextPayload = {
  runID: string
  sessionID?: string
  runtime?: "paddie-native"
  goal: string
  tasks?: string[]
  taskItems?: AutopilotTaskItem[]
  workspace: string
  status: AutopilotRunStatus
  agent?: string
  model?: AutopilotModelSelection
  plan: AutopilotPlanStep[]
  events: AutopilotEvent[]
  safeguards: string[]
  templateSelection?: AutopilotTemplateSelection
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
  sessionID?: string
  runID?: string
  now?: string
}

export type AutopilotQueueItem = {
  id: string
  goal: string
  workspaces: string[]
  agent?: string
  model?: AutopilotModelSelection
  queuedAt: string
}

export type CreateAutopilotQueueItemInput = {
  goal: string
  workspaces: string[]
  agent?: string
  model?: AutopilotModelSelection
  id?: string
  now?: string
}

const MAX_GOAL = 4_000
const MAX_EVENT_BODY = 1_500
const MAX_EVENT_DETAIL = 24_000
const MAX_AUTOPILOT_EVENTS = 160
const MAX_RESTORED_RUNNING_AGE = 30 * 60 * 1000
const MAX_TEMPLATE_CATALOG = 30
const MAX_WORKFLOW_CATALOG = 20
const MAX_RESOURCE_FILE = 24_000
const MAX_RESOURCE_TOTAL = 90_000
const MAX_PLANNER_OUTPUT_CONTEXT = 12_000
const MAX_WORKFLOW_CODE_CONTEXT = 16_000
const MAX_WORKFLOW_GRAPH_CONTEXT = 16_000
const MAX_AUTOPILOT_TASKS = 20
const MAX_AUTOPILOT_WORKSPACES = 8
const MAX_AUTOPILOT_QUEUE = 50

const fallbackSafeguards = [
  "Autopilot runs in its own scoped opencode session and does not type into or submit the normal chat composer.",
  "Use the currently selected Paddie/opencode provider, model, agent, and variant.",
  "Ask before destructive file, git, credential, publishing, payment, external-message, or deploy actions.",
  "Run available tests, typechecks, builds, and preview checks, then feed failures back into the same run.",
  "Preserve upstream-safe boundaries by using Paddie-owned adapters around opencode sessions and tools.",
]

export function normalizeAutopilotGoal(value: string) {
  const goal = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
  if (!goal) throw new Error("Enter an Autopilot goal.")
  if (goal.length <= MAX_GOAL) return goal
  return `${goal.slice(0, MAX_GOAL)}...`
}

export function extractAutopilotTasks(goal: string) {
  const explicitTasks = goal
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed) return []
      const withoutPrefix = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, "").trim()
      return withoutPrefix
        .split(/\s*(?:;|\band then\b|\bthen\b)\s*/i)
        .filter(Boolean)
    })
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)

  return (explicitTasks.length ? explicitTasks : [goal]).slice(0, MAX_AUTOPILOT_TASKS)
}

export function createAutopilotTaskItems(tasks: string[], statuses?: Record<number, AutopilotTaskStatus>) {
  return tasks.slice(0, MAX_AUTOPILOT_TASKS).map((task, index) => ({
    id: `task-${index + 1}`,
    title: task,
    status: statuses?.[index + 1] ?? "pending",
  }))
}

export function formatAutopilotModel(model: AutopilotModelSelection | undefined) {
  if (!model) return "No model selected"
  const base = `${model.providerID}/${model.modelID}`
  return model.variant ? `${base} (${model.variant})` : base
}

export function normalizeAutopilotWorkspaces(current: string, input: string[]) {
  const workspaces = input
    .map((workspace) => workspace.trim().replace(/[\\/]+$/g, ""))
    .filter(Boolean)
    .filter((workspace, index, list) => list.findIndex((item) => item.toLowerCase() === workspace.toLowerCase()) === index)
    .slice(0, MAX_AUTOPILOT_WORKSPACES)
  return workspaces.length ? workspaces : [current.trim().replace(/[\\/]+$/g, "")]
}

export function createAutopilotRun(input: CreateAutopilotRunInput): AutopilotRun {
  const goal = normalizeAutopilotGoal(input.goal)
  const tasks = extractAutopilotTasks(goal)
  const now = input.now ?? new Date().toISOString()
  const runID = input.runID ?? `autopilot-${Date.now().toString(36)}`

  const events: AutopilotEvent[] = [
    {
      id: `${runID}:goal`,
      source: "user",
      title: "Goal accepted",
      body: "Captured.",
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
      id: `${runID}:runtime`,
      source: "autopilot",
      title: "Paddie Native runtime prepared",
      body: "Autopilot will create a scoped opencode worker session and keep normal chat isolated.",
      at: now,
    },
    ...(
      tasks.length > 1
        ? [
            {
              id: `${runID}:tasks`,
              source: "autopilot" as const,
              title: "Task queue captured",
              body: tasks.map((task, index) => `${index + 1}. ${task}`).join("\n"),
              at: now,
            },
          ]
        : []
    ),
  ]

  return {
    runID,
    sessionID: input.sessionID,
    runtime: "paddie-native",
    goal,
    tasks,
    taskItems: createAutopilotTaskItems(tasks),
    workspace: input.workspace,
    status: "running",
    agent: input.agent,
    model: input.model,
    plan: createNativeAutopilotPlan(),
    events: events.map(sanitizeAutopilotEvent),
    safeguards: fallbackSafeguards,
    createdAt: now,
    updatedAt: now,
  }
}

export function createAutopilotQueueItem(input: CreateAutopilotQueueItemInput): AutopilotQueueItem {
  const goal = normalizeAutopilotGoal(input.goal)
  const workspaces = normalizeAutopilotWorkspaces(input.workspaces[0] ?? "", input.workspaces)
  if (!workspaces.length) throw new Error("Pick at least one workspace before queueing the task.")
  const now = input.now ?? new Date().toISOString()
  const id = input.id ?? `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    goal,
    workspaces,
    agent: input.agent,
    model: input.model ? { ...input.model } : undefined,
    queuedAt: now,
  }
}

function sanitizeAutopilotQueueItem(item: unknown): AutopilotQueueItem | undefined {
  if (!isRecord(item)) return undefined
  if (typeof item.goal !== "string") return undefined
  const goal = item.goal.trim()
  if (!goal) return undefined
  const workspaces = Array.isArray(item.workspaces)
    ? item.workspaces.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []
  if (!workspaces.length) return undefined
  const modelValue = isRecord(item.model)
    && typeof item.model.providerID === "string"
    && typeof item.model.modelID === "string"
    ? {
        providerID: item.model.providerID,
        modelID: item.model.modelID,
        variant: typeof item.model.variant === "string" ? item.model.variant : undefined,
      }
    : undefined
  return {
    id: typeof item.id === "string" && item.id ? item.id : `queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    goal: goal.slice(0, MAX_GOAL),
    workspaces,
    agent: typeof item.agent === "string" ? item.agent : undefined,
    model: modelValue,
    queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : new Date().toISOString(),
  }
}

export function sanitizeAutopilotQueue(value: unknown): AutopilotQueueItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: AutopilotQueueItem[] = []
  for (const raw of value) {
    if (result.length >= MAX_AUTOPILOT_QUEUE) break
    const sanitized = sanitizeAutopilotQueueItem(raw)
    if (!sanitized || seen.has(sanitized.id)) continue
    seen.add(sanitized.id)
    result.push(sanitized)
  }
  return result
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
      title:
        status === "paused"
          ? "Run paused"
          : status === "stopped"
            ? "Run stopped"
            : status === "completed"
              ? "Run completed"
              : "Run resumed",
      body:
        status === "completed"
          ? "Autopilot marked the native worker run complete."
          : status === "running"
            ? "Autopilot can continue before the next native worker step."
            : "Autopilot will not start another step until the status changes.",
      at: now,
    },
  )
}

export function setAutopilotPlanStatuses(
  run: AutopilotRun,
  statuses: Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>>,
) {
  const plan = autopilotPlanFromRun(run)
  let changed = !Array.isArray(run.plan) || run.plan !== plan
  const nextPlan = plan.map((step) => {
    const status = statuses[step.id]
    if (!status || status === step.status) return step
    changed = true
    return { ...step, status }
  })
  if (!changed) return run
  return {
    ...run,
    plan: nextPlan,
  }
}

export function markAutopilotSubmitted(run: AutopilotRun, now = new Date().toISOString()) {
  return addAutopilotEvent(
    setAutopilotPlanStatuses(run, {
      understand: "done",
      gather: "done",
      plan: "active",
    }),
    {
      id: `${run.runID}:submitted`,
      source: "opencode",
      title: "Native worker prompt submitted",
      body: "Autopilot submitted a scoped prompt to its dedicated opencode worker session.",
      at: now,
    },
  )
}

export function completeAutopilotRun(run: AutopilotRun, summary: string, now = new Date().toISOString()) {
  const taskItems = autopilotTaskItemsFromRun(run).map((task) => ({
    ...task,
    status: task.status === "blocked" ? task.status : ("done" as const),
  }))
  return addAutopilotEvent(
    {
      ...setAutopilotPlanStatuses(run, {
        understand: "done",
        gather: "done",
        plan: "done",
        choose: "done",
        implement: "done",
        verify: "done",
        preview: "done",
        summarize: "done",
      }),
      taskItems,
      tasks: taskItems.map((task) => task.title),
      status: "completed",
      updatedAt: now,
    },
    {
      id: `${run.runID}:completed`,
      source: "autopilot",
      title: "Run completed",
      body: summary || "The native opencode worker completed. Review the activity output for changed files and checks.",
      at: now,
    },
  )
}

export function updateAutopilotTaskQueue(run: AutopilotRun, tasks: string[], now = new Date().toISOString()) {
  const nextTasks = tasks
    .map((task) => task.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((task, index, list) => list.findIndex((other) => other.toLowerCase() === task.toLowerCase()) === index)
    .slice(0, MAX_AUTOPILOT_TASKS)
  if (!nextTasks.length) return run
  if ((Array.isArray(run.tasks) ? run.tasks : []).join("\n") === nextTasks.join("\n")) return run
  const taskItems = createAutopilotTaskItems(nextTasks)
  return addAutopilotEvent(
    {
      ...run,
      tasks: nextTasks,
      taskItems,
      updatedAt: now,
    },
    {
      id: `${run.runID}:task-queue-expanded`,
      source: "autopilot",
      title: "Task plan expanded",
      body: taskItems.map((task, index) => `${index + 1}. ${task.title}`).join("\n"),
      at: now,
    },
  )
}

export function setAutopilotTaskStatuses(
  run: AutopilotRun,
  statuses: Record<number, AutopilotTaskStatus>,
  now = new Date().toISOString(),
) {
  const taskItems = autopilotTaskItemsFromRun(run)
  let changed = !Array.isArray(run.taskItems) || run.taskItems !== taskItems
  const next = taskItems.map((task, index) => {
    const status = statuses[index + 1]
    if (!status || status === task.status) return task
    changed = true
    return { ...task, status }
  })
  if (!changed) return run
  return {
    ...run,
    tasks: next.map((task) => task.title),
    taskItems: next,
    updatedAt: now,
  }
}

export function setAutopilotTemplateSelection(
  run: AutopilotRun,
  selection: AutopilotTemplateSelection | undefined,
  now = new Date().toISOString(),
): AutopilotRun {
  const current = run.templateSelection
  if (!selection && !current) return run
  if (selection && current && templateSelectionEqual(current, selection)) return run
  return {
    ...run,
    templateSelection: selection ? { ...selection } : undefined,
    updatedAt: now,
  }
}

function templateSelectionEqual(a: AutopilotTemplateSelection, b: AutopilotTemplateSelection) {
  if (a.status !== b.status) return false
  if (a.id !== b.id) return false
  if (a.name !== b.name) return false
  if (a.stack !== b.stack) return false
  if (a.tier !== b.tier) return false
  if (a.decidedBy !== b.decidedBy) return false
  const aIDs = (a.candidates ?? []).map((item) => item.id).join("|")
  const bIDs = (b.candidates ?? []).map((item) => item.id).join("|")
  return aIDs === bIDs
}

export function bindAutopilotSession(run: AutopilotRun, sessionID: string, now = new Date().toISOString()) {
  if (run.sessionID === sessionID) return run
  return addAutopilotEvent(
    {
      ...run,
      sessionID,
    },
    {
      id: `${run.runID}:session:${sessionID}`,
      source: "paddie",
      title: "Worker session created",
      body: `Autopilot is using scoped opencode session ${sessionID}.`,
      at: now,
    },
  )
}

export function addAutopilotEvent(
  run: AutopilotRun,
  event: Omit<AutopilotEvent, "id"> & { id?: string },
): AutopilotRun {
  if (event.id && Array.isArray(run.events) && run.events.some((item) => item.id === event.id)) {
    return run
  }
  const events = autopilotEventsFromRun(run)
  if (event.id && events.some((item) => item.id === event.id)) {
    if (events === run.events) return run
    return { ...run, events }
  }
  const body = truncateAutopilotText(event.body, MAX_EVENT_BODY)
  return {
    ...run,
    updatedAt: event.at,
    events: trimAutopilotEvents([
      ...events,
      sanitizeAutopilotEvent({
        id: event.id ?? `${run.runID}:event-${events.length + 1}`,
        source: event.source,
        title: event.title,
        body,
        detail: event.detail ?? event.body,
        at: event.at,
      }),
    ]),
  }
}

export function migrateAutopilotStore(value: unknown) {
  if (!isRecord(value)) return value
  const now = new Date().toISOString()
  const current = isRecord(value.current) ? sanitizeRestoredAutopilotRun(value.current as unknown as AutopilotRun, now) : undefined
  const runs = Array.isArray(value.runs)
    ? value.runs.flatMap((item) => isRecord(item) ? [sanitizeRestoredAutopilotRun(item as unknown as AutopilotRun, now)] : [])
    : []
  const normalized = dedupeAutopilotRuns(runs.length ? runs : current ? [current] : [])
  const currentRunID = typeof value.currentRunID === "string" ? value.currentRunID : current?.runID ?? normalized[0]?.runID
  const selected = normalized.find((item) => item.runID === currentRunID) ?? current ?? normalized[0]
  const queue = sanitizeAutopilotQueue(value.queue)
  const queuePaused = typeof value.queuePaused === "boolean" ? value.queuePaused : false
  return {
    ...value,
    current: selected,
    currentRunID: selected?.runID,
    runs: normalized,
    queue,
    queuePaused,
  }
}

export function autopilotContextFromRun(run: AutopilotRun): AutopilotContextPayload {
  return {
    runID: run.runID,
    sessionID: run.sessionID,
    runtime: run.runtime,
    goal: run.goal,
    tasks: autopilotTaskItemsFromRun(run).map((task) => task.title),
    taskItems: autopilotTaskItemsFromRun(run).map((task) => ({ ...task })),
    workspace: run.workspace,
    status: run.status,
    agent: run.agent,
    model: run.model ? { ...run.model } : undefined,
    plan: autopilotPlanFromRun(run).map((step) => ({ ...step })),
    events: autopilotEventsFromRun(run).slice(-8).map((event) => ({
      id: event.id,
      source: event.source,
      title: event.title,
      body: event.body,
      at: event.at,
    })),
    safeguards: autopilotSafeguardsFromRun(run).slice(),
    templateSelection: run.templateSelection ? { ...run.templateSelection } : undefined,
  }
}

export function nativePlannerPrompt(run: AutopilotContextPayload, input?: AutopilotResourceInput) {
  return [
    "PADDIE_AUTOPILOT_PHASE: planning",
    "",
    "You are the planning pass for Paddie Native Autopilot.",
    "Use opencode's normal tools and permissions. Do not edit files in this pass unless required only to inspect safe metadata.",
    "",
    runHeader(run),
    "",
    "Return a concise ordered plan covering every task item, the project state you need to inspect, what templates or workflows should be used, and what verification/preview commands should run.",
    "If the goal is broad or combines several deliverables, break it into a concrete task queue and include this exact block:",
    "PADDIE_TASK_QUEUE:",
    "1. <first task>",
    "2. <second task>",
    "PADDIE_TASK_QUEUE_END",
    "If you choose a Paddie template, include exactly: PADDIE_TEMPLATE_ID: <id> and PADDIE_TEMPLATE_NAME: <name>.",
    "If you choose a Paddie workflow, include exactly: PADDIE_WORKFLOW_ID: <id> and PADDIE_WORKFLOW_NAME: <name>.",
    autopilotGoalNeedsData(run.goal) ? paddieDataSkillInstruction() : "",
    "",
    resourceCatalog(input),
  ]
    .filter(Boolean)
    .join("\n")
}

export function nativeWorkerPrompt(run: AutopilotContextPayload, input?: AutopilotResourceInput) {
  return [
    "PADDIE_AUTOPILOT_PHASE: executing",
    "",
    "Execute this Paddie Native Autopilot run inside the selected workspace.",
    "",
    runHeader(run),
    "",
    "Execution contract:",
    "- Treat the task queue as one run. Complete every listed item unless a safety boundary blocks it.",
    "- Before working on a task, emit PADDIE_TASK_START: <number>. When that task is complete, emit PADDIE_TASK_DONE: <number>. If blocked, emit PADDIE_TASK_BLOCKED: <number> - <reason>.",
    "- Use the existing opencode file, edit, shell, task/subagent, permission, and status systems.",
    "- Inspect the existing project before changing it; support blank projects and existing connected projects.",
    "- Select and adapt Paddie templates/workflows when useful or requested.",
    autopilotGoalNeedsData(run.goal) ? `- ${paddieDataSkillInstruction()}` : "",
    "- Run available install, test, typecheck, build, and lint commands when appropriate.",
    "- Detect or start a local preview when relevant, inspect browser/runtime errors when possible, and fix failures.",
    "- Ask before destructive file actions, git push/release/deploy, credential use, payments, external messages, or publishing.",
    "- Do not change normal chat behavior or unrelated sessions.",
    "",
    phaseInstructions(),
    "",
    input?.plannerOutput ? `Planner output:\n${truncateAutopilotText(input.plannerOutput, MAX_PLANNER_OUTPUT_CONTEXT)}` : "",
    "",
    resourceContext(input),
  ]
    .filter(Boolean)
    .join("\n")
}

export function nativeVerificationPrompt(run: AutopilotContextPayload) {
  return [
    "PADDIE_AUTOPILOT_PHASE: verifying",
    "",
    "Finish the Autopilot verification loop for this run.",
    "",
    runHeader(run),
    "",
    "Run the checks that fit this workspace: dependency install if needed, tests, typecheck, lint, build, static syntax checks, and a local preview/browser sanity check for UI work.",
    "If a check fails, fix the issue and rerun the focused check. Keep iterating until checks pass, the task is blocked by an approval boundary, or no reasonable automated check exists.",
    "",
    "When done, emit PADDIE_AUTOPILOT_PHASE: summarizing and summarize changed files, commands run, verification results, preview URL or screenshot notes if available, artifacts, and remaining risks.",
    "End with a handoff block that Autopilot can show to the user:",
    "PADDIE_AUTOPILOT_HANDOFF:",
    "Outcome: <what changed and whether the run completed>",
    "Changed files: <files or none>",
    "Commands/checks: <commands and pass/fail results>",
    "Preview: <URL/screenshot notes or not applicable>",
    "Remaining risks: <risks or none>",
  ].join("\n")
}

export function autopilotWorkerPrompt(run: AutopilotContextPayload) {
  return nativeWorkerPrompt(run)
}

export function autopilotGoalNeedsTemplate(goal: string) {
  return /\b(template|templates|theme|starter|clone|style|design reference|inspiration)\b/i.test(goal)
}

export type AutopilotTemplateMatch = {
  template: AutopilotTemplateSummary
  score: number
  reasons: string[]
}

const TEMPLATE_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "build",
  "create",
  "make",
  "add",
  "use",
  "using",
  "template",
  "templates",
  "starter",
  "theme",
  "design",
  "based",
  "inspired",
  "like",
  "clone",
  "reference",
  "inspiration",
  "style",
])

function tokenizeAutopilotGoal(goal: string) {
  const tokens = new Set<string>()
  for (const raw of goal.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (TEMPLATE_TOKEN_STOPWORDS.has(raw)) continue
    tokens.add(raw)
  }
  return tokens
}

function matchTextTokens(text: string | undefined, tokens: Set<string>) {
  if (!text) return [] as string[]
  const lower = text.toLowerCase()
  const matched: string[] = []
  for (const token of tokens) {
    if (lower.includes(token)) matched.push(token)
  }
  return matched
}

export function matchAutopilotTemplates(
  goal: string,
  templates: AutopilotTemplateSummary[],
  limit = 3,
): AutopilotTemplateMatch[] {
  const tokens = tokenizeAutopilotGoal(goal)
  if (!tokens.size || !templates.length) return []
  const tagText = (template: AutopilotTemplateSummary) => template.tags?.join(" ") ?? ""
  const partsText = (template: AutopilotTemplateSummary) => template.parts?.join(" ") ?? ""

  return templates
    .map((template): AutopilotTemplateMatch => {
      const reasons: string[] = []
      let score = 0

      const nameMatches = matchTextTokens(template.name, tokens)
      if (nameMatches.length) {
        score += nameMatches.length * 3
        reasons.push(`name: ${nameMatches.join(", ")}`)
      }

      const descMatches = matchTextTokens(template.description, tokens)
      if (descMatches.length) {
        score += descMatches.length * 2
        reasons.push(`description: ${descMatches.join(", ")}`)
      }

      const tagMatches = matchTextTokens(tagText(template), tokens)
      if (tagMatches.length) {
        score += tagMatches.length * 2
        reasons.push(`tags: ${tagMatches.join(", ")}`)
      }

      const partsMatches = matchTextTokens(partsText(template), tokens)
      if (partsMatches.length) {
        score += partsMatches.length
        reasons.push(`parts: ${partsMatches.join(", ")}`)
      }

      if (template.stack && tokens.has(template.stack.toLowerCase())) {
        score += 1
        reasons.push(`stack: ${template.stack}`)
      }

      return { template, score, reasons }
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
    .slice(0, limit)
}

export function autopilotGoalNeedsWorkflow(goal: string) {
  return /\b(workflow|workflows|automation|webhook|flow builder|workflow builder)\b/i.test(goal)
}

export function autopilotGoalNeedsData(goal: string) {
  return dataGoalNeedsPaddieSkill(goal)
}

export function selectedTemplateFromText(value: string) {
  const id = value.match(/PADDIE_TEMPLATE_ID:\s*([^\s]+)/i)?.[1]
  const name = value.match(/PADDIE_TEMPLATE_NAME:\s*(.+)/i)?.[1]?.trim()
  if (!id) return
  return { id, name }
}

export function selectedWorkflowFromText(value: string) {
  const id = value.match(/PADDIE_WORKFLOW_ID:\s*([^\s]+)/i)?.[1]
  const name = value.match(/PADDIE_WORKFLOW_NAME:\s*(.+)/i)?.[1]?.trim()
  if (!id) return
  return { id, name }
}

export function autopilotPhaseFromText(value: string): AutopilotPhase | undefined {
  const phase = value
    .match(/PADDIE_AUTOPILOT_PHASE:\s*(planning|gathering|choosing|executing|verifying|previewing|summarizing)/i)?.[1]
    ?.toLowerCase()
  if (
    phase === "planning" ||
    phase === "gathering" ||
    phase === "choosing" ||
    phase === "executing" ||
    phase === "verifying" ||
    phase === "previewing" ||
    phase === "summarizing"
  ) {
    return phase
  }
}

export function autopilotTaskQueueFromText(value: string) {
  const block = value.match(/PADDIE_TASK_QUEUE:\s*([\s\S]*?)\s*PADDIE_TASK_QUEUE_END/i)?.[1]
  if (!block) return []
  return extractAutopilotTasks(block)
}

export function autopilotTaskStatusMarkers(value: string) {
  return Array.from(value.matchAll(/PADDIE_TASK_(START|DONE|BLOCKED):\s*(\d+)(?:\s*[-:]\s*(.*))?/gi)).flatMap((match) => {
    const index = Number(match[2])
    if (!Number.isFinite(index) || index < 1) return []
    return [
      {
        index,
        status: match[1]?.toLowerCase() === "done" ? "done" as const : match[1]?.toLowerCase() === "blocked" ? "blocked" as const : "active" as const,
        detail: match[3]?.trim(),
      },
    ]
  })
}

export function autopilotHandoffFromText(value: string) {
  const block = value.match(/PADDIE_AUTOPILOT_HANDOFF:\s*([\s\S]*)/i)?.[1]?.trim()
  if (block) return block
  return value.trim()
}

const HANDOFF_MARKER = /PADDIE_AUTOPILOT_HANDOFF:/i

export function autopilotHasHandoff(value: string) {
  return HANDOFF_MARKER.test(value)
}

export function autopilotPhaseStatuses(phase: AutopilotPhase): Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>> {
  if (phase === "planning") return { understand: "done", gather: "active", plan: "active" }
  if (phase === "gathering") return { understand: "done", gather: "active", plan: "pending" }
  if (phase === "choosing") return { understand: "done", gather: "done", plan: "done", choose: "active" }
  if (phase === "executing") {
    return { understand: "done", gather: "done", plan: "done", choose: "done", implement: "active" }
  }
  if (phase === "verifying") {
    return { understand: "done", gather: "done", plan: "done", choose: "done", implement: "done", verify: "active" }
  }
  if (phase === "previewing") {
    return {
      understand: "done",
      gather: "done",
      plan: "done",
      choose: "done",
      implement: "done",
      verify: "active",
      preview: "active",
    }
  }
  return {
    understand: "done",
    gather: "done",
    plan: "done",
    choose: "done",
    implement: "done",
    verify: "done",
    preview: "done",
    summarize: "active",
  }
}

export function classifyAutopilotApproval(value: string) {
  if (/\b(git\s+push|release|publish|deploy|payment|charge|credential|secret|api key|delete\s+-rf|remove-item\s+-recurse)\b/i.test(value)) {
    return "approval-required"
  }
  return "safe"
}

export function createNativeAutopilotPlan(): AutopilotPlanStep[] {
  return [
    {
      id: "understand",
      title: "Understand request",
      description: "Capture goal, workspace, selected model, task queue, and approval boundaries.",
      owner: "autopilot",
      status: "active",
    },
    {
      id: "gather",
      title: "Gather context",
      description: "Inspect workspace metadata, files, scripts, templates, workflows, and existing project state.",
      owner: "paddie",
      status: "pending",
    },
    {
      id: "plan",
      title: "Plan task queue",
      description: "Ask the native opencode worker to produce an ordered plan before implementation.",
      owner: "opencode",
      status: "pending",
    },
    {
      id: "choose",
      title: "Choose tools",
      description: "Choose template, workflow, code, command, and preview actions from the available Paddie tools.",
      owner: "paddie",
      status: "pending",
    },
    {
      id: "implement",
      title: "Implement through opencode",
      description: "Let the scoped worker inspect, edit, and build inside the selected project.",
      owner: "opencode",
      status: "pending",
    },
    {
      id: "verify",
      title: "Verify in loop",
      description: "Run install/test/typecheck/build/dev commands and iterate on failures.",
      owner: "opencode",
      status: "pending",
    },
    {
      id: "preview",
      title: "Preview and inspect",
      description: "Detect local preview URLs and perform browser/runtime sanity checks when available.",
      owner: "browser",
      status: "pending",
    },
    {
      id: "summarize",
      title: "Summarize outcome",
      description: "Return changed files, commands, checks, preview details, artifacts, and remaining risks.",
      owner: "autopilot",
      status: "pending",
    },
  ]
}

export function autopilotPlanFromRun(run: AutopilotContextPayload) {
  if (Array.isArray(run.plan) && run.plan.length) return run.plan
  return createNativeAutopilotPlan()
}

export function autopilotTaskItemsFromRun(run: AutopilotContextPayload) {
  if (Array.isArray(run.taskItems) && run.taskItems.length) return run.taskItems
  const tasks = Array.isArray(run.tasks) && run.tasks.length ? run.tasks : [run.goal].filter(Boolean)
  return createAutopilotTaskItems(tasks)
}

function autopilotEventsFromRun(run: AutopilotContextPayload) {
  if (Array.isArray(run.events)) return trimAutopilotEvents(run.events.map(sanitizeAutopilotEvent))
  return []
}

function autopilotSafeguardsFromRun(run: AutopilotContextPayload) {
  if (Array.isArray(run.safeguards) && run.safeguards.length) return run.safeguards
  return fallbackSafeguards
}

function runHeader(run: AutopilotContextPayload) {
  const taskTitles = autopilotTaskItemsFromRun(run).map((task) => task.title)
  const lines = [
    `Run ID: ${run.runID}`,
    `Overall goal: ${run.goal}`,
    ...(taskTitles.length ? ["Task queue:", ...taskTitles.map((task, index) => `${index + 1}. ${task}`)] : []),
    `Workspace: ${run.workspace}`,
    `Selected agent: ${run.agent ?? "current"}`,
    `Selected model: ${formatAutopilotModel(run.model)}`,
  ]
  const selection = run.templateSelection
  if (selection && selection.id && (selection.status === "chosen" || selection.status === "applying")) {
    const by = selection.decidedBy === "user" ? "user-picked" : selection.decidedBy === "planner" ? "planner-picked" : "autopilot-picked"
    lines.push(
      `Pre-selected template: ${selection.name ?? selection.id} (${selection.id}, ${by})`,
      selection.decidedBy === "user"
        ? "Respect this template unless the user's goal explicitly says otherwise."
        : "You may swap this template if a different one fits the goal better; emit a PADDIE_TEMPLATE_ID line to record the change.",
    )
  } else if (selection && selection.status === "skipped") {
    lines.push("Template selection: skipped by the user. Do not emit PADDIE_TEMPLATE_ID.")
  }
  return lines.join("\n")
}

function phaseInstructions() {
  return [
    "Progress markers:",
    "- Before major planning/context work, emit PADDIE_AUTOPILOT_PHASE: planning or PADDIE_AUTOPILOT_PHASE: gathering.",
    "- Before choosing templates/workflows/tools, emit PADDIE_AUTOPILOT_PHASE: choosing.",
    "- Before file implementation, emit PADDIE_AUTOPILOT_PHASE: executing.",
    "- Before tests/builds/checks, emit PADDIE_AUTOPILOT_PHASE: verifying.",
    "- Before browser/preview work, emit PADDIE_AUTOPILOT_PHASE: previewing.",
    "- Before final response, emit PADDIE_AUTOPILOT_PHASE: summarizing.",
  ].join("\n")
}

function resourceCatalog(input?: AutopilotResourceInput) {
  return [
    templateCatalog(input),
    workflowCatalog(input),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function resourceContext(input?: AutopilotResourceInput) {
  return [
    templateCatalog(input),
    selectedTemplateContext(input?.selectedTemplate),
    workflowCatalog(input),
    selectedWorkflowContext(input?.selectedWorkflow),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function templateCatalog(input?: AutopilotResourceInput) {
  if (input?.templateAccess === "logged-out") return "Paddie template catalog: unavailable because the user is not logged in."
  if (input?.templateAccess === "unavailable") {
    return `Paddie template catalog: unavailable${input.templateError ? ` (${input.templateError})` : ""}.`
  }
  const templates = input?.templates?.slice(0, MAX_TEMPLATE_CATALOG) ?? []
  if (!templates.length) return "Paddie template catalog: no templates available in this run context."
  return [
    "Paddie template catalog:",
    ...templates.map((template) =>
      [
        `- id: ${template.id}`,
        `  name: ${template.name}`,
        template.description ? `  description: ${template.description}` : "",
        template.stack ? `  stack: ${template.stack}` : "",
        template.tier ? `  tier: ${template.tier}` : "",
        template.tags?.length ? `  tags: ${template.tags.join(", ")}` : "",
        template.parts?.length ? `  parts: ${template.parts.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n")
}

function selectedTemplateContext(template: AutopilotTemplateContext | undefined) {
  if (!template) return ""
  const files = trimFiles(template.files)
  return [
    `Selected Paddie template: ${template.name} (${template.id})`,
    template.description ? `Description: ${template.description}` : "",
    template.stack ? `Stack: ${template.stack}` : "",
    "Adapt the layout, hierarchy, spacing, colors, typography, and motion intent. Do not copy private assets, logos, or branding verbatim.",
    files,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function workflowCatalog(input?: AutopilotResourceInput) {
  if (input?.workflowAccess === "logged-out") return "Paddie workflow catalog: unavailable because the user is not logged in."
  if (input?.workflowAccess === "unavailable") {
    return `Paddie workflow catalog: unavailable${input.workflowError ? ` (${input.workflowError})` : ""}.`
  }
  const workflows = input?.workflows?.slice(0, MAX_WORKFLOW_CATALOG) ?? []
  if (!workflows.length) return "Paddie workflow catalog: no workflows available in this run context."
  return [
    "Paddie workflow catalog:",
    ...workflows.map((workflow) =>
      [
        `- id: ${workflow.id}`,
        `  name: ${workflow.name}`,
        workflow.description ? `  description: ${workflow.description}` : "",
        `  status: ${workflow.status}`,
        workflow.method ? `  method: ${workflow.method}` : "",
        `  graph: ${workflow.nodeCount} nodes, ${workflow.edgeCount} links`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n")
}

function selectedWorkflowContext(workflow: AutopilotWorkflowContext | undefined) {
  if (!workflow) return ""
  const graph = JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges }, null, 2)
  return [
    `Selected Paddie workflow: ${workflow.name} (${workflow.id})`,
    workflow.description ? `Description: ${workflow.description}` : "",
    `Status: ${workflow.status}`,
    `Webhook URL: ${workflow.webhookUrl}`,
    `Generated ${workflow.language} client code:\n${truncateAutopilotText(workflow.code, MAX_WORKFLOW_CODE_CONTEXT)}`,
    `Workflow graph JSON:\n${truncateAutopilotText(graph, MAX_WORKFLOW_GRAPH_CONTEXT)}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function trimFiles(files: AutopilotTemplateContext["files"]) {
  const result = files.reduce(
    (acc, file) => {
      if (acc.used >= MAX_RESOURCE_TOTAL) return { ...acc, omitted: acc.omitted + 1 }
      if (file.encoding === "base64") return { ...acc, omitted: acc.omitted + 1 }
      const content = file.content.length > MAX_RESOURCE_FILE ? `${file.content.slice(0, MAX_RESOURCE_FILE)}\n\n[File truncated.]` : file.content
      return {
        used: acc.used + content.length,
        omitted: acc.omitted,
        blocks: [...acc.blocks, `--- ${file.path} ---\n${content}`],
      }
    },
    { used: 0, omitted: 0, blocks: [] as string[] },
  )
  return [
    "Selected template reference files:",
    ...result.blocks,
    result.omitted ? `[${result.omitted} binary or oversized template files omitted.]` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function sanitizeRestoredAutopilotRun(run: AutopilotRun, now: string) {
  const taskItems = autopilotTaskItemsFromRun(run).map((task) => ({ ...task }))
  const restored = {
    ...run,
    runtime: run.runtime ?? "paddie-native" as const,
    tasks: taskItems.map((task) => task.title),
    taskItems,
    plan: autopilotPlanFromRun(run).map((step) => ({ ...step })),
    events: autopilotEventsFromRun(run),
    safeguards: autopilotSafeguardsFromRun(run).slice(),
  }
  if ((restored.status !== "running" && restored.status !== "paused") || !isStaleRestoredRun(restored, now)) return restored
  return addAutopilotEvent(
    {
      ...restored,
      status: "stopped",
      updatedAt: now,
    },
    {
      id: `${restored.runID}:restored-stale`,
      source: "system",
      title: "Stale run restored as stopped",
      body: "This Autopilot run was older than the worker timeout, so it was not resumed automatically.",
      at: now,
    },
  )
}

export function sanitizeAutopilotEvent(event: AutopilotEvent): AutopilotEvent {
  return {
    ...event,
    body: truncateAutopilotText(event.body, MAX_EVENT_BODY),
    detail: event.detail ? truncateAutopilotText(event.detail, MAX_EVENT_DETAIL) : undefined,
  }
}

function trimAutopilotEvents(events: AutopilotEvent[]) {
  return events.slice(-MAX_AUTOPILOT_EVENTS)
}

function truncateAutopilotText(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[Autopilot output truncated.]`
}

function isStaleRestoredRun(run: AutopilotRun, now: string) {
  const updatedAt = Date.parse(run.updatedAt || run.createdAt)
  const nowTime = Date.parse(now)
  if (!Number.isFinite(updatedAt) || !Number.isFinite(nowTime)) return false
  return nowTime - updatedAt > MAX_RESTORED_RUNNING_AGE
}

function dedupeAutopilotRuns(runs: AutopilotRun[]) {
  return runs
    .filter((run, index, list) => run.runID && list.findIndex((item) => item.runID === run.runID) === index)
    .slice(0, 20)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
