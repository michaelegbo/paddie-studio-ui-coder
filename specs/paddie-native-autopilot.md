# Paddie Native Autopilot

Paddie Native Autopilot is an additive Studio feature that plans, builds, tests, previews, and iterates by using opencode's native session and tool runtime. It is not a separate CLI runtime and it does not introduce a second credential store.

## Architecture

```text
Studio Autopilot panel
  -> Paddie Native Autopilot controller
  -> scoped opencode worker session
  -> selected opencode agent/model/provider/variant
  -> opencode tools, shell execution, permissions, status, messages
  -> Paddie template, workflow, and preview adapters
```

The controller owns UI state, run state, Studio resource lookup, and activity formatting. opencode owns the agentic execution harness: sessions, prompts, shell/tool calls, task/subagent behavior, permissions, provider credentials, model routing, message parts, and session status.

## Runtime Rules

- Use the currently selected Paddie/opencode provider, model, agent, and variant.
- Create a scoped worker session for each selected workspace before execution.
- Allow the user to run against the current codebase, another opened/selected codebase, or multiple codebases in parallel.
- Keep every Autopilot run tied to its own workspace, worker session, activity timeline, task queue, and final handoff.
- Do not type into or submit the normal chat composer to start a run.
- Let normal chat attach an Autopilot run only as visible optional context for discussion.
- Keep run state scoped to the active workspace.
- Treat templates, workflows, preview detection, and browser checks as Paddie-owned adapters around opencode.
- Respect opencode permissions and add Paddie-level approval gates for destructive or external actions.

## Run Loop

1. Plan: submit a planning prompt to the scoped worker and require an ordered plan before implementation.
2. Gather context: load workspace state, scripts, template catalog, workflow catalog, and visible constraints.
3. Choose tools: let the selected model choose template, workflow, code, command, and preview actions.
4. Execute: submit a focused implementation prompt into the same worker session.
5. Verify: run available install, test, typecheck, lint, build, and preview checks through opencode tools.
6. Preview: detect local preview URLs from session/tool output and static project structure where available.
7. Iterate: feed failures back into the worker until checks pass, the user stops the run, or retry limits are hit.
8. Summarize: show changed files, commands, check results, preview details, artifacts, and remaining risks.

## Task Breakdown And Handoff

Autopilot keeps a single overall goal for the run, then maintains a concrete task queue underneath it. The initial user input can include explicit line/semicolon/then-separated tasks, and the planning pass can expand a broad goal by returning a `PADDIE_TASK_QUEUE` block. The UI should show both the overall goal and task-level status so users can see what is active, done, pending, or blocked.

When multiple codebases are selected, Autopilot creates one native run per codebase. Each run shares the same high-level user goal but plans, executes, verifies, and summarizes inside its own selected workspace. The user can switch between active runs from the Studio Autopilot surface and open the corresponding scoped worker chat for any run.

The scoped opencode worker is expected to emit lightweight progress markers while it works:

- `PADDIE_TASK_START: <number>`
- `PADDIE_TASK_DONE: <number>`
- `PADDIE_TASK_BLOCKED: <number> - <reason>`
- `PADDIE_AUTOPILOT_PHASE: <phase>`

At the end of verification, the worker must hand results back to Autopilot with a `PADDIE_AUTOPILOT_HANDOFF` block covering outcome, changed files, commands/checks, preview status, and remaining risks. Autopilot displays that handoff as its own result event before marking the run complete.

## Safety Boundaries

Autopilot must ask for explicit approval before destructive file operations, git push/release/deploy, credential use, payments, external messages, publishing, or actions outside the selected workspace.

Normal chat, normal code-builder flows, provider configuration, and upstream opencode behavior must work unchanged when Autopilot is disabled or unused.
