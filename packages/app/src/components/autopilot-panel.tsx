import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  addAutopilotEvent,
  autopilotContextFromRun,
  autopilotWorkerPrompt,
  createAutopilotRun,
  formatAutopilotModel,
  transitionAutopilotRun,
  type AutopilotRun,
  type AutopilotRunStatus,
} from "@/autopilot/helpers"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"

export function AutopilotPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const sdk = useSDK()
  const local = useLocal()
  const prompt = usePrompt()
  const [goal, setGoal] = createSignal("")
  const [run, setRun] = createSignal<AutopilotRun>()

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
  const status = createMemo(() => {
    const current = run()
    if (!current) return "Ready to start a scoped Autopilot run."
    if (current.status === "paused") return "Paused. Resume when the worker should continue."
    if (current.status === "stopped") return "Stopped. Start a new run to continue."
    return "Running. The worker handoff is attached through normal chat context."
  })

  const focus = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const promptText = () => prompt.current().map((part) => ("content" in part ? part.content : "")).join("")

  const attach = (current: AutopilotRun) => {
    const next = addAutopilotEvent(current, {
      source: "paddie",
      title: "Worker task attached to chat",
      body: "The Autopilot run was added as transient context for the existing chat/code-builder path.",
      at: new Date().toISOString(),
    })
    setRun(next)
    for (const item of prompt.context.items()) {
      if (item.type === "autopilot" && item.runID === next.runID) prompt.context.remove(item.key)
    }
    const context = autopilotContextFromRun(next)
    prompt.context.add({
      type: "autopilot",
      ...context,
    })
    if (!promptText().trim()) {
      const text = autopilotWorkerPrompt(context)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    }
    focus()
    showToast({
      title: "Autopilot added to chat",
      description: "Submit the prompt to start the worker loop.",
    })
  }

  const start = () => {
    try {
      const next = createAutopilotRun({
        goal: goal(),
        workspace: sdk.directory,
        agent: agent(),
        model: model(),
      })
      setGoal(next.goal)
      attach(next)
    } catch (err) {
      showToast({
        variant: "error",
        title: "Could not start Autopilot",
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const changeStatus = (nextStatus: AutopilotRunStatus) => {
    const current = run()
    if (!current) return
    setRun(transitionAutopilotRun(current, nextStatus))
  }

  const ownerClass = (owner: string) => {
    if (owner === "openclaw") return "bg-blue-500/12 text-blue-300 border-blue-500/25"
    if (owner === "opencode") return "bg-emerald-500/12 text-emerald-300 border-emerald-500/25"
    return "bg-yellow-500/12 text-yellow-300 border-yellow-500/25"
  }

  return (
    <div class="min-h-full w-full bg-background-base">
      <div class="flex min-h-full flex-col gap-3">
        <div class="rounded-[20px] border border-border-weaker-base bg-surface-base px-4 py-4">
          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-w-0">
              <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Autopilot</div>
              <textarea
                value={goal()}
                onInput={(event) => setGoal(event.currentTarget.value)}
                placeholder="Build the project, test it, preview it, and iterate until it is ready."
                class="mt-2 h-28 w-full resize-none rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-13-medium text-text-base outline-none transition-colors placeholder:text-text-weak focus:border-border-weak-base"
              />
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <Button class="h-9 px-3 text-12-medium" disabled={!goal().trim()} onClick={start}>
                  Start Autopilot
                </Button>
                <Button
                  variant="ghost"
                  class="h-9 px-3 text-12-medium"
                  disabled={!run()}
                  onClick={() => {
                    const current = run()
                    if (current) attach(current)
                  }}
                >
                  Attach current run
                </Button>
                <Button
                  variant="ghost"
                  class="h-9 px-3 text-12-medium"
                  disabled={!run() || run()?.status !== "running"}
                  onClick={() => changeStatus("paused")}
                >
                  Pause
                </Button>
                <Button
                  variant="ghost"
                  class="h-9 px-3 text-12-medium"
                  disabled={!run() || run()?.status !== "paused"}
                  onClick={() => changeStatus("running")}
                >
                  Resume
                </Button>
                <Button
                  variant="ghost"
                  class="h-9 px-3 text-12-medium"
                  disabled={!run() || run()?.status === "stopped"}
                  onClick={() => changeStatus("stopped")}
                >
                  Stop
                </Button>
              </div>
            </div>
            <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
              <div class="flex items-center gap-2">
                <Icon name="brain" class="size-4 text-icon-info-base" />
                <div class="min-w-0 text-13-medium text-text-base">Connected model</div>
              </div>
              <div class="mt-3 space-y-2 text-12-medium text-text-weak">
                <div class="flex items-center justify-between gap-3">
                  <span>Agent</span>
                  <span class="min-w-0 truncate text-text-base">{agent() ?? "None"}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Model</span>
                  <span class="min-w-0 truncate text-text-base">{formatAutopilotModel(model())}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>Workspace</span>
                  <span class="min-w-0 truncate text-text-base">{sdk.directory}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="mt-3 flex items-center gap-2 rounded-xl border border-border-weaker-base bg-background-base px-3 py-2">
            <div
              class={`size-2 rounded-full ${
                run()?.status === "running"
                  ? "bg-icon-success-base"
                  : run()?.status === "paused"
                    ? "bg-yellow-400"
                    : run()?.status === "stopped"
                      ? "bg-text-weak"
                      : "bg-icon-info-base"
              }`}
            />
            <div class="min-w-0 flex-1 truncate text-12-medium text-text-weak">{status()}</div>
          </div>
        </div>

        <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div class="min-h-0 overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)]">
            <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
              <div class="size-2 rounded-full bg-[#f87171]" />
              <div class="size-2 rounded-full bg-[#fbbf24]" />
              <div class="size-2 rounded-full bg-[#34d399]" />
              <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                Autopilot planner
              </div>
            </div>
            <div class="h-[560px] overflow-auto bg-background-stronger p-4">
              <Show
                when={run()}
                fallback={
                  <div class="size-full rounded-[18px] border border-border-weaker-base bg-background-base flex items-center justify-center text-13-medium text-text-weak">
                    No run started
                  </div>
                }
              >
                {(current) => (
                  <div class="grid gap-3">
                    <For each={current().plan}>
                      {(step, index) => (
                        <div class="rounded-[16px] border border-border-weaker-base bg-background-base p-3">
                          <div class="flex items-start gap-3">
                            <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border-weaker-base bg-surface-base text-11-medium text-text-base">
                              {index() + 1}
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center gap-2">
                                <div class="text-13-medium text-text-base">{step.title}</div>
                                <span class={`rounded-full border px-2 py-0.5 text-10-medium ${ownerClass(step.owner)}`}>
                                  {step.owner}
                                </span>
                                <span class="rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                                  {step.status}
                                </span>
                              </div>
                              <div class="mt-1 text-12-medium text-text-weak">{step.description}</div>
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

          <div class="min-h-0 overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)]">
            <div class="h-10 shrink-0 border-b border-border-weaker-base bg-[#111218] flex items-center gap-2 px-4">
              <Icon name="task" class="size-4 text-icon-info-base" />
              <div class="min-w-0 flex-1 text-center text-11-medium text-text-weak truncate">
                Two-way timeline
              </div>
            </div>
            <div class="h-[560px] overflow-auto bg-background-stronger p-3">
              <Show
                when={run()}
                fallback={
                  <div class="size-full rounded-[18px] border border-border-weaker-base bg-background-base flex items-center justify-center text-13-medium text-text-weak">
                    No events yet
                  </div>
                }
              >
                {(current) => (
                  <div class="grid gap-2">
                    <For each={current().events}>
                      {(event) => (
                        <div class="rounded-[14px] border border-border-weaker-base bg-background-base p-3">
                          <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0 truncate text-12-medium text-text-base">{event.title}</div>
                            <span class="shrink-0 rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                              {event.source}
                            </span>
                          </div>
                          <div class="mt-1 text-11-medium text-text-weak">{event.body}</div>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
