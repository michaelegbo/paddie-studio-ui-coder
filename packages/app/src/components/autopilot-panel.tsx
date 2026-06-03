import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  addAutopilotEvent,
  autopilotContextFromRun,
  autopilotGoalNeedsData,
  autopilotGoalNeedsPenpot,
  autopilotGoalNeedsTemplate,
  autopilotGoalNeedsWorkflow,
  autopilotHandoffFromText,
  autopilotHasHandoff,
  autopilotPlanFromRun,
  autopilotPhaseFromText,
  autopilotPhaseStatuses,
  autopilotTaskItemsFromRun,
  autopilotTaskQueueFromText,
  autopilotTaskStatusMarkers,
  bindAutopilotSession,
  completeAutopilotRun,
  createAutopilotQueueItem,
  createAutopilotTaskItems,
  createAutopilotRun,
  formatAutopilotModel,
  matchAutopilotTemplates,
  migrateAutopilotStore,
  nativePlannerPrompt,
  nativeTemplateVisualFixPrompt,
  nativeTemplateVisualVerificationPrompt,
  nativeVerificationPrompt,
  nativeWorkerPrompt,
  normalizeAutopilotWorkspaces,
  sanitizeAutopilotEvent,
  selectedTemplateFromText,
  selectedWorkflowFromText,
  setAutopilotPlanStatuses,
  setAutopilotTaskStatuses,
  setAutopilotTemplateSelection,
  templateVisualReportEventBody,
  templateVisualReportFromText,
  templateVisualReportNeedsFix,
  transitionAutopilotRun,
  updateAutopilotTaskQueue,
  type AutopilotEvent,
  type AutopilotPlanStep,
  type AutopilotQueueItem,
  type AutopilotResourceInput,
  type AutopilotRun,
  type AutopilotRunStatus,
  type AutopilotStepStatus,
  type AutopilotTemplateContext,
  type AutopilotTemplateSelection,
  type AutopilotTemplateSummary,
  type AutopilotWorkflowContext,
} from "@/autopilot/helpers"
import { createBurstDetector } from "@/autopilot/run-guard"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useAuth } from "@/context/auth"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"
import { createTemplateVisualContract, filesFor, type UITemplate, type UITemplateMeta } from "@/template/helpers"
import { Persist, persisted } from "@/utils/persist"
import { previewFromSession } from "@/utils/preview-url"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"

type StudioWorkflowNode = {
  id: string
  type: string
  name: string
  config?: Record<string, unknown>
}

type StudioWorkflowEdge = {
  id: string
  source: string
  target: string
  condition?: string
  sourceHandle?: string
  targetHandle?: string
}

type StudioWorkflow = {
  id: string
  name: string
  description?: string
  status: string
  webhook?: {
    id: string
    method: string
  }
  nodes: StudioWorkflowNode[]
  edges: StudioWorkflowEdge[]
}

type StudioWorkflowCodegen = {
  language: "javascript" | "python"
  code: string
  webhookUrl: string
}

const WAIT_TIMEOUT_MS = 30 * 60 * 1000
const PLANNER_TIMEOUT_MS = 5 * 60 * 1000
const RESOURCE_TIMEOUT_MS = 15 * 1000
const WAIT_INTERVAL_MS = 1_200
const WAIT_NOTICE_MS = 20 * 1000
const WAIT_NOTICE_INTERVAL_MS = 45 * 1000
const MAX_WORKER_TEXT = 18_000
const MAX_WORKER_PART_TEXT = 4_000
const MAX_WORKER_EVENT_DETAIL = 12_000
const SET_RUN_BURST_LIMIT = 50
const TEMPLATE_VISUAL_RETRY_LIMIT = 2

export function AutopilotPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const globalSync = useGlobalSync()
  const sync = useSync()
  const layout = useLayout()
  const local = useLocal()
  const auth = useAuth()
  const dialog = useDialog()
  const prompt = usePrompt()
  const [goal, setGoal] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [view, setView] = createSignal<"plan" | "activity">("plan")
  const [selectedEventID, setSelectedEventID] = createSignal<string>()
  const [clock, setClock] = createSignal(Date.now())
  const [targetWorkspaces, setTargetWorkspaces] = createSignal<string[]>([sdk.directory])
  const [store, setStore] = persisted(
    {
      ...Persist.workspace(sdk.directory, "autopilot", ["autopilot.native.v1"]),
      migrate: migrateAutopilotStore,
      debounceWriteMs: 300,
    },
    createStore<{
      current?: AutopilotRun
      currentRunID?: string
      runs?: AutopilotRun[]
      queue?: AutopilotQueueItem[]
      queuePaused?: boolean
    }>({
      current: undefined,
      currentRunID: undefined,
      runs: [],
      queue: [],
      queuePaused: false,
    }),
  )
  const runs = createMemo(() => {
    const stored = store.runs ?? []
    if (stored.length) return stored
    return store.current ? [store.current] : []
  })
  const runByID = (runID: string | undefined) => runs().find((item) => item.runID === runID)
  const run = () => runByID(store.currentRunID) ?? runs()[0]
  const selectedWorkspace = createMemo(() => run()?.workspace ?? targetWorkspaces()[0] ?? sdk.directory)
  const selectedStore = createMemo(() => globalSync.child(selectedWorkspace(), { bootstrap: false })[0])
  const [trippedRuns, setTrippedRuns] = createSignal<ReadonlySet<string>>(new Set<string>())
  const burstDetector = createBurstDetector({ limit: SET_RUN_BURST_LIMIT })
  const runWakers = new Map<string, Set<() => void>>()
  const wakeRun = (runID: string) => {
    const set = runWakers.get(runID)
    if (!set || !set.size) return
    const fns = Array.from(set)
    set.clear()
    runWakers.delete(runID)
    for (const fn of fns) {
      try {
        fn()
      } catch {}
    }
  }
  const cancellableDelay = (runID: string, ms: number) =>
    new Promise<void>((resolve) => {
      let wake: (() => void) | undefined
      const timer = window.setTimeout(() => {
        if (wake) runWakers.get(runID)?.delete(wake)
        resolve()
      }, ms)
      wake = () => {
        window.clearTimeout(timer)
        resolve()
      }
      let set = runWakers.get(runID)
      if (!set) {
        set = new Set()
        runWakers.set(runID, set)
      }
      set.add(wake)
    })
  const setRun = (next: AutopilotRun | undefined, select = true) => {
    if (!next) {
      setStore("current", undefined)
      setStore("currentRunID", undefined)
      return
    }
    if (trippedRuns().has(next.runID) && next.status !== "stopped") return
    const currentRuns = runs()
    const index = currentRuns.findIndex((item) => item.runID === next.runID)
    if (index >= 0 && currentRuns[index] === next) {
      if (select && store.currentRunID !== next.runID) {
        setStore("currentRunID", next.runID)
        setStore("current", next)
      }
      return
    }
    const burst = burstDetector.recordAndCheck()
    let writeable = next
    if (burst.exceeded && !trippedRuns().has(next.runID) && next.status !== "stopped") {
      setTrippedRuns((prev) => {
        const updatedSet = new Set(prev)
        updatedSet.add(next.runID)
        return updatedSet
      })
      const at = new Date().toISOString()
      writeable = transitionAutopilotRun(
        addAutopilotEvent(next, {
          id: `${next.runID}:loop-tripped`,
          source: "system",
          title: "Autopilot stopped to keep Studio responsive",
          body:
            "Detected a runaway update loop. The run was stopped automatically so the rest of Studio stays responsive.",
          at,
        }),
        "stopped",
        at,
      )
      if (next.sessionID) {
        void clientForWorkspace(next.workspace)
          .session.abort({ sessionID: next.sessionID })
          .catch(() => undefined)
        globalSync.child(next.workspace)[1]("session_status", next.sessionID, { type: "idle" })
      }
      wakeRun(next.runID)
      showToast({
        variant: "error",
        title: "Autopilot stopped",
        description: "Detected a runaway update loop. The run was stopped so Studio stays responsive.",
      })
    }
    if (writeable.status === "stopped" || writeable.status === "paused") wakeRun(writeable.runID)
    const writeableIndex = currentRuns.findIndex((item) => item.runID === writeable.runID)
    const updated =
      writeableIndex < 0
        ? [writeable, ...currentRuns]
        : currentRuns.map((item) => (item.runID === writeable.runID ? writeable : item))
    setStore("runs", updated.slice(0, 20))
    if (select) {
      setStore("currentRunID", writeable.runID)
      setStore("current", writeable)
    } else if (store.currentRunID === writeable.runID || !store.currentRunID) {
      setStore("current", writeable)
    }
  }
  const selectRun = (runID: string) => {
    const next = runByID(runID)
    if (!next) return
    setStore("currentRunID", runID)
    setStore("current", next)
    setGoal(next.goal)
    setTargetWorkspaces([next.workspace])
  }
  const isFinishedRun = (status: AutopilotRunStatus) =>
    status === "completed" || status === "stopped"
  const removeRun = (runID: string) => {
    const target = runByID(runID)
    if (target?.sessionID && !isFinishedRun(target.status)) {
      void clientForWorkspace(target.workspace)
        .session.abort({ sessionID: target.sessionID })
        .catch(() => undefined)
      globalSync.child(target.workspace)[1]("session_status", target.sessionID, { type: "idle" })
    }
    setTrippedRuns((prev) => {
      if (!prev.has(runID)) return prev
      const next = new Set(prev)
      next.delete(runID)
      return next
    })
    const remaining = runs().filter((item) => item.runID !== runID)
    setStore("runs", remaining)
    if (store.currentRunID === runID) {
      const replacement = remaining[0]
      setStore("currentRunID", replacement?.runID)
      setStore("current", replacement)
      if (!replacement) {
        setGoal("")
        setTargetWorkspaces([sdk.directory])
      }
    } else if (!remaining.length) {
      setStore("current", undefined)
    }
  }
  const clearFinishedRuns = () => {
    const remaining = runs().filter((item) => !isFinishedRun(item.status))
    if (remaining.length === runs().length) return
    setStore("runs", remaining)
    if (store.currentRunID && !remaining.some((item) => item.runID === store.currentRunID)) {
      const replacement = remaining[0]
      setStore("currentRunID", replacement?.runID)
      setStore("current", replacement)
      if (!replacement) {
        setGoal("")
        setTargetWorkspaces([sdk.directory])
      }
    }
  }
  const finishedRunCount = createMemo(() => runs().filter((item) => isFinishedRun(item.status)).length)

  const queue = createMemo<AutopilotQueueItem[]>(() => store.queue ?? [])
  const queueLength = createMemo(() => queue().length)
  const queuePaused = createMemo(() => store.queuePaused ?? false)
  const writeQueue = (next: AutopilotQueueItem[]) => {
    const trimmed = next.slice(0, 50)
    setStore("queue", trimmed)
  }
  const queueGoal = (goalText: string): boolean => {
    const trimmed = goalText.trim()
    if (!trimmed) {
      showToast({
        variant: "error",
        title: "Goal required",
        description: "Type a goal before queueing.",
      })
      return false
    }
    const currentModel = model()
    const currentAgent = agent()
    if (!currentModel || !currentAgent) {
      showToast({
        variant: "error",
        title: "Model and agent required",
        description: "Choose a connected model and agent before queueing.",
      })
      return false
    }
    const workspaces = normalizeAutopilotWorkspaces(sdk.directory, targetWorkspaces())
    if (!workspaces.length) {
      showToast({
        variant: "error",
        title: "Pick a codebase",
        description: "Choose at least one codebase before queueing this goal.",
      })
      return false
    }
    setTargetWorkspaces(workspaces)
    let item: AutopilotQueueItem
    try {
      item = createAutopilotQueueItem({
        goal: trimmed,
        workspaces,
        agent: currentAgent,
        model: currentModel,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Could not queue",
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    }
    writeQueue([...queue(), item])
    setGoal("")
    showToast({
      title: "Queued",
      description: `Autopilot will run "${item.goal.slice(0, 60)}${item.goal.length > 60 ? "…" : ""}" after the current task.`,
    })
    return true
  }
  const removeQueueItem = (id: string) => {
    writeQueue(queue().filter((item) => item.id !== id))
  }
  const moveQueueItem = (id: string, direction: "up" | "down") => {
    const items = queue()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= items.length) return
    const next = items.slice()
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved)
    writeQueue(next)
  }
  const clearQueue = () => writeQueue([])
  const toggleQueuePaused = () => setStore("queuePaused", !queuePaused())
  const isRunActive = createMemo(() => {
    const current = run()
    if (!current) return false
    return current.status === "running" || current.status === "paused"
  })
  const drainQueue = async () => {
    if (queuePaused()) return
    const items = queue()
    const next = items[0]
    if (!next) return
    if (isRunActive()) return
    const currentModel = next.model ?? model()
    const currentAgent = next.agent ?? agent()
    if (!currentModel || !currentAgent) {
      showToast({
        variant: "error",
        title: "Cannot start next queued task",
        description: "Connect a model and agent before the queue can drain.",
      })
      return
    }
    writeQueue(items.slice(1))
    setGoal(next.goal)
    setTargetWorkspaces(next.workspaces)
    await start()
  }
  const startTopQueued = () => {
    void drainQueue()
  }
  let lastDrainTrigger: string | undefined = (() => {
    const initial = run()
    return initial?.status === "completed" ? initial.runID : undefined
  })()
  createEffect(() => {
    const current = run()
    if (!current) return
    if (current.status !== "completed") return
    if (lastDrainTrigger === current.runID) return
    lastDrainTrigger = current.runID
    if (queuePaused() || queue().length === 0) return
    void drainQueue()
  })

  const templateSelection = createMemo(() => run()?.templateSelection)
  const templateSelectionStatusLabel = (status: AutopilotTemplateSelection["status"]) => {
    if (status === "applying") return "Applying"
    if (status === "applied") return "Applied"
    if (status === "skipped") return "Skipped"
    if (status === "suggesting") return "Suggesting"
    return "Selected"
  }
  const templateSelectionStatusClass = (status: AutopilotTemplateSelection["status"]) => {
    if (status === "applied") return "border-green-500/35 bg-green-500/10 text-green-300"
    if (status === "applying") return "border-blue-500/35 bg-blue-500/10 text-blue-300"
    if (status === "skipped") return "border-border-weaker-base bg-background-base text-text-weak"
    return "border-yellow-500/35 bg-yellow-500/10 text-yellow-200"
  }
  const templateSelectionDecidedLabel = (decidedBy: AutopilotTemplateSelection["decidedBy"]) => {
    if (decidedBy === "user") return "User pick"
    if (decidedBy === "planner") return "Planner pick"
    if (decidedBy === "autopilot") return "Autopilot pick"
    return "Selection"
  }
  const applyTemplatePick = (
    pick: { kind: "template"; template: AutopilotTemplateSummary } | { kind: "auto" } | { kind: "skip" },
  ) => {
    const current = run()
    if (!current) return
    const status = current.status
    const isLocked = status === "completed" || status === "stopped"
    if (isLocked) {
      showToast({
        variant: "error",
        title: "Run already finished",
        description: "Start a new run to pick a different template.",
      })
      return
    }
    const selection = current.templateSelection
    if (pick.kind === "skip") {
      const next = setAutopilotTemplateSelection(current, {
        status: "skipped",
        decidedBy: "user",
        candidates: selection?.candidates,
      })
      if (next === current) return
      const withEvent = addAutopilotEvent(next, {
        id: `${current.runID}:template-skipped:${Date.now().toString(36)}`,
        source: "template",
        title: "Template selection skipped",
        body: "User opted out of using a Paddie template for this run.",
        at: new Date().toISOString(),
      })
      setRun(withEvent)
      return
    }
    if (pick.kind === "auto") {
      const next = setAutopilotTemplateSelection(current, undefined)
      if (next === current) return
      const withEvent = addAutopilotEvent(next, {
        id: `${current.runID}:template-auto:${Date.now().toString(36)}`,
        source: "template",
        title: "Template selection delegated",
        body: "User delegated the template pick back to Autopilot/planner.",
        at: new Date().toISOString(),
      })
      setRun(withEvent)
      return
    }
    const template = pick.template
    const nextStatus: AutopilotTemplateSelection["status"] =
      selection?.status === "applied" || selection?.status === "applying" ? "applying" : "chosen"
    const next = setAutopilotTemplateSelection(current, {
      status: nextStatus,
      id: template.id,
      name: template.name,
      stack: template.stack,
      tier: template.tier,
      decidedBy: "user",
      candidates: selection?.candidates,
    })
    if (next === current) return
    const withEvent = addAutopilotEvent(next, {
      id: `${current.runID}:template-user-pick:${template.id}`,
      source: "template",
      title: "Template picked by user",
      body: `Switched to "${template.name}" for this run.`,
      at: new Date().toISOString(),
    })
    setRun(withEvent)
  }

  const model = createMemo(() => {
    const current = local.model.current()
    if (!current) return
    return {
      providerID: current.provider.id,
      modelID: current.id,
      variant: local.model.variant.current(),
    }
  })

  const agent = createMemo(() => local.agent.current()?.name)
  const workerSessionID = createMemo(() => run()?.sessionID)
  const runStatus = createMemo(() => run()?.status)
  const workerWorkspace = createMemo(() => run()?.workspace)
  const workerMessages = createMemo(() => {
    const sessionID = workerSessionID()
    if (!sessionID) return [] as Message[]
    return selectedStore().message[sessionID] ?? []
  })
  const workerParts = createMemo<Record<string, Part[] | undefined>>(
    () => {
      const sessionID = workerSessionID()
      if (!sessionID) return {}
      const store = selectedStore()
      const next: Record<string, Part[] | undefined> = {}
      for (const message of workerMessages()) {
        next[message.id] = store.part[message.id]
      }
      return next
    },
    {},
    {
      equals: (a, b) => {
        if (a === b) return true
        const aKeys = Object.keys(a)
        if (aKeys.length !== Object.keys(b).length) return false
        for (const key of aKeys) {
          if (a[key] !== b[key]) return false
        }
        return true
      },
    },
  )
  const previewUrl = createMemo(() => previewFromSession(workerMessages(), workerParts()) ?? "")
  const workerStatus = createMemo(() => {
    const sessionID = workerSessionID()
    if (!sessionID) return "waiting"
    return selectedStore().session_status[sessionID]?.type ?? "idle"
  })
  const workerStatusText = createMemo(() => {
    const value = workerStatus()
    if (value === "busy") return "Worker is running"
    if (value === "retry") return "Worker is retrying"
    if (value === "idle" && run()?.status === "completed") return "Worker completed"
    if (value === "idle" && run()?.sessionID) return "Worker is idle"
    return "Waiting for worker"
  })
  const runningTool = createMemo(() => {
    const tools = workerMessages().flatMap((message) => workerParts()[message.id] ?? [])
    return tools
      .filter((part): part is Extract<Part, { type: "tool" }> => part.type === "tool")
      .slice()
      .reverse()
      .find((part) => part.state.status === "running" || part.state.status === "pending")
  })
  const status = createMemo(() => {
    const current = run()
    if (!current) return "Ready to plan and run with Paddie Native Autopilot."
    if (submitting()) return "Starting a scoped native opencode worker session."
    if (current.status === "completed") return "Completed. Review changed files, checks, and preview details below."
    if (current.status === "paused") return "Paused. Current worker activity may finish, but no next step starts until resume."
    if (current.status === "stopped") return "Stopped. Start a new run to continue."
    return current.sessionID
      ? "Running. Autopilot is coordinating a dedicated opencode worker session."
      : "Running. Autopilot is preparing the native worker session."
  })
  const isActivityEvent = (event: AutopilotEvent) =>
    event.source === "opencode" ||
    event.source === "browser" ||
    event.source === "system" ||
    event.source === "template" ||
    event.source === "workflow" ||
    event.source === "penpot" ||
    event.title.includes("worker") ||
    event.title.includes("Worker") ||
    event.title.includes("Preview")
  const isErrorEvent = (event: AutopilotEvent) =>
    /\b(error|failed|could not|blocked|stderr|exception|panic|denied)\b/i.test(
      `${event.title}\n${event.body}\n${event.detail ?? ""}`,
    )
  const activityEvents = createMemo(() =>
    (run()?.events ?? []).filter(isActivityEvent).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  )
  const latestEvent = createMemo(() => activityEvents().at(-1) ?? run()?.events.at(-1))
  const activityProgress = createMemo(() => {
    const events = activityEvents()
    const latest = latestEvent()
    const complete = events.filter(
      (event) => !isErrorEvent(event) && !(run()?.status === "running" && latest?.id === event.id),
    ).length
    const total = events.length
    return {
      complete,
      total,
      percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    }
  })
  const selectedEvent = createMemo(() => activityEvents().find((event) => event.id === selectedEventID()))
  const latestErrorEvent = createMemo(() => activityEvents().slice().reverse().find(isErrorEvent))
  const detailEvent = createMemo(() => selectedEvent() ?? latestErrorEvent() ?? activityEvents().at(-1))
  const activityOutput = createMemo(() => detailEvent()?.detail ?? detailEvent()?.body ?? "No live output yet.")
  const liveStatusLine = createMemo(() => {
    const tool = runningTool()
    if (tool) return `${toolLabel(tool.tool)} ${tool.state.status}: ${toolBody(tool)}`
    const event = latestEvent()
    if (event) return `${event.title}: ${event.body}`
    return status()
  })
  const taskQueue = createMemo(() => {
    const current = run()
    if (current?.goal === goal().trim() && Array.isArray(current.tasks)) return current.tasks
    try {
      return goal()
        .split("\n")
        .flatMap((line) => line.split(";"))
        .map((item) => item.replace(/^(?:[-*+]|\d+[.)])\s+/, "").trim())
        .filter(Boolean)
        .slice(0, 20)
    } catch {
      return []
    }
  })
  const taskItems = createMemo(() => {
    const current = run()
    if (current) return autopilotTaskItemsFromRun(current)
    return createAutopilotTaskItems(taskQueue())
  })
  const progress = createMemo(() => {
    const current = run()
    if (!current) return { complete: 0, total: 0, percent: 0 }
    const plan = autopilotPlanFromRun(current)
    const total = plan.length
    const complete = plan.filter((step) => step.status === "done").length
    return {
      complete,
      total,
      percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    }
  })
  const taskProgress = createMemo(() => {
    const items = taskItems()
    const total = items.length
    const complete = items.filter((task) => task.status === "done").length
    const active = items.find((task) => task.status === "active") ?? items.find((task) => task.status === "pending")
    return {
      active,
      complete,
      total,
      percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    }
  })
  const activeStep = createMemo(() => {
    const current = run()
    if (!current) return
    const plan = autopilotPlanFromRun(current)
    return plan.find((step) => step.status === "active") ?? plan.find((step) => step.status === "pending")
  })
  const handoffSummary = createMemo(() => run()?.events.find((event) => event.id.endsWith(":completed"))?.body)

  if (typeof window !== "undefined") {
    const abortLiveRuns = () => {
      for (const item of runs()) {
        if (!item.sessionID) continue
        if (item.status !== "running" && item.status !== "paused") continue
        void clientForWorkspace(item.workspace)
          .session.abort({ sessionID: item.sessionID })
          .catch(() => undefined)
      }
    }
    window.addEventListener("pagehide", abortLiveRuns)
    window.addEventListener("beforeunload", abortLiveRuns)
    onCleanup(() => {
      window.removeEventListener("pagehide", abortLiveRuns)
      window.removeEventListener("beforeunload", abortLiveRuns)
    })
  }

  createEffect(() => {
    if (store.runs?.length || !store.current) return
    setStore("runs", [store.current])
    setStore("currentRunID", store.current.runID)
  })

  createEffect(() => {
    if (targetWorkspaces().length) return
    setTargetWorkspaces([sdk.directory])
  })

  createEffect(() => {
    const current = run()
    if (!current || goal().trim()) return
    setGoal(current.goal)
  })

  createEffect(() => {
    if (run()) return
    setView("plan")
    setSelectedEventID(undefined)
  })

  createEffect(() => {
    const id = selectedEventID()
    if (!id || activityEvents().some((event) => event.id === id)) return
    setSelectedEventID(undefined)
  })

  createEffect(() => {
    const status = runStatus()
    if (!status || status === "completed" || status === "stopped") return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const sessionID = workerSessionID()
    const workspace = workerWorkspace()
    if (!sessionID || !workspace) return
    void sync.session.sync(sessionID, { force: true, directory: workspace }).catch(() => undefined)
    const timer = window.setInterval(() => {
      const latest = run()
      if (!latest || latest.sessionID !== sessionID) return
      if (latest.status === "stopped" || latest.status === "completed") return
      void sync.session.sync(sessionID, { force: true, directory: latest.workspace }).catch(() => undefined)
    }, WAIT_INTERVAL_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const current = run()
    const sessionID = current?.sessionID
    if (!current || !sessionID) return
    scanWorkerOutput(current, workerMessages(), workerParts())
  })

  createEffect(() => {
    const current = run()
    const url = previewUrl()
    if (!current || !url) return
    setRun(
      addAutopilotEvent(setAutopilotPlanStatuses(current, { preview: "active" }), {
        id: `${current.runID}:preview:${url}`,
        source: "browser",
        title: "Preview URL detected",
        body: url,
        detail: url,
        at: new Date().toISOString(),
      }),
    )
  })

  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const openWorkerSession = (sessionID = workerSessionID(), workspace = run()?.workspace ?? sdk.directory) => {
    if (!sessionID) return
    if (props.chatHidden) props.onChatToggle?.()
    layout.projects.open(workspace)
    navigate(`/${base64Encode(workspace)}/session/${sessionID}`)
  }

  const syncPromptContext = (current: AutopilotRun) => {
    for (const item of prompt.context.items()) {
      if (item.type === "autopilot" && item.runID === current.runID) prompt.context.remove(item.key)
    }
    prompt.context.add({
      type: "autopilot",
      ...autopilotContextFromRun(current),
    })
  }

  const addRunEvent = (
    event: Omit<AutopilotEvent, "id"> & { id: string },
    statuses?: Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>>,
  ) => {
    const current = run()
    if (!current || current.events.some((item) => item.id === event.id)) return
    setRun(addAutopilotEvent(statuses ? setAutopilotPlanStatuses(current, statuses) : current, event))
  }

  const addRunEventFor = (
    current: AutopilotRun,
    event: Omit<AutopilotEvent, "id"> & { id: string },
    statuses?: Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>>,
  ) => {
    const latest = runByID(current.runID) ?? current
    if (latest.events.some((item) => item.id === event.id)) return latest
    const next = addAutopilotEvent(statuses ? setAutopilotPlanStatuses(latest, statuses) : latest, event)
    setRun(next, store.currentRunID === current.runID)
    return next
  }

  const upsertRunEvent = (
    current: AutopilotRun,
    event: Omit<AutopilotEvent, "id"> & { id: string },
    statuses?: Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>>,
  ) => {
    const base = statuses ? setAutopilotPlanStatuses(current, statuses) : current
    const index = base.events.findIndex((item) => item.id === event.id)
    if (index < 0) return addAutopilotEvent(base, event)
    const nextEvent = sanitizeAutopilotEvent({
      id: event.id,
      source: event.source,
      title: event.title,
      body: event.body,
      detail: event.detail ?? event.body,
      at: event.at,
    })
    if (base.events[index]?.body === nextEvent.body && base.events[index]?.detail === nextEvent.detail) return base
    return {
      ...base,
      updatedAt: event.at,
      events: base.events.map((item, itemIndex) =>
        itemIndex === index
          ? nextEvent
          : item,
      ),
    }
  }

  const attach = (current: AutopilotRun) => {
    const at = new Date().toISOString()
    const next = addAutopilotEvent(current, {
      id: `${current.runID}:attached`,
      source: "paddie",
      title: "Run attached to chat",
      body: "The Autopilot run was added as optional chat context. Execution still stays in the scoped native worker session.",
      at,
    })
    setRun(next)
    syncPromptContext(next)
    focus()
    showToast({
      title: "Autopilot context attached",
      description: "You can ask about this run in chat without changing the run path.",
    })
  }

  const loadTemplateCatalog = async (current: AutopilotRun): Promise<AutopilotResourceInput> => {
    if (!auth.isAuthenticated()) {
      if (autopilotGoalNeedsTemplate(current.goal)) {
        throw new Error("Log in to Paddie Studio before asking Autopilot to inspect or select your templates.")
      }
      return { templateAccess: "logged-out" }
    }

    try {
      const templates = await withTimeout(
        paddieApi.get<UITemplateMeta[]>("/studio/ui-templates"),
        RESOURCE_TIMEOUT_MS,
        "Paddie template catalog did not respond within 15 seconds.",
      )
      return {
        templateAccess: "available",
        templates: templates.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          stack: template.stack,
          tier: template.tier,
          tags: template.tags,
          parts: template.parts_summary,
        })),
      }
    } catch (err) {
      if (autopilotGoalNeedsTemplate(current.goal)) {
        throw new Error(`Could not load your Paddie templates: ${errorText(err)}`)
      }
      return {
        templateAccess: "unavailable",
        templateError: errorText(err),
      }
    }
  }

  const loadWorkflowCatalog = async (current: AutopilotRun): Promise<AutopilotResourceInput> => {
    if (!auth.isAuthenticated()) {
      if (autopilotGoalNeedsWorkflow(current.goal)) {
        throw new Error("Log in to Paddie Studio before asking Autopilot to inspect or use your workflows.")
      }
      return { workflowAccess: "logged-out" }
    }

    try {
      const workflows = await withTimeout(
        paddieApi.get<StudioWorkflow[]>("/studio/flows"),
        RESOURCE_TIMEOUT_MS,
        "Paddie workflow catalog did not respond within 15 seconds.",
      )
      return {
        workflowAccess: "available",
        workflows: workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          method: workflow.webhook?.method,
          nodeCount: workflow.nodes.length,
          edgeCount: workflow.edges.length,
        })),
      }
    } catch (err) {
      if (autopilotGoalNeedsWorkflow(current.goal)) {
        throw new Error(`Could not load your Paddie workflows: ${errorText(err)}`)
      }
      return {
        workflowAccess: "unavailable",
        workflowError: errorText(err),
      }
    }
  }

  const loadPenpotContext = async (current: AutopilotRun): Promise<AutopilotResourceInput> => {
    const penpotDesigns = prompt.context.items().filter((item) => item.type === "penpot-design")
    if (penpotDesigns.length) {
      return {
        penpotAccess: "attached",
        penpotDesigns: penpotDesigns.map((item) => ({ ...item })),
        selectedPenpot: { ...penpotDesigns[0]! },
      }
    }
    if (!autopilotGoalNeedsPenpot(current.goal)) return {}
    return {
      penpotAccess: "unavailable",
      penpotError: "No Penpot frame is attached. Use the Studio Penpot tab to connect MCP and attach one or more frames.",
    }
  }

  const loadSelectedTemplate = async (selection: { id: string } | undefined): Promise<AutopilotTemplateContext | undefined> => {
    if (!selection) return
    const template = await paddieApi.get<UITemplate>(`/studio/ui-templates/${selection.id}?v=${Date.now()}`)
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      stack: template.stack,
      tier: template.tier,
      tags: template.tags,
      parts: template.parts.map((item) => item.name),
      files: filesFor(template).map((file) => ({
        path: file.path,
        content: file.content,
        encoding: file.encoding === "base64" ? "base64" : undefined,
      })),
      visualContract: createTemplateVisualContract(template),
    }
  }

  const loadSelectedWorkflow = async (
    selection: { id: string } | undefined,
  ): Promise<AutopilotWorkflowContext | undefined> => {
    if (!selection) return
    const flows = await paddieApi.get<StudioWorkflow[]>("/studio/flows")
    const flow = flows.find((item) => item.id === selection.id)
    if (!flow) return
    const codegen = await paddieApi.get<StudioWorkflowCodegen>(`/studio/flows/${flow.id}/codegen?language=javascript`)
    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      status: flow.status,
      method: flow.webhook?.method,
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      language: codegen.language,
      code: codegen.code,
      webhookUrl: codegen.webhookUrl,
      nodes: flow.nodes,
      edges: flow.edges,
    }
  }

  const submitWorkerPrompt = async (
    current: AutopilotRun,
    client: typeof sdk.client,
    sessionID: string,
    text: string,
    title: string,
    statuses: Partial<Record<AutopilotPlanStep["id"], AutopilotStepStatus>>,
  ) => {
    const at = new Date().toISOString()
    const next = addAutopilotEvent(setAutopilotPlanStatuses(current, statuses), {
      id: `${current.runID}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      source: "opencode",
      title,
      body: "Submitted to the scoped native opencode worker session.",
      detail: text,
      at,
    })
    setRun(next, store.currentRunID === current.runID)
    globalSync.child(current.workspace)[1]("session_status", sessionID, { type: "busy" })
    await client.session.promptAsync({
      sessionID,
      agent: current.agent,
      model: current.model ? { providerID: current.model.providerID, modelID: current.model.modelID } : undefined,
      variant: current.model?.variant,
      parts: [{ type: "text", text }],
    })
  }

  const waitForIdle = async (
    runID: string,
    workspace: string,
    sessionID: string,
    assistantCountBefore: number,
    label: string,
    activeStepID: AutopilotPlanStep["id"],
    timeout = WAIT_TIMEOUT_MS,
  ) => {
    const started = Date.now()
    let lastNoticeAt = 0
    while (Date.now() - started < timeout) {
      await waitForRunnable(runID)
      await sync.session.sync(sessionID, { force: true, directory: workspace }).catch(() => undefined)
      const current = runByID(runID)
      if (!current || current.runID !== runID || current.status === "stopped") throw new Error("Autopilot run stopped.")
      const workspaceStore = globalSync.child(workspace, { bootstrap: false })[0]
      const messages = workspaceStore.message[sessionID] ?? []
      const partsByMessage = Object.fromEntries(messages.map((message) => [message.id, workspaceStore.part[message.id]]))
      scanWorkerOutput(current, messages, partsByMessage)
      const idle = (workspaceStore.session_status[sessionID]?.type ?? "idle") === "idle"
      const hasResponse = assistantMessageCount(workspace, sessionID) > assistantCountBefore
      const workerText = workerPlainText(workspace, sessionID, { assistantStart: assistantCountBefore })
      const handoffSeen = autopilotHasHandoff(workerText)
      if (handoffSeen) {
        globalSync.child(workspace)[1]("session_status", sessionID, { type: "idle" })
        return
      }
      if ((idle && hasResponse) || workerResponseSettled(messages, partsByMessage, assistantCountBefore)) return
      const elapsed = Date.now() - started
      if (elapsed >= WAIT_NOTICE_MS && elapsed - lastNoticeAt >= WAIT_NOTICE_INTERVAL_MS) {
        const latest = runByID(runID)
        if (latest) {
          setRun(
            upsertRunEvent(
              latest,
              {
                id: `${runID}:wait:${activeStepID}`,
                source: "autopilot",
                title: `${label} still running`,
                body: `Waiting for the scoped opencode worker. ${Math.floor(elapsed / 1_000)} seconds elapsed.`,
                detail: `Session ${sessionID} is still reported as ${workspaceStore.session_status[sessionID]?.type ?? "idle"} in ${workspace}.`,
                at: new Date().toISOString(),
              },
              { [activeStepID]: "active" },
            ),
            store.currentRunID === runID,
          )
        }
        lastNoticeAt = elapsed
      }
      await cancellableDelay(runID, WAIT_INTERVAL_MS)
    }
    throw new Error(`${label} did not finish before the ${Math.round(timeout / 60_000)} minute timeout.`)
  }

  const waitForRunnable = async (runID: string) => {
    while (runByID(runID)?.status === "paused") {
      await cancellableDelay(runID, WAIT_INTERVAL_MS)
    }
    const current = runByID(runID)
    if (!current || current.runID !== runID || current.status === "stopped") throw new Error("Autopilot run stopped.")
  }

  const assistantMessageCount = (workspace: string, sessionID: string) =>
    (globalSync.child(workspace, { bootstrap: false })[0].message[sessionID] ?? []).filter((message) => message.role === "assistant").length

  const workerPlainText = (
    workspace: string,
    sessionID: string,
    options?: {
      assistantStart?: number
      includeToolOutput?: boolean
      max?: number
    },
  ) => {
    const workspaceStore = globalSync.child(workspace, { bootstrap: false })[0]
    return trimWorkerText(
      (workspaceStore.message[sessionID] ?? [])
        .filter((message) => message.role === "assistant")
        .slice(options?.assistantStart ?? 0)
        .flatMap((message) => workspaceStore.part[message.id] ?? [])
        .flatMap((part) => {
          if (part.type === "text" || part.type === "reasoning") return [part.text]
          if (!options?.includeToolOutput) return []
          if (part.type === "tool" && part.state.status === "completed") return [part.state.output]
          if (part.type === "tool" && part.state.status === "error") return [part.state.error]
          return []
        })
        .map((value) => trimWorkerText(value, MAX_WORKER_PART_TEXT))
        .join("\n\n"),
      options?.max ?? MAX_WORKER_TEXT,
    )
  }

  const clientForWorkspace = (workspace: string) =>
    workspace === sdk.directory
      ? sdk.client
      : sdk.createClient({
          directory: workspace,
          throwOnError: true,
        })

  const start = async () => {
    const currentModel = model()
    const currentAgent = agent()
    if (!currentModel || !currentAgent) {
      showToast({
        variant: "error",
        title: "Model and agent required",
        description: "Choose a connected model and agent before starting Autopilot.",
      })
      return
    }

    const workspaces = normalizeAutopilotWorkspaces(sdk.directory, targetWorkspaces())
    setTargetWorkspaces(workspaces)
    setSubmitting(true)
    await Promise.allSettled(workspaces.map((workspace, index) => startWorkspace(workspace, currentAgent, currentModel, index === 0)))
    setSubmitting(false)
  }

  const startWorkspace = async (
    workspace: string,
    currentAgent: string,
    currentModel: NonNullable<ReturnType<typeof model>>,
    select: boolean,
  ) => {
    let current: AutopilotRun | undefined
    const client = clientForWorkspace(workspace)
    try {
      current = createAutopilotRun({
        goal: goal(),
        workspace,
        agent: currentAgent,
        model: currentModel,
      })
      setRun(current, select)
      layout.projects.open(workspace)
      globalSync.child(workspace)
      if (select) setView("activity")

      current = addRunEventFor(
        current,
        {
          id: `${current.runID}:context-start`,
          source: "paddie",
          title: "Gathering Studio context",
          body: `Loading available templates, workflows, and attached Penpot context before planning in ${workspace}.`,
          at: new Date().toISOString(),
        },
        { understand: "done", gather: "active" },
      )

      if (autopilotGoalNeedsData(current.goal)) {
        current = addRunEventFor(
          current,
          {
            id: `${current.runID}:data-skill`,
            source: "system",
            title: "Paddie Data skill enabled",
            body: auth.isAuthenticated()
              ? "The worker will load the Paddie data integration skill for Memory/RAG/API implementation."
              : "Log in to Paddie Studio before asking Autopilot to inspect Memory, Knowledge Base, or API-key resources.",
            at: new Date().toISOString(),
          },
        )
        if (!auth.isAuthenticated()) throw new Error("Log in to Paddie Studio before asking Autopilot to use Memory, AI RAG, or API keys.")
      }

      const [templateResources, workflowResources, penpotResources] = await Promise.all([
        loadTemplateCatalog(current),
        loadWorkflowCatalog(current),
        loadPenpotContext(current),
      ])
      const resources = {
        ...templateResources,
        ...workflowResources,
        ...penpotResources,
      } satisfies AutopilotResourceInput

      current = runByID(current.runID) ?? current
      if (!current) return
      current = addRunEventFor(
        current,
        {
          id: `${current.runID}:context-ready`,
          source: "paddie",
          title: "Studio context ready",
          body: `${resources.templates?.length ?? 0} templates, ${resources.workflows?.length ?? 0} workflows, and ${resources.penpotDesigns?.length ?? 0} Penpot design context item${(resources.penpotDesigns?.length ?? 0) === 1 ? "" : "s"} available to the native worker.`,
          at: new Date().toISOString(),
        },
        { gather: "done", plan: "active" },
      )

      if (
        autopilotGoalNeedsTemplate(current.goal) &&
        resources.templateAccess === "available" &&
        resources.templates &&
        resources.templates.length > 0
      ) {
        const matches = matchAutopilotTemplates(current.goal, resources.templates)
        if (matches.length) {
          const top = matches[0]!.template
          current = setAutopilotTemplateSelection(runByID(current.runID) ?? current, {
            status: "chosen",
            id: top.id,
            name: top.name,
            stack: top.stack,
            tier: top.tier,
            decidedBy: "autopilot",
            candidates: matches.map((match) => match.template),
          })
          setRun(current, select)
          current = addRunEventFor(
            current,
            {
              id: `${current.runID}:template-suggested`,
              source: "template",
              title: "Template selected",
              body:
                matches.length > 1
                  ? `Autopilot picked "${top.name}". ${matches.length - 1} other candidate${matches.length - 1 > 1 ? "s" : ""} ranked below.`
                  : `Autopilot picked "${top.name}" based on your goal.`,
              detail: matches
                .map((match) => `- ${match.template.name} (${match.score} pts): ${match.reasons.join("; ") || "no reasons"}`)
                .join("\n"),
              at: new Date().toISOString(),
            },
          )
        }
      }

      const created = await client.session.create({
        title: `Paddie Autopilot - ${current.goal.slice(0, 80)}`,
        agent: currentAgent,
        model: {
          providerID: currentModel.providerID,
          id: currentModel.modelID,
          variant: currentModel.variant,
        },
      })
      const sessionID = created.data?.id
      if (!sessionID) throw new Error("Could not create the scoped Autopilot worker session.")
      current = bindAutopilotSession(runByID(current.runID) ?? current, sessionID)
      setRun(current, select)
      await sync.session.sync(sessionID, { force: true, directory: workspace }).catch(() => undefined)
      if (select) openWorkerSession(sessionID, workspace)
      current = addRunEventFor(
        current,
        {
          id: `${current.runID}:session-opened:${sessionID}`,
          source: "paddie",
          title: "Worker chat opened",
          body: select
            ? "The main chat panel is now showing the scoped opencode worker session for this Autopilot run."
            : "A scoped opencode worker session was created for this selected codebase.",
          at: new Date().toISOString(),
        },
        { plan: "active" },
      )

      const plannerBefore = assistantMessageCount(workspace, sessionID)
      await submitWorkerPrompt(
        current,
        client,
        sessionID,
        nativePlannerPrompt(autopilotContextFromRun(current), resources),
        "Planner prompt submitted",
        { plan: "active" },
      )
      await waitForIdle(current.runID, workspace, sessionID, plannerBefore, "Planning", "plan", PLANNER_TIMEOUT_MS)

      const plannerOutput = workerPlainText(workspace, sessionID, { assistantStart: plannerBefore })
      const plannedTasks = autopilotTaskQueueFromText(plannerOutput)
      if (plannedTasks.length) {
        current = updateAutopilotTaskQueue(runByID(current.runID) ?? current, plannedTasks)
        setRun(current, select)
      }

      if (autopilotHasHandoff(plannerOutput)) {
        current = runByID(current.runID) ?? current
        if (current && current.status !== "stopped") {
          const earlySelection = current.templateSelection
          if (earlySelection && (earlySelection.status === "chosen" || earlySelection.status === "applying") && earlySelection.id) {
            current = setAutopilotTemplateSelection(current, { ...earlySelection, status: "applied" })
            setRun(current, select)
          }
          current = addRunEventFor(
            current,
            {
              id: `${current.runID}:planner-handoff`,
              source: "autopilot",
              title: "Worker handed off during planning",
              body: "Worker completed the goal in a single pass — skipping the implementation and verification prompts and using its handoff summary directly.",
              at: new Date().toISOString(),
            },
          )
          const earlySummary = finalSummary(workspace, sessionID, plannerBefore)
          current = addAutopilotEvent(current, {
            id: `${current.runID}:handoff`,
            source: "opencode",
            title: "Worker handed results back",
            body: earlySummary,
            detail: earlySummary,
            at: new Date().toISOString(),
          })
          setRun(current, select)
          setRun(completeAutopilotRun(current, earlySummary), select)
        }
        return
      }
      const plannerTemplatePick = selectedTemplateFromText(plannerOutput)
      const selectedWorkflow = selectedWorkflowFromText(plannerOutput)

      const autopilotSelection = current.templateSelection
      const effectiveTemplateSelector: { id: string; name?: string } | undefined = (() => {
        if (plannerTemplatePick) return plannerTemplatePick
        if (autopilotSelection?.id) return { id: autopilotSelection.id, name: autopilotSelection.name }
        return undefined
      })()

      if (
        plannerTemplatePick &&
        autopilotSelection &&
        autopilotSelection.id !== plannerTemplatePick.id
      ) {
        current = setAutopilotTemplateSelection(runByID(current.runID) ?? current, {
          ...autopilotSelection,
          id: plannerTemplatePick.id,
          name: plannerTemplatePick.name ?? plannerTemplatePick.id,
          decidedBy: "planner",
          status: "chosen",
        })
        setRun(current, select)
        current = addRunEventFor(
          current,
          {
            id: `${current.runID}:template-planner-override:${plannerTemplatePick.id}`,
            source: "template",
            title: "Planner overrode the template pick",
            body: `Planner chose "${plannerTemplatePick.name ?? plannerTemplatePick.id}" instead of the Autopilot pre-pick.`,
            at: new Date().toISOString(),
          },
        )
      } else if (
        plannerTemplatePick &&
        !autopilotSelection
      ) {
        current = setAutopilotTemplateSelection(runByID(current.runID) ?? current, {
          status: "chosen",
          id: plannerTemplatePick.id,
          name: plannerTemplatePick.name ?? plannerTemplatePick.id,
          decidedBy: "planner",
        })
        setRun(current, select)
      }

      const enriched = {
        ...resources,
        plannerOutput,
        selectedTemplate: await loadSelectedTemplate(effectiveTemplateSelector).catch((err) => {
          addResourceError("template", current!, err)
          return undefined
        }),
        selectedWorkflow: await loadSelectedWorkflow(selectedWorkflow).catch((err) => {
          addResourceError("workflow", current!, err)
          return undefined
        }),
      } satisfies AutopilotResourceInput

      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return

      if (current.templateSelection && current.templateSelection.status === "chosen" && current.templateSelection.id) {
        current = setAutopilotTemplateSelection(current, {
          ...current.templateSelection,
          status: "applying",
        })
        setRun(current, select)
      }

      const workerBefore = assistantMessageCount(workspace, sessionID)
      await submitWorkerPrompt(
        current,
        client,
        sessionID,
        nativeWorkerPrompt(autopilotContextFromRun(current), enriched),
        "Implementation prompt submitted",
        { plan: "done", choose: "done", implement: "active" },
      )
      await waitForIdle(current.runID, workspace, sessionID, workerBefore, "Implementation", "implement")

      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return

      const applyingSelection = current.templateSelection
      if (applyingSelection && applyingSelection.status === "applying" && applyingSelection.id) {
        const applied: AutopilotTemplateSelection = { ...applyingSelection, status: "applied" }
        current = setAutopilotTemplateSelection(current, applied)
        setRun(current, select)
        current = addRunEventFor(
          current,
          {
            id: `${current.runID}:template-applied:${applied.id}`,
            source: "template",
            title: "Template applied",
            body: `"${applied.name ?? applied.id}" finished applying.`,
            at: new Date().toISOString(),
          },
        )
      }

      const implementationOutput = workerPlainText(workspace, sessionID, { assistantStart: workerBefore })
      if (autopilotHasHandoff(implementationOutput) && !enriched.selectedTemplate?.visualContract) {
        current = addRunEventFor(
          current,
          {
            id: `${current.runID}:implement-handoff`,
            source: "autopilot",
            title: "Worker handed off during implementation",
            body: "Worker emitted its handoff block while implementing — skipping the verification prompt and finalising the run.",
            at: new Date().toISOString(),
          },
        )
        const implSummary = finalSummary(workspace, sessionID, workerBefore)
        current = addAutopilotEvent(current, {
          id: `${current.runID}:handoff`,
          source: "opencode",
          title: "Worker handed results back",
          body: implSummary,
          detail: implSummary,
          at: new Date().toISOString(),
        })
        setRun(current, select)
        setRun(completeAutopilotRun(current, implSummary), select)
        return
      }

      const verifyBefore = assistantMessageCount(workspace, sessionID)
      await submitWorkerPrompt(
        current,
        client,
        sessionID,
        nativeVerificationPrompt(autopilotContextFromRun(current), enriched),
        "Verification prompt submitted",
        { implement: "done", verify: "active" },
      )
      await waitForIdle(current.runID, workspace, sessionID, verifyBefore, "Verification", "verify")

      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return
      current = await runTemplateVisualLoop(current, client, sessionID, workspace, enriched, select, verifyBefore)
      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return
      const summary = finalSummary(workspace, sessionID, verifyBefore)
      current = addAutopilotEvent(current, {
        id: `${current.runID}:handoff`,
        source: "opencode",
        title: "Worker handed results back",
        body: summary,
        detail: summary,
        at: new Date().toISOString(),
      })
      setRun(current, select)
      setRun(completeAutopilotRun(current, summary), select)
    } catch (err) {
      const latest = current ? runByID(current.runID) ?? current : undefined
      if (latest) {
        const failed = addAutopilotEvent(setAutopilotPlanStatuses(latest, blockActiveStep(latest)), {
          id: `${latest.runID}:native-error`,
          source: "opencode",
          title: "Autopilot run failed",
          body: errorText(err),
          detail: errorText(err),
          at: new Date().toISOString(),
        })
        setRun({ ...failed, status: "stopped" }, select || store.currentRunID === latest.runID)
      }
      showToast({
        variant: "error",
        title: "Autopilot failed",
        description: `${getFilename(workspace)}: ${errorText(err)}`,
      })
    }
  }

  const addResourceError = (kind: "template" | "workflow", current: AutopilotRun, err: unknown) => {
    setRun(
      addAutopilotEvent(current, {
        id: `${current.runID}:${kind}-load-error`,
        source: kind,
        title: `${kind === "template" ? "Template" : "Workflow"} context unavailable`,
        body: errorText(err),
        detail: errorText(err),
        at: new Date().toISOString(),
      }),
      store.currentRunID === current.runID,
    )
  }

  const runTemplateVisualLoop = async (
    current: AutopilotRun,
    client: typeof sdk.client,
    sessionID: string,
    workspace: string,
    resources: AutopilotResourceInput,
    select: boolean,
    verificationStart: number,
  ) => {
    const contract = resources.selectedTemplate?.visualContract
    if (!contract) return current
    current = addRunEventFor(
      current,
      {
        id: `${current.runID}:template-visual-reference:${contract.templateID}:${contract.partID ?? "full"}`,
        source: "template",
        title: "Reference captured",
        body: `${contract.templateName} visual contract captured for ${contract.viewports.map((viewport) => viewport.name).join(", ")} checks.`,
        detail: JSON.stringify(contract, null, 2),
        at: new Date().toISOString(),
      },
      { preview: "active" },
    )

    let attempt = 0
    let report = templateVisualReportFromText(
      workerPlainText(workspace, sessionID, { assistantStart: verificationStart, includeToolOutput: true }),
    )

    if (!report) {
      const visualBefore = assistantMessageCount(workspace, sessionID)
      await submitWorkerPrompt(
        current,
        client,
        sessionID,
        nativeTemplateVisualVerificationPrompt(autopilotContextFromRun(current), contract),
        "Template visual verification submitted",
        { verify: "done", preview: "active" },
      )
      await waitForIdle(current.runID, workspace, sessionID, visualBefore, "Template visual verification", "preview")
      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return current
      report = templateVisualReportFromText(
        workerPlainText(workspace, sessionID, { assistantStart: visualBefore, includeToolOutput: true }),
      )
    }

    if (report?.preview && !/not available/i.test(report.preview)) {
      current = addRunEventFor(
        current,
        {
          id: `${current.runID}:template-visual-preview:${report.preview}`,
          source: "browser",
          title: "Preview captured",
          body: `Current app preview captured at ${report.preview}.`,
          at: new Date().toISOString(),
        },
        { preview: "active" },
      )
    }

    while (report && templateVisualReportNeedsFix(report) && report.status !== "blocked" && attempt < TEMPLATE_VISUAL_RETRY_LIMIT) {
      current = recordTemplateVisualReport(current, report, attempt)
      current = addRunEventFor(
        current,
        {
          id: `${current.runID}:template-visual-fix-requested:${attempt + 1}`,
          source: "browser",
          title: "Fix requested",
          body: `Visual comparison did not pass. Asking the worker to fix template match issues, attempt ${attempt + 1} of ${TEMPLATE_VISUAL_RETRY_LIMIT}.`,
          detail: report.body,
          at: new Date().toISOString(),
        },
        { implement: "active", verify: "active", preview: "active" },
      )
      const fixBefore = assistantMessageCount(workspace, sessionID)
      await submitWorkerPrompt(
        current,
        client,
        sessionID,
        nativeTemplateVisualFixPrompt(autopilotContextFromRun(current), contract, report, attempt + 1),
        `Template visual fix ${attempt + 1} submitted`,
        { implement: "active", verify: "active", preview: "active" },
      )
      await waitForIdle(current.runID, workspace, sessionID, fixBefore, `Template visual fix ${attempt + 1}`, "preview")
      current = runByID(current.runID) ?? current
      if (!current || current.status === "stopped") return current
      report = templateVisualReportFromText(
        workerPlainText(workspace, sessionID, { assistantStart: fixBefore, includeToolOutput: true }),
      )
      attempt += 1
    }

    if (!report) {
      const blocked = addRunEventFor(
        current,
        {
          id: `${current.runID}:template-visual-blocked:missing-report`,
          source: "browser",
          title: "Visual check blocked",
          body: "The worker did not emit PADDIE_TEMPLATE_VISUAL_REPORT after the required visual verification prompt.",
          at: new Date().toISOString(),
        },
        { preview: "blocked", verify: "blocked" },
      )
      throw new Error(blocked.events.at(-1)?.body ?? "Template visual verification did not produce a report.")
    }

    current = recordTemplateVisualReport(current, report, attempt)
    if (!templateVisualReportNeedsFix(report)) {
      return setAutopilotPlanStatuses(current, { verify: "done", preview: "done" })
    }

    throw new Error(`Template visual verification ${report.status === "blocked" ? "was blocked" : "did not pass"}.\n${templateVisualReportEventBody(report)}`)
  }

  const recordTemplateVisualReport = (current: AutopilotRun, report: NonNullable<ReturnType<typeof templateVisualReportFromText>>, attempt: number) =>
    addRunEventFor(
      current,
      {
        id: `${current.runID}:template-visual-report:${attempt}:${report.status}:${Math.abs(templateVisualReportEventBody(report).length)}`,
        source: "browser",
        title:
          report.status === "pass"
            ? "Visual check passed"
            : report.status === "blocked"
              ? "Visual check blocked"
              : "Visual comparison failed",
        body: templateVisualReportEventBody(report),
        detail: report.body,
        at: new Date().toISOString(),
      },
      report.status === "pass" ? { verify: "done", preview: "done" } : { verify: "active", preview: "active" },
    )

  const blockActiveStep = (current: AutopilotRun) => {
    const active = autopilotPlanFromRun(current).find((step) => step.status === "active")
    if (!active) return { summarize: "blocked" as const }
    return { [active.id]: "blocked" as const }
  }

  const finalSummary = (workspace: string, sessionID: string, assistantStart: number) => {
    const text = autopilotHandoffFromText(
      workerPlainText(workspace, sessionID, { assistantStart, includeToolOutput: true, max: MAX_WORKER_TEXT }),
    ).trim()
    if (!text) return "The scoped opencode worker finished without a text summary."
    return text.slice(Math.max(0, text.length - 1_200))
  }

  const changeStatus = (nextStatus: AutopilotRunStatus) => {
    const current = run()
    if (!current) return
    if (nextStatus === "stopped" && current.sessionID) {
      void clientForWorkspace(current.workspace).session.abort({ sessionID: current.sessionID }).catch(() => undefined)
      globalSync.child(current.workspace)[1]("session_status", current.sessionID, { type: "idle" })
    }
    wakeRun(current.runID)
    setRun(transitionAutopilotRun(current, nextStatus))
  }

  const openActivity = () => {
    if (!run()) return
    setView("activity")
  }

  const scanCursors = new Map<string, number>()
  const scanWorkerOutput = (
    current: AutopilotRun,
    messages: Message[],
    partsByMessage: Record<string, Part[] | undefined>,
  ) => {
    const cursorKey = `${current.runID}:${current.sessionID ?? ""}`
    const cachedCount = scanCursors.get(cursorKey) ?? 0
    const startIndex = Math.max(0, Math.min(cachedCount - 1, messages.length - 1))
    scanCursors.set(cursorKey, messages.length)
    let next = current
    for (let index = startIndex; index < messages.length; index++) {
      const message = messages[index]
      if (!message) continue
      const parts = partsByMessage[message.id] ?? []
      for (const part of parts) {
        const item = eventFromPart(current.runID, message, part)
        if (!item) continue
        const phase = item.detail ? autopilotPhaseFromText(item.detail) : undefined
        next = upsertRunEvent(next, item, phase ? autopilotPhaseStatuses(phase) : undefined)
        const taskMarkers = item.detail ? autopilotTaskStatusMarkers(item.detail) : []
        if (taskMarkers.length) {
          next = setAutopilotTaskStatuses(
            next,
            Object.fromEntries(taskMarkers.map((marker) => [marker.index, marker.status])),
          )
        }
      }
    }
    if (next !== current) setRun(next, store.currentRunID === current.runID)
  }

  const eventFromPart = (runID: string, message: Message, part: Part): (Omit<AutopilotEvent, "id"> & { id: string }) | undefined => {
    const at = new Date(message.time.created).toISOString()
    if (message.role === "assistant" && (part.type === "text" || part.type === "reasoning")) {
      const body = trimWorkerText(part.text.trim(), MAX_WORKER_EVENT_DETAIL)
      if (!body) return
      return {
        id: `${runID}:part:${part.id}`,
        source: "opencode",
        title: part.type === "reasoning" ? "Worker reasoning update" : "Worker response update",
        body,
        detail: body,
        at: new Date(part.time?.end ?? part.time?.start ?? message.time.created).toISOString(),
      }
    }

    if (part.type === "tool") {
      const detail =
        part.state.status === "completed"
          ? trimWorkerText(part.state.output, MAX_WORKER_EVENT_DETAIL)
          : part.state.status === "error"
            ? trimWorkerText(part.state.error, MAX_WORKER_EVENT_DETAIL)
            : trimWorkerText(JSON.stringify(part.state.input, null, 2), MAX_WORKER_EVENT_DETAIL)
      return {
        id: `${runID}:tool:${part.id}:${part.state.status}`,
        source: "opencode",
        title: `${toolLabel(part.tool)} ${part.state.status}`,
        body: toolBody(part),
        detail,
        at: new Date(part.state.status === "pending" ? message.time.created : part.state.time?.start ?? message.time.created).toISOString(),
      }
    }

    if (part.type === "patch") {
      return {
        id: `${runID}:patch:${part.id}`,
        source: "opencode",
        title: "Patch recorded",
        body: part.files.join("\n"),
        detail: part.files.join("\n"),
        at,
      }
    }

    if (part.type === "retry") {
      return {
        id: `${runID}:retry:${part.id}`,
        source: "opencode",
        title: `Worker retry ${part.attempt}`,
        body: "The native worker retried after a provider/tool error.",
        detail: trimWorkerText(JSON.stringify(part.error, null, 2), MAX_WORKER_EVENT_DETAIL),
        at: new Date(part.time.created).toISOString(),
      }
    }
  }

  const toolLabel = (tool: string) => {
    if (tool === "bash") return "Command"
    if (tool === "edit" || tool === "write") return "File edit"
    if (tool === "task") return "Subtask"
    return `Tool ${tool}`
  }

  const toolBody = (part: Extract<Part, { type: "tool" }>) => {
    if (part.state.status === "completed") return trimWorkerText(part.state.title || part.state.output || `${part.tool} completed.`, MAX_WORKER_PART_TEXT)
    if (part.state.status === "error") return trimWorkerText(part.state.error, MAX_WORKER_PART_TEXT)
    if (part.state.status === "running") return trimWorkerText(part.state.title || JSON.stringify(part.state.input), MAX_WORKER_PART_TEXT)
    return trimWorkerText(JSON.stringify(part.state.input), MAX_WORKER_PART_TEXT)
  }

  const ownerLabel = (owner: AutopilotPlanStep["owner"]) => {
    if (owner === "opencode") return "opencode"
    if (owner === "autopilot") return "autopilot"
    if (owner === "template") return "templates"
    if (owner === "workflow") return "workflow"
    if (owner === "browser") return "browser"
    return "paddie"
  }

  const ownerClass = (owner: AutopilotPlanStep["owner"]) => {
    if (owner === "opencode") return "bg-blue-500/12 text-blue-300 border-blue-500/25"
    if (owner === "browser") return "bg-green-500/12 text-green-300 border-green-500/25"
    if (owner === "template" || owner === "workflow") return "bg-yellow-500/12 text-yellow-300 border-yellow-500/25"
    if (owner === "paddie") return "bg-cyan-500/12 text-cyan-300 border-cyan-500/25"
    return "bg-purple-500/12 text-purple-300 border-purple-500/25"
  }

  const eventSourceLabel = (source: AutopilotEvent["source"]) => {
    if (source === "opencode") return "opencode"
    if (source === "autopilot") return "autopilot"
    if (source === "template") return "templates"
    if (source === "workflow") return "workflow"
    if (source === "penpot") return "penpot"
    if (source === "browser") return "browser"
    if (source === "paddie") return "paddie"
    return source
  }

  const statusPillClass = (stepStatus: AutopilotStepStatus) => {
    if (stepStatus === "done") return "border-green-500/30 bg-green-500/10 text-green-300"
    if (stepStatus === "active") return "border-blue-500/35 bg-blue-500/10 text-blue-300"
    if (stepStatus === "blocked") return "border-red-500/35 bg-red-500/10 text-red-300"
    return "border-border-weaker-base bg-background-stronger text-text-weak"
  }

  const taskStatusClass = (status: string) => {
    if (status === "done") return "border-green-500/30 bg-green-500/10 text-green-300"
    if (status === "active") return "border-blue-500/35 bg-blue-500/10 text-blue-300"
    if (status === "blocked") return "border-red-500/35 bg-red-500/10 text-red-300"
    return "border-border-weaker-base bg-background-base text-text-weak"
  }

  const taskStatusDotClass = (status: string) => {
    if (status === "done") return "bg-icon-success-base"
    if (status === "active") return "animate-pulse bg-blue-400"
    if (status === "blocked") return "bg-icon-danger-base"
    return "bg-border-strong-base"
  }

  const taskStatusLabel = (status: string) => {
    if (status === "active") return "working"
    if (status === "done") return "done"
    if (status === "blocked") return "blocked"
    return "upcoming"
  }

  const statusDotClass = () => {
    const current = run()
    if (!current) return "bg-icon-info-base"
    if (current.status === "completed") return "bg-icon-success-base"
    if (current.status === "stopped") return "bg-icon-danger-base"
    if (current.status === "paused") return "bg-yellow-500"
    return "bg-green-500"
  }

  const runStatusClass = () => {
    const current = run()
    if (!current) return runStatusClassFor(undefined)
    return runStatusClassFor(current.status)
  }

  const runStatusClassFor = (status: AutopilotRunStatus | undefined) => {
    if (!status) return "border-border-weaker-base text-text-weak"
    if (status === "completed") return "border-green-500/30 bg-green-500/10 text-green-300"
    if (status === "stopped") return "border-red-500/30 bg-red-500/10 text-red-300"
    if (status === "paused") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
    return "border-blue-500/30 bg-blue-500/10 text-blue-300"
  }

  const activityEventClass = (event: AutopilotEvent) => {
    if (isErrorEvent(event)) return "border-red-500/35 bg-red-500/[0.06] hover:bg-red-500/[0.1]"
    if (run()?.status === "running" && latestEvent()?.id === event.id) {
      return "border-blue-500/40 bg-blue-500/[0.07] shadow-[0_0_0_1px_rgba(59,130,246,0.08),0_18px_50px_rgba(59,130,246,0.08)]"
    }
    if (event.source === "browser") return "border-green-500/25 bg-green-500/[0.04] hover:bg-green-500/[0.07]"
    if (event.source === "template" || event.source === "workflow" || event.source === "penpot") {
      return "border-yellow-500/25 bg-yellow-500/[0.04] hover:bg-yellow-500/[0.07]"
    }
    return "border-border-weaker-base bg-background-stronger/80 hover:bg-surface-base-hover"
  }

  const activityEventDotClass = (event: AutopilotEvent) => {
    if (isErrorEvent(event)) return "border-red-500/45 bg-red-500/15 text-red-300"
    if (run()?.status === "running" && latestEvent()?.id === event.id) {
      return "border-blue-400/50 bg-blue-500/20 text-blue-200 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
    }
    return "border-green-500/40 bg-green-500/20 text-green-200"
  }

  const activityEventMark = (event: AutopilotEvent) => {
    if (isErrorEvent(event)) return <Icon name="warning" class="size-3.5" />
    if (run()?.status === "running" && latestEvent()?.id === event.id) {
      return <span class="size-2.5 animate-pulse rounded-full bg-current" />
    }
    return <Icon name="check-small" class="size-4" />
  }

  const formatEventTime = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })

  const formatElapsed = () => {
    const current = run()
    if (!current) return "00:00"
    const end = current.status === "running" || current.status === "paused" ? clock() : Date.parse(current.updatedAt)
    const seconds = Math.max(0, Math.floor((end - Date.parse(current.createdAt)) / 1_000))
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) {
      return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60)
        .toString()
        .padStart(2, "0")}`
    }
    return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
  }

  const activityEventStateLabel = (event: AutopilotEvent) => {
    if (isErrorEvent(event)) return "blocked"
    if (run()?.status === "running" && latestEvent()?.id === event.id) return "live"
    return "done"
  }

  const activityEventSourceClass = (source: AutopilotEvent["source"]) => {
    if (source === "opencode") return "border-blue-500/25 bg-blue-500/10 text-blue-300"
    if (source === "browser") return "border-green-500/25 bg-green-500/10 text-green-300"
    if (source === "template" || source === "workflow" || source === "penpot") return "border-yellow-500/25 bg-yellow-500/10 text-yellow-300"
    if (source === "paddie") return "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
    return "border-purple-500/25 bg-purple-500/10 text-purple-300"
  }

  const activityEventSnippet = (event: AutopilotEvent) => {
    if (!event.detail || event.detail === event.body) return
    return event.detail.length > 320 ? `${event.detail.slice(0, 320)}...` : event.detail
  }

  const selectedTargets = createMemo(() => normalizeAutopilotWorkspaces(sdk.directory, targetWorkspaces()))

  const availableWorkspaces = createMemo(() =>
    normalizeAutopilotWorkspaces(sdk.directory, [
      sdk.directory,
      ...layout.projects.list().flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]),
      ...targetWorkspaces(),
      ...runs().map((item) => item.workspace),
    ]),
  )

  const workspaceName = (workspace: string) => {
    const project = layout.projects.list().find((item) => item.worktree === workspace || item.sandboxes?.includes(workspace))
    if (project?.worktree === workspace) return project.name || getFilename(project.worktree)
    return getFilename(workspace)
  }

  const workspaceDetail = (workspace: string) => {
    const project = layout.projects.list().find((item) => item.worktree === workspace || item.sandboxes?.includes(workspace))
    if (project?.worktree && project.worktree !== workspace) return `Sandbox of ${project.name || getFilename(project.worktree)}`
    return getDirectory(workspace)
  }

  const toggleTargetWorkspace = (workspace: string) => {
    const selected = selectedTargets()
    if (selected.some((item) => item.toLowerCase() === workspace.toLowerCase())) {
      if (selected.length === 1) return
      setTargetWorkspaces(selected.filter((item) => item.toLowerCase() !== workspace.toLowerCase()))
      return
    }
    setTargetWorkspaces(normalizeAutopilotWorkspaces(sdk.directory, [...selected, workspace]))
  }

  const addTargetWorkspace = () => {
    const resolve = (result: string | string[] | null) => {
      const picked = Array.isArray(result) ? result : result ? [result] : []
      if (!picked.length) return
      const next = normalizeAutopilotWorkspaces(sdk.directory, [...selectedTargets(), ...picked])
      for (const workspace of picked) layout.projects.open(workspace)
      setTargetWorkspaces(next)
    }
    dialog.show(
      () => <DialogSelectDirectory title="Add codebase for Autopilot" multiple={true} onSelect={resolve} />,
      () => resolve(null),
    )
  }

  const RunSwitcher = () => (
    <Show when={runs().length > 0}>
      <div class="rounded-[18px] border border-border-weaker-base bg-surface-base">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
          <div>
            <div class="text-14-bold text-text-base">Autopilot sessions</div>
            <div class="mt-0.5 text-11-medium text-text-weak">Switch between native runs without changing normal chat.</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full border border-border-weaker-base px-2 py-1 text-11-medium text-text-weak">
              {runs().length} saved
            </span>
            <Show when={finishedRunCount() > 0}>
              <Button
                variant="ghost"
                class="h-8 px-3 text-11-medium"
                onClick={clearFinishedRuns}
              >
                Clear finished
              </Button>
            </Show>
          </div>
        </div>
        <div class="flex gap-2 overflow-x-auto p-3">
          <For each={runs()}>
            {(item) => (
              <div
                role="button"
                tabindex="0"
                class={`relative min-w-[240px] rounded-[14px] border p-3 text-left transition-colors ${
                  run()?.runID === item.runID
                    ? "border-blue-500/40 bg-blue-500/[0.06]"
                    : "border-border-weaker-base bg-background-stronger hover:bg-surface-base-hover"
                }`}
                onClick={() => selectRun(item.runID)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    selectRun(item.runID)
                  }
                }}
              >
                <button
                  type="button"
                  aria-label="Remove this Autopilot run"
                  class="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border border-border-weaker-base bg-background-base text-text-weak transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeRun(item.runID)
                  }}
                >
                  <Icon name="trash" class="size-3" />
                </button>
                <div class="flex items-center justify-between gap-2 pr-7">
                  <div class="min-w-0 truncate text-12-bold text-text-base">{workspaceName(item.workspace)}</div>
                  <span class={`shrink-0 rounded-full border px-2 py-0.5 text-10-medium ${runStatusClassFor(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <Show when={trippedRuns().has(item.runID)}>
                  <div class="mt-1.5 inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-10-medium text-amber-200">
                    <Icon name="warning" class="size-3" />
                    Safeguard stopped
                  </div>
                </Show>
                <div class="mt-1 truncate text-11-medium text-text-weak">{item.goal}</div>
                <div class="mt-2 flex items-center justify-between gap-2 text-10-medium text-text-weak">
                  <span class="truncate">{item.sessionID ?? "No worker yet"}</span>
                  <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )

  const WorkspaceSelector = () => (
    <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-12-bold text-text-base">Codebases</div>
          <div class="mt-0.5 text-11-medium text-text-weak">Choose one or more workspaces for this Autopilot run.</div>
        </div>
        <span class="rounded-full border border-border-weaker-base px-2 py-1 text-11-medium text-text-weak">
          {selectedTargets().length} selected
        </span>
      </div>
      <div class="mt-3 grid gap-2">
        <For each={availableWorkspaces()}>
          {(workspace) => {
            const selected = createMemo(() => selectedTargets().some((item) => item.toLowerCase() === workspace.toLowerCase()))
            return (
              <button
                type="button"
                class={`flex items-center gap-3 rounded-[12px] border px-3 py-2 text-left transition-colors ${
                  selected()
                    ? "border-blue-500/35 bg-blue-500/[0.06]"
                    : "border-border-weaker-base bg-surface-base hover:bg-surface-base-hover"
                }`}
                onClick={() => toggleTargetWorkspace(workspace)}
              >
                <span
                  class={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
                    selected() ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-border-weaker-base text-text-weak"
                  }`}
                >
                  <Show when={selected()} fallback={<Icon name="folder" class="size-3.5" />}>
                    <Icon name="check-small" class="size-3.5" />
                  </Show>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-12-bold text-text-base">{workspaceName(workspace)}</span>
                  <span class="block truncate text-11-medium text-text-weak">{workspaceDetail(workspace)}</span>
                </span>
              </button>
            )
          }}
        </For>
      </div>
      <Button variant="ghost" class="mt-3 h-9 w-full px-3 text-12-medium" onClick={addTargetWorkspace}>
        Add another codebase
      </Button>
    </div>
  )

  const TaskBreakdown = (props: { compact?: boolean }) => (
    <div class={`${props.compact ? "rounded-[16px]" : "rounded-[18px]"} border border-border-weaker-base bg-surface-base`}>
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
        <div>
          <div class="text-14-bold text-text-base">Goal and task breakdown</div>
          <div class="mt-0.5 text-11-medium text-text-weak">Autopilot keeps one overall goal and works through each task in order.</div>
        </div>
        <Show when={taskProgress().total > 0}>
          <div class="rounded-full border border-border-weaker-base px-2 py-1 text-11-medium text-text-weak">
            {taskProgress().complete} of {taskProgress().total} tasks
          </div>
        </Show>
      </div>
      <div class="space-y-4 p-4">
        <div>
          <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Overall goal</div>
          <div class="mt-1 text-13-medium leading-6 text-text-base">{run()?.goal ?? (goal().trim() || "No goal entered yet.")}</div>
        </div>
        <Show when={taskProgress().total > 0}>
          <div>
            <div class="mb-2 flex items-center justify-between gap-3 text-11-medium text-text-weak">
              <span class="min-w-0 truncate">Current: {taskProgress().active?.title ?? "Complete"}</span>
              <span>{taskProgress().percent}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-background-stronger">
              <div class="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${taskProgress().percent}%` }} />
            </div>
          </div>
        </Show>
        <div class="grid gap-2">
          <For each={taskItems()}>
            {(task, index) => (
              <div class={`flex items-start gap-3 rounded-[12px] border px-3 py-3 ${taskStatusClass(task.status)}`}>
                <div class="mt-1 flex items-center gap-2">
                  <span class={`size-2 rounded-full ${taskStatusDotClass(task.status)}`} />
                  <span class="w-5 text-right text-11-bold">{index() + 1}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-12-bold text-text-base">{task.title}</div>
                  <div class="mt-1 text-10-medium uppercase tracking-[0.1em] text-text-weak">{taskStatusLabel(task.status)}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )

  const PlanList = () => (
    <div class="rounded-[18px] border border-border-weaker-base bg-surface-base">
      <div class="flex items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
        <div class="text-14-bold text-text-base">Autopilot plan</div>
        <Show when={run()}>
          <div class="text-11-medium text-text-weak">
            {progress().complete} of {progress().total} steps
          </div>
        </Show>
      </div>
      <div class="p-4">
        <Show
          when={run()}
          fallback={
            <div class="rounded-[16px] border border-dashed border-border-weaker-base bg-background-stronger px-4 py-10 text-center text-13-medium text-text-weak">
              Enter a task to prepare the native run plan.
            </div>
          }
        >
          {(current) => (
            <div class="grid gap-3">
              <For each={autopilotPlanFromRun(current())}>
                {(step, index) => (
                  <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-4">
                    <div class="flex gap-3">
                      <div
                        class={`flex size-8 shrink-0 items-center justify-center rounded-full border text-12-bold ${statusPillClass(
                          step.status,
                        )}`}
                      >
                        <Show when={step.status === "done"} fallback={index() + 1}>
                          <Icon name="check-small" class="size-4" />
                        </Show>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="text-13-bold text-text-base">{step.title}</div>
                          <span class={`rounded-full border px-2 py-0.5 text-10-medium ${ownerClass(step.owner)}`}>
                            {ownerLabel(step.owner)}
                          </span>
                          <span class={`rounded-full border px-2 py-0.5 text-10-medium ${statusPillClass(step.status)}`}>
                            {step.status === "active" ? "working" : step.status === "pending" ? "upcoming" : step.status}
                          </span>
                        </div>
                        <div class="mt-1 text-12-medium leading-5 text-text-weak">{step.description}</div>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </div>
  )

  const RunSetup = () => (
    <div class="rounded-[18px] border border-border-weaker-base bg-surface-base">
      <div class="border-b border-border-weaker-base px-4 py-3">
        <div class="text-14-bold text-text-base">Run setup</div>
      </div>
      <div class="space-y-3 p-4">
        <div class="grid gap-3 text-12-medium text-text-weak">
          <div class="flex items-center justify-between gap-3">
            <span>Agent</span>
            <span class="min-w-0 truncate text-text-base">{run()?.agent ?? agent() ?? "None"}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Model</span>
            <span class="min-w-0 truncate text-text-base">{formatAutopilotModel(run()?.model ?? model())}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <span class="min-w-0 truncate text-text-base">Paddie Native</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Selected codebases</span>
            <span class="min-w-0 truncate text-text-base">{selectedTargets().length}</span>
          </div>
        </div>
        <WorkspaceSelector />
        <div class="border-t border-border-weaker-base pt-4">
          <div class="text-12-bold text-text-base">When you start a run</div>
          <div class="mt-3 grid gap-2 text-12-medium text-text-weak">
            <div class="flex items-center gap-2">
              <span class="size-1.5 rounded-full bg-icon-info-base" />
              <span>Create an isolated opencode worker session.</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="size-1.5 rounded-full bg-icon-info-base" />
              <span>Plan, select tools, implement, verify, and preview.</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="size-1.5 rounded-full bg-icon-info-base" />
              <span>Stream worker output, tool calls, errors, and patches here.</span>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-2 pt-2 sm:flex-row">
          <Button class="h-10 flex-1 px-3 text-12-medium" disabled={!goal().trim() || submitting()} onClick={start}>
            {submitting()
              ? "Starting..."
              : selectedTargets().length > 1
                ? `Start ${selectedTargets().length} runs`
                : run()
                  ? "Start new run"
                  : "Start run"}
          </Button>
          <Button
            variant="ghost"
            class="h-10 flex-1 px-3 text-12-medium"
            disabled={!goal().trim() || submitting()}
            onClick={() => queueGoal(goal())}
          >
            {isRunActive() ? `Queue (#${queueLength() + 1})` : "Add to queue"}
          </Button>
        </div>
        <div class="flex">
          <Button
            variant="ghost"
            class="h-9 flex-1 px-3 text-12-medium"
            disabled={!run()}
            onClick={() => {
              const current = run()
              if (current) attach(current)
            }}
          >
            Attach current run to chat
          </Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            class="h-8 px-3 text-11-medium"
            disabled={!workerSessionID()}
            onClick={() => openWorkerSession()}
          >
            Open worker chat
          </Button>
          <Button
            variant="ghost"
            class="h-8 px-3 text-11-medium"
            disabled={!run() || run()?.status !== "running"}
            onClick={() => changeStatus("paused")}
          >
            Pause
          </Button>
          <Button
            variant="ghost"
            class="h-8 px-3 text-11-medium"
            disabled={!run() || run()?.status !== "paused"}
            onClick={() => changeStatus("running")}
          >
            Resume
          </Button>
          <Button
            variant="ghost"
            class="h-8 px-3 text-11-medium"
            disabled={!run() || run()?.status === "stopped" || run()?.status === "completed"}
            onClick={() => changeStatus("stopped")}
          >
            Stop
          </Button>
        </div>
      </div>
    </div>
  )

  const LiveRunStatus = () => (
    <div class="rounded-[20px] border border-border-weaker-base bg-[linear-gradient(135deg,rgba(17,24,39,0.94),rgba(7,10,18,0.96))] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div class="rounded-[16px] border border-border-weaker-base bg-background-base/55 p-4">
          <div class="flex items-center gap-2">
            <span class={`size-2.5 rounded-full ${statusDotClass()}`} />
            <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Run status</div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <div class="text-18-bold text-text-base">{run()?.status ?? "idle"}</div>
            <span class={`rounded-full border px-2 py-0.5 text-10-medium ${runStatusClass()}`}>{formatElapsed()}</span>
          </div>
          <div class="mt-2 line-clamp-2 text-12-medium leading-5 text-text-weak">{status()}</div>
        </div>
        <div class="rounded-[16px] border border-border-weaker-base bg-background-base/55 p-4">
          <div class="flex items-center gap-2">
            <span
              class={`size-2.5 rounded-full ${
                workerStatus() === "busy" ? "animate-pulse bg-blue-400" : workerStatus() === "retry" ? "bg-yellow-400" : "bg-icon-success-base"
              }`}
            />
            <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Worker</div>
          </div>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-15-bold text-text-base">{workerStatusText()}</div>
              <div class="mt-1 truncate text-12-medium text-text-weak">{workerSessionID() ?? "No worker session yet"}</div>
            </div>
            <Button variant="ghost" class="h-8 shrink-0 px-3 text-11-medium" disabled={!workerSessionID()} onClick={() => openWorkerSession()}>
              Open
            </Button>
          </div>
        </div>
        <div class="rounded-[16px] border border-border-weaker-base bg-background-base/55 p-4">
          <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Now</div>
          <div class="mt-2 truncate text-15-bold text-text-base">{taskProgress().active?.title ?? activeStep()?.title ?? "Waiting"}</div>
          <div class="mt-2 line-clamp-2 text-12-medium leading-5 text-text-weak">{liveStatusLine()}</div>
          <Show when={previewUrl()}>
            {(url) => <div class="mt-2 truncate text-11-medium text-green-300">{url()}</div>}
          </Show>
        </div>
      </div>
    </div>
  )

  const openTemplatePicker = () => {
    const selection = templateSelection()
    const candidates = selection?.candidates ?? []
    if (!candidates.length) {
      showToast({
        title: "No template candidates yet",
        description: "Autopilot is still gathering candidates. Try again once the run has started planning.",
      })
      return
    }
    const handlePick = (template: AutopilotTemplateSummary) => {
      applyTemplatePick({ kind: "template", template })
      dialog.close()
    }
    const handleAuto = () => {
      applyTemplatePick({ kind: "auto" })
      dialog.close()
    }
    const handleSkip = () => {
      applyTemplatePick({ kind: "skip" })
      dialog.close()
    }
    dialog.show(
      () => <TemplatePickerDialog candidates={candidates} currentID={selection?.id} onPick={handlePick} onAuto={handleAuto} onSkip={handleSkip} />,
      () => undefined,
    )
  }

  const TemplatePickerDialog = (props: {
    candidates: AutopilotTemplateSummary[]
    currentID: string | undefined
    onPick: (template: AutopilotTemplateSummary) => void
    onAuto: () => void
    onSkip: () => void
  }) => (
    <div class="w-[480px] max-w-[92vw] rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[0_24px_80px_rgba(0,0,0,0.25)]">
      <div class="border-b border-border-weaker-base px-5 py-4">
        <div class="text-15-bold text-text-base">Choose a template</div>
        <div class="mt-1 text-11-medium text-text-weak">Autopilot ranked these candidates against your goal.</div>
      </div>
      <div class="grid gap-2 p-4">
        <For each={props.candidates}>
          {(template) => (
            <button
              type="button"
              class={`flex items-start gap-3 rounded-[14px] border px-3 py-3 text-left transition-colors ${
                props.currentID === template.id
                  ? "border-blue-500/45 bg-blue-500/[0.08]"
                  : "border-border-weaker-base bg-background-stronger hover:bg-surface-base-hover"
              }`}
              onClick={() => props.onPick(template)}
            >
              <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border-weaker-base bg-background-base">
                <Show when={props.currentID === template.id} fallback={<Icon name="task" class="size-3.5 text-text-weak" />}>
                  <Icon name="check-small" class="size-4 text-blue-300" />
                </Show>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="min-w-0 truncate text-13-bold text-text-base">{template.name}</div>
                  <Show when={template.stack}>
                    <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium text-text-weak">
                      {template.stack}
                    </span>
                  </Show>
                  <Show when={template.tier && template.tier !== "free"}>
                    <span class="rounded-full border border-yellow-500/30 bg-yellow-500/12 px-2 py-0.5 text-10-medium text-yellow-300">
                      {template.tier}
                    </span>
                  </Show>
                </div>
                <Show when={template.description}>
                  <div class="mt-1 line-clamp-2 text-11-medium leading-5 text-text-weak">{template.description}</div>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-border-weaker-base px-4 py-3">
        <Button variant="ghost" class="h-9 px-3 text-12-medium" onClick={props.onSkip}>
          Skip templates
        </Button>
        <Button variant="ghost" class="h-9 px-3 text-12-medium" onClick={props.onAuto}>
          Let Autopilot decide
        </Button>
        <Button variant="ghost" class="h-9 px-3 text-12-medium" onClick={() => dialog.close()}>
          Cancel
        </Button>
      </div>
    </div>
  )

  const formatQueueAge = (queuedAt: string) => {
    const diff = clock() - Date.parse(queuedAt)
    if (!Number.isFinite(diff) || diff < 0) return "just now"
    const seconds = Math.floor(diff / 1000)
    if (seconds < 30) return "just now"
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  const QueueCard = () => (
    <Show when={queueLength() > 0 || queuePaused()}>
      <div class="rounded-[18px] border border-border-weaker-base bg-surface-base">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
          <div class="flex items-center gap-2">
            <Icon name="checklist" class="size-4 text-icon-info-base" />
            <div>
              <div class="text-14-bold text-text-base">Up next</div>
              <div class="mt-0.5 text-11-medium text-text-weak">
                <Show when={queuePaused()} fallback="Auto-starts when the active run finishes.">
                  Queue is paused. Resume to auto-start the next task.
                </Show>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-1 text-11-medium text-text-weak">
              {queueLength()} queued
            </span>
            <Show when={queueLength() > 0 && !isRunActive() && !queuePaused()}>
              <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={startTopQueued}>
                Start next now
              </Button>
            </Show>
            <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={toggleQueuePaused}>
              {queuePaused() ? "Resume queue" : "Pause queue"}
            </Button>
            <Show when={queueLength() > 0}>
              <Button variant="ghost" class="h-8 px-3 text-11-medium" onClick={clearQueue}>
                Clear all
              </Button>
            </Show>
          </div>
        </div>
        <Show
          when={queueLength() > 0}
          fallback={
            <div class="px-4 py-6 text-12-medium text-text-weak">
              No queued tasks. Type a new goal above and pick "Add to queue".
            </div>
          }
        >
          <div class="grid gap-2 p-3">
            <For each={queue()}>
              {(item, index) => (
                <div class="flex items-start gap-3 rounded-[14px] border border-border-weaker-base bg-background-stronger px-3 py-3">
                  <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border-weaker-base bg-background-base text-12-bold text-text-base">
                    {index() + 1}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="line-clamp-2 text-13-medium leading-5 text-text-base">{item.goal}</div>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-10-medium text-text-weak">
                      <span>{item.workspaces.length === 1 ? "1 codebase" : `${item.workspaces.length} codebases`}</span>
                      <span class="text-border-strong-base">·</span>
                      <span>Queued {formatQueueAge(item.queuedAt)}</span>
                      <Show when={item.agent || item.model}>
                        <span class="text-border-strong-base">·</span>
                        <span class="truncate">
                          {item.agent ?? "agent"} / {item.model ? formatAutopilotModel(item.model) : "model"}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      class="flex size-7 items-center justify-center rounded-full border border-border-weaker-base bg-background-base text-text-weak transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:opacity-40"
                      disabled={index() === 0}
                      onClick={() => moveQueueItem(item.id, "up")}
                    >
                      <Icon name="arrow-left" class="size-3 rotate-90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      class="flex size-7 items-center justify-center rounded-full border border-border-weaker-base bg-background-base text-text-weak transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:opacity-40"
                      disabled={index() === queueLength() - 1}
                      onClick={() => moveQueueItem(item.id, "down")}
                    >
                      <Icon name="arrow-left" class="size-3 -rotate-90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove from queue"
                      class="flex size-7 items-center justify-center rounded-full border border-border-weaker-base bg-background-base text-text-weak transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => removeQueueItem(item.id)}
                    >
                      <Icon name="trash" class="size-3" />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )

  const TemplateSelectionCard = () => (
    <Show when={templateSelection()}>
      {(selection) => (
        <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger/80 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Icon name="checklist" class="size-3.5 text-icon-info-base" />
              <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Template</div>
              <span class={`rounded-full border px-2 py-0.5 text-10-medium ${templateSelectionStatusClass(selection().status)}`}>
                {templateSelectionStatusLabel(selection().status)}
              </span>
              <Show when={selection().decidedBy}>
                <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium text-text-weak">
                  {templateSelectionDecidedLabel(selection().decidedBy)}
                </span>
              </Show>
            </div>
            <Show when={(selection().candidates?.length ?? 0) > 0}>
              <Button variant="ghost" class="h-7 px-3 text-11-medium" onClick={openTemplatePicker}>
                Change
              </Button>
            </Show>
          </div>
          <Show
            when={selection().status !== "skipped"}
            fallback={
              <div class="mt-2 text-12-medium text-text-weak">
                Templates are off for this run. Click Change to bring one back in.
              </div>
            }
          >
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <div class="min-w-0 truncate text-15-bold text-text-base">{selection().name ?? selection().id ?? "Unknown template"}</div>
              <Show when={selection().stack}>
                <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium text-text-weak">
                  {selection().stack}
                </span>
              </Show>
              <Show when={selection().tier && selection().tier !== "free"}>
                <span class="rounded-full border border-yellow-500/30 bg-yellow-500/12 px-2 py-0.5 text-10-medium text-yellow-300">
                  {selection().tier}
                </span>
              </Show>
            </div>
            <Show when={selection().status === "applying"}>
              <div class="mt-2 flex items-center gap-2 text-11-medium text-blue-300">
                <span class="size-2 animate-pulse rounded-full bg-blue-400" />
                Applying template files into the worker session…
              </div>
            </Show>
            <Show when={selection().status === "applied"}>
              <div class="mt-2 flex items-center gap-2 text-11-medium text-green-300">
                <Icon name="check-small" class="size-3.5" />
                Template applied. Worker is verifying.
              </div>
            </Show>
          </Show>
        </div>
      )}
    </Show>
  )

  const ActivityPreview = () => (
    <div class="rounded-[18px] border border-dashed border-border-weaker-base bg-surface-base p-5">
      <Show
        when={activityEvents().length > 0}
        fallback={
          <div class="flex min-h-[210px] flex-col items-center justify-center text-center">
            <div class="flex size-10 items-center justify-center rounded-full border border-border-weaker-base bg-background-stronger">
              <Icon name="task" class="size-4 text-icon-info-base" />
            </div>
            <div class="mt-3 text-13-bold text-text-base">Activity timeline</div>
            <div class="mt-1 max-w-[260px] text-12-medium leading-5 text-text-weak">Activity appears once the run starts.</div>
          </div>
        }
      >
        <div class="flex min-h-[210px] flex-col">
          <div class="text-13-bold text-text-base">Activity timeline</div>
          <Show when={latestEvent()}>
            {(event) => (
              <div class={`mt-3 rounded-[14px] border p-3 ${activityEventClass(event())}`}>
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 truncate text-12-bold text-text-base">{event().title}</div>
                  <span class="shrink-0 text-10-medium text-text-weak">{formatEventTime(event().at)}</span>
                </div>
                <div class="mt-1 line-clamp-3 text-11-medium leading-5 text-text-weak">{event().body}</div>
                <div class="mt-3 flex items-center justify-between gap-3 text-10-medium text-text-weak">
                  <span class="truncate">{workerStatusText()}</span>
                  <span class="shrink-0">{activeStep()?.title ?? "Complete"}</span>
                </div>
              </div>
            )}
          </Show>
          <Button class="mt-auto h-9 px-3 text-12-medium" onClick={openActivity}>
            Open Activity Timeline
          </Button>
        </div>
      </Show>
    </div>
  )

  const ProgressSummary = () => (
    <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger px-3 py-3">
      <div class="flex items-center gap-2">
        <div class={`size-2 rounded-full ${statusDotClass()}`} />
        <div class="min-w-0 flex-1 truncate text-12-medium text-text-weak">{status()}</div>
        <Show when={run()}>
          <div class="shrink-0 text-11-medium text-text-weak">
            {progress().complete} of {progress().total} steps
          </div>
        </Show>
      </div>
      <Show when={run()}>
        <div class="mt-3">
          <div class="mb-2 flex items-center justify-between gap-3 text-11-medium text-text-weak">
            <span class="min-w-0 truncate">Now: {activeStep()?.title ?? "Complete"}</span>
            <span>{progress().percent}%</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-base">
              <div class="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${progress().percent}%` }} />
            </div>
            <div class="w-10 text-right text-11-bold text-text-base">{progress().percent}%</div>
          </div>
        </div>
      </Show>
    </div>
  )

  const ActivityTimeline = () => (
    <div class="overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[0_18px_70px_rgba(0,0,0,0.18)]">
      <div class="flex flex-wrap items-center gap-4 border-b border-border-weaker-base bg-background-stronger/70 px-5 py-4">
        <div class="min-w-0 flex-1">
          <div class="text-15-bold text-text-base">Activity timeline</div>
          <div class="mt-1 truncate text-11-medium text-text-weak">{latestEvent()?.title ?? "Waiting for the first live event"}</div>
        </div>
        <Show when={run()}>
          <div class="flex shrink-0 items-center gap-3 text-11-medium text-text-weak">
            <span>
              {activityProgress().complete} of {activityProgress().total} events
            </span>
            <div class="h-2 w-32 overflow-hidden rounded-full bg-background-base">
              <div class="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${activityProgress().percent}%` }} />
            </div>
            <span class="w-9 text-right text-text-base">{activityProgress().percent}%</span>
          </div>
        </Show>
      </div>
      <div class="max-h-[700px] overflow-auto px-5 py-4">
        <Show
          when={activityEvents().length > 0}
          fallback={
            <div class="flex min-h-[300px] flex-col items-center justify-center rounded-[16px] border border-dashed border-border-weaker-base bg-background-stronger px-4 py-16 text-center">
              <div class="flex size-12 items-center justify-center rounded-full border border-border-weaker-base bg-surface-base text-icon-info-base">
                <Icon name="checklist" class="size-5" />
              </div>
              <div class="mt-3 text-13-bold text-text-base">Activity appears once the run starts.</div>
              <div class="mt-1 max-w-[300px] text-12-medium leading-5 text-text-weak">
                The run will switch from plan setup to live worker events, command output, patches, and verification status.
              </div>
            </div>
          }
        >
          <div class="relative grid gap-2 before:absolute before:bottom-8 before:left-[18px] before:top-8 before:w-px before:bg-gradient-to-b before:from-green-500/70 before:via-border-weaker-base before:to-border-weaker-base">
            <For each={activityEvents()}>
              {(event, index) => (
                <button
                  type="button"
                  class={`group relative w-full rounded-[18px] border p-4 text-left transition-all duration-200 ${
                    selectedEventID() === event.id
                      ? "border-blue-500/55 bg-blue-500/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.14)]"
                      : activityEventClass(event)
                  }`}
                  onClick={() => setSelectedEventID(event.id)}
                >
                  <div class="flex items-start gap-3">
                    <div
                      class={`relative z-[1] mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border text-12-bold transition-transform group-hover:scale-105 ${activityEventDotClass(
                        event,
                      )}`}
                    >
                      {activityEventMark(event)}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2 pr-2">
                        <div class="min-w-0 truncate text-13-bold text-text-base">{event.title}</div>
                        <span class={`rounded-full border px-2 py-0.5 text-10-medium ${activityEventSourceClass(event.source)}`}>
                          {eventSourceLabel(event.source)}
                        </span>
                        <span
                          class={`rounded-full border px-2 py-0.5 text-10-medium ${
                            activityEventStateLabel(event) === "blocked"
                              ? "border-red-500/30 bg-red-500/10 text-red-300"
                              : activityEventStateLabel(event) === "live"
                                ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                                : "border-green-500/30 bg-green-500/10 text-green-300"
                          }`}
                        >
                          {activityEventStateLabel(event)}
                        </span>
                        <span class="rounded-full border border-border-weaker-base bg-background-base px-2 py-0.5 text-10-medium text-text-weak">
                          Event {index() + 1} of {activityEvents().length}
                        </span>
                      </div>
                      <div class="mt-1 line-clamp-3 text-12-medium leading-5 text-text-weak">{event.body}</div>
                      <Show when={activityEventSnippet(event)}>
                        {(snippet) => (
                          <pre class="mt-3 max-h-24 overflow-hidden whitespace-pre-wrap rounded-[12px] border border-border-weaker-base bg-background-base/80 px-3 py-2 font-mono text-10-medium leading-4 text-text-base">
                            {snippet()}
                          </pre>
                        )}
                      </Show>
                      <div class="mt-3 flex flex-wrap items-center gap-2 text-10-medium text-text-weak">
                        <span class="truncate">Task: {taskProgress().active?.title ?? "Complete"}</span>
                        <span class="text-border-strong-base">/</span>
                        <span class="truncate">Phase: {activeStep()?.title ?? "Complete"}</span>
                      </div>
                    </div>
                    <div class="shrink-0 rounded-full border border-border-weaker-base bg-background-base px-2 py-1 text-10-medium text-text-weak">
                      {formatEventTime(event.at)}
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )

  const ActivityDetails = () => (
    <div class="grid gap-3">
      <Show when={handoffSummary()}>
        {(summary) => (
          <div class="rounded-[18px] border border-green-500/25 bg-green-500/[0.05] p-4 shadow-[0_16px_50px_rgba(34,197,94,0.08)]">
            <div class="flex items-center gap-2">
              <span class="flex size-7 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-green-300">
                <Icon name="check-small" class="size-4" />
              </span>
              <div>
                <div class="text-14-bold text-text-base">Autopilot handoff</div>
                <div class="text-11-medium text-text-weak">Worker results returned to Autopilot.</div>
              </div>
            </div>
            <div class="mt-3 whitespace-pre-wrap text-12-medium leading-5 text-text-base">{summary()}</div>
          </div>
        )}
      </Show>
      <div class="rounded-[18px] border border-border-weaker-base bg-[linear-gradient(180deg,rgba(18,24,38,0.92),rgba(12,15,22,0.96))] p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-14-bold text-text-base">Run details</div>
          <span class={`rounded-full border px-2 py-1 text-10-medium ${runStatusClass()}`}>{run()?.status ?? "idle"}</span>
        </div>
        <div class="mt-4 grid gap-3 text-12-medium text-text-weak">
          <div class="flex items-center justify-between gap-3">
            <span>Agent</span>
            <span class="min-w-0 truncate text-text-base">{agent() ?? "None"}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Model</span>
            <span class="min-w-0 truncate text-text-base">{formatAutopilotModel(model())}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <span class="min-w-0 truncate text-text-base">Paddie Native</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Workspace</span>
            <span class="min-w-0 truncate text-text-base">{run()?.workspace ?? sdk.directory}</span>
          </div>
          <Show when={previewUrl()}>
            {(url) => (
              <div class="flex items-center justify-between gap-3">
                <span>Preview</span>
                <span class="min-w-0 truncate text-text-base">{url()}</span>
              </div>
            )}
          </Show>
          <Show when={run()}>
            {(current) => (
              <>
                <div class="border-t border-border-weaker-base pt-3" />
                <div class="flex items-center justify-between gap-3">
                  <span>Run ID</span>
                  <span class="min-w-0 truncate text-text-base">{current().runID}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Worker session</span>
                  <button
                    type="button"
                    class="min-w-0 truncate text-right text-text-base underline-offset-2 hover:underline disabled:no-underline disabled:text-text-weak"
                    disabled={!current().sessionID}
                    onClick={() => openWorkerSession(current().sessionID)}
                  >
                    {current().sessionID ?? "Not started"}
                  </button>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Worker status</span>
                  <span class="min-w-0 truncate text-text-base">{workerStatusText()}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Started</span>
                  <span class="min-w-0 truncate text-text-base">{new Date(current().createdAt).toLocaleString()}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Elapsed</span>
                  <span class="min-w-0 truncate text-text-base">{formatElapsed()}</span>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
      <div class="rounded-[18px] border border-border-weaker-base bg-surface-base p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-14-bold text-text-base">Task progress</div>
          <span class="rounded-full border border-border-weaker-base px-2 py-1 text-10-medium text-text-weak">
            {taskProgress().complete} / {taskProgress().total}
          </span>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-background-stronger">
          <div class="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${taskProgress().percent}%` }} />
        </div>
        <div class="mt-3 grid gap-2">
          <For each={taskItems().slice(0, 5)}>
            {(task, index) => (
              <div class="flex items-center gap-2 rounded-[12px] border border-border-weaker-base bg-background-stronger px-3 py-2">
                <span class={`size-2 rounded-full ${taskStatusDotClass(task.status)}`} />
                <span class="w-4 shrink-0 text-10-bold text-text-weak">{index() + 1}</span>
                <span class="min-w-0 flex-1 truncate text-11-bold text-text-base">{task.title}</span>
                <span class={`rounded-full border px-2 py-0.5 text-10-medium ${taskStatusClass(task.status)}`}>
                  {taskStatusLabel(task.status)}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
      <div
        class={`rounded-[18px] border p-4 ${
          detailEvent() && isErrorEvent(detailEvent()!) ? "border-red-500/35 bg-red-500/[0.05]" : "border-border-weaker-base bg-surface-base"
        }`}
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 text-14-bold text-text-base">
            <Show when={detailEvent() && isErrorEvent(detailEvent()!)} fallback="Live output">
              Error detail
            </Show>
          </div>
          <Show when={detailEvent()}>
            {(event) => <span class="shrink-0 text-11-medium text-text-weak">{formatEventTime(event().at)}</span>}
          </Show>
        </div>
        <Show when={detailEvent()}>
          {(event) => (
            <div class="mt-2">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-12-bold text-text-base">{event().title}</div>
                <span class={`rounded-full border px-2 py-0.5 text-10-medium ${activityEventSourceClass(event().source)}`}>
                  {eventSourceLabel(event().source)}
                </span>
                <span
                  class={`rounded-full border px-2 py-0.5 text-10-medium ${
                    isErrorEvent(event())
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : "border-green-500/30 bg-green-500/10 text-green-300"
                  }`}
                >
                  {activityEventStateLabel(event())}
                </span>
              </div>
            </div>
          )}
        </Show>
        <pre class="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-[12px] border border-border-weaker-base bg-background-stronger p-3 text-11-medium leading-5 text-text-base">
          {activityOutput()}
        </pre>
      </div>
    </div>
  )

  return (
    <div class="min-h-full w-full bg-background-base">
      <Show
        when={view() === "activity" && run()}
        fallback={
          <div class="flex min-h-full flex-col gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3 px-1">
              <div class="min-w-0">
                <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Autopilot</div>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <div class="text-20-bold text-text-base">Plan, build, and run natively</div>
                  <Show when={run()}>
                    {(current) => (
                      <span class={`rounded-full border px-2 py-1 text-11-medium ${runStatusClass()}`}>
                        {current().status}
                      </span>
                    )}
                  </Show>
                </div>
              </div>
              <Show when={activityEvents().length > 0}>
                <Button variant="ghost" class="h-9 px-3 text-12-medium" onClick={openActivity}>
                  Open Activity Timeline
                </Button>
              </Show>
            </div>
            <RunSwitcher />

            <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
              <div class="grid gap-4">
                <div class="rounded-[18px] border border-border-weaker-base bg-surface-base">
                  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
                    <div class="text-14-bold text-text-base">Current task</div>
                    <Show when={run()}>
                      {(current) => (
                        <span class={`rounded-full border px-2 py-1 text-11-medium ${runStatusClass()}`}>
                          {current().status}
                        </span>
                      )}
                    </Show>
                  </div>
                  <div class="space-y-3 p-4">
                    <textarea
                      value={goal()}
                      onInput={(event) => setGoal(event.currentTarget.value)}
                      placeholder={
                        "Build the project, test it, preview it, and iterate until it is ready.\nAdd more tasks on new lines when needed."
                      }
                      class="h-32 w-full resize-none rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-13-medium leading-6 text-text-base outline-none transition-colors placeholder:text-text-weak focus:border-border-weak-base"
                    />
                    <ProgressSummary />
                  </div>
                </div>
                <TaskBreakdown />
                <PlanList />
              </div>

              <div class="grid content-start gap-4">
                <RunSetup />
                <QueueCard />
                <ActivityPreview />
              </div>
            </div>
          </div>
        }
      >
        <div class="flex min-h-full flex-col gap-4">
          <div class="rounded-[22px] border border-border-weaker-base bg-[linear-gradient(135deg,rgba(9,12,20,0.98),rgba(14,20,33,0.96))] px-5 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <div class="flex size-12 shrink-0 items-center justify-center rounded-[16px] border border-blue-500/30 bg-blue-500/10 text-blue-300">
                  <Icon name="checklist" class="size-5" />
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-20-bold text-text-base">Autopilot run</div>
                    <Show when={run()}>
                      {(current) => (
                        <span class={`rounded-full border px-2 py-1 text-11-medium ${runStatusClass()}`}>
                          {current().status}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={run()}>
                    {(current) => (
                      <div class="mt-1 truncate text-12-medium text-text-weak">
                        Started {new Date(current().createdAt).toLocaleString()} / Run ID: {current().runID}
                      </div>
                    )}
                  </Show>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="ghost" class="h-10 gap-2 px-3 text-12-medium" onClick={() => setView("plan")}>
                  <Icon name="arrow-left" class="size-4" />
                  Back to plan
                </Button>
                <Button
                  variant="ghost"
                  class="h-10 gap-2 border-red-500/25 px-3 text-12-medium text-red-300 hover:bg-red-500/10"
                  disabled={!run() || run()?.status === "stopped" || run()?.status === "completed"}
                  onClick={() => changeStatus("stopped")}
                >
                  <Icon name="stop" class="size-3.5" />
                  Stop run
                </Button>
              </div>
            </div>
            <div class="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
              <div class="min-w-0 rounded-[16px] border border-border-weaker-base bg-background-base/60 px-4 py-3">
                <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Current objective</div>
                <div class="mt-1 line-clamp-2 text-13-medium leading-6 text-text-base">{run()?.goal ?? goal()}</div>
              </div>
              <div class="rounded-[16px] border border-border-weaker-base bg-background-base/60 px-4 py-3">
                <div class="flex items-center justify-between text-11-medium text-text-weak">
                  <span>Plan progress</span>
                  <span>{progress().percent}%</span>
                </div>
                <div class="mt-3 h-2 overflow-hidden rounded-full bg-background-base">
                  <div class="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${progress().percent}%` }} />
                </div>
                <div class="mt-2 text-11-medium text-text-weak">
                  {progress().complete} of {progress().total} steps
                </div>
              </div>
            </div>
          </div>
          <RunSwitcher />

          <LiveRunStatus />

          <TemplateSelectionCard />

          <QueueCard />

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <ActivityTimeline />
            <ActivityDetails />
          </div>
        </div>
      </Show>
    </div>
  )
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const trimWorkerText = (value: string, max = MAX_WORKER_TEXT) => {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[Autopilot worker output truncated.]`
}

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string) => {
  let timer: number | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer)
  })
}

const workerResponseSettled = (
  messages: Message[],
  partsByMessage: Record<string, Part[] | undefined>,
  assistantCountBefore: number,
) => {
  const assistantMessages = messages.filter((message) => message.role === "assistant").slice(assistantCountBefore)
  if (!assistantMessages.length) return false
  const parts = assistantMessages.flatMap((message) => partsByMessage[message.id] ?? [])
  if (!parts.length) return false
  if (parts.some((part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"))) {
    return false
  }
  if (parts.some((part) => part.type === "step-finish")) return true
  return parts.some((part) => (part.type === "text" || part.type === "reasoning") && part.text.trim() && part.time?.end)
}

const errorText = (err: unknown) => {
  const message = paddieApiErrorMessage(err)
  if (!(err instanceof Error) || !err.stack) return message
  return `${message}\n${err.stack}`.trim()
}
