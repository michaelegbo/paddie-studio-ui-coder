# Paddie Upstream-Safe Development Guidelines

Paddie Studio is built on top of upstream opencode. We still need to keep pulling fixes, architecture changes, provider updates, SDK changes, and UI improvements from upstream. That means Paddie-specific work must be implemented in a way that keeps upstream merges practical.

These guidelines apply to Paddie Studio features, including Studio, Templates, Inspiration, Workflow Builder, Paddie Native Autopilot, desktop packaging, and any Paddie-specific chat/code-builder behavior.

## Core Principle

Build Paddie features as additive layers around upstream behavior whenever possible.

Do not replace or rewrite upstream chat, session, provider, tool, or code-builder behavior unless there is no stable boundary available and the change is deliberately reviewed as an upstream-adjacent change.

The normal Paddie Chat and normal code-builder flows must continue to work when a Paddie feature is disabled, unavailable, or not being used.

Branch and release policy is covered separately in `specs/paddie-branch-release-policy.md`. In short: follow upstream opencode by using `dev` as the default development branch and versioned releases/tags as stable outputs.

## Why This Matters

Upstream opencode continues to move quickly. It provides core fixes and improvements for:

- provider/model handling
- session and prompt processing
- SDK/OpenAPI contracts
- tool execution and permissions
- app UI correctness
- desktop/server behavior
- tests and runtime architecture

If Paddie changes are spread through upstream-owned code paths, every upstream sync becomes harder, riskier, and slower. Isolated adapters and extension boundaries let us keep Paddie features while still benefiting from upstream.

## Required Implementation Shape

Prefer this shape:

```text
Upstream opencode behavior
  ^
  | stable API / CLI / Gateway / session / tool boundary
  v
Paddie-owned adapter or feature module
  ^
  | explicit UI state and user action
  v
Paddie Studio feature surface
```

Avoid this shape:

```text
Upstream core behavior with hidden Paddie conditionals scattered throughout
```

## Paddie Native Autopilot

Autopilot must be optional and isolated.

Paddie Native Autopilot uses opencode's existing agentic runtime as the harness. Paddie should provide a thin controller that connects a dedicated opencode worker session to:

- the active Paddie workspace
- the selected Paddie-connected model/provider
- opencode sessions, prompt processing, shell/tool execution, permissions, status, and message events
- Paddie templates and workflow builder context
- browser preview/testing
- approvals
- logs and artifacts
- stop, pause, and resume controls

The controller is not a second model or credential system. The intelligence comes from the selected Paddie/opencode provider, model, agent, and variant. The controller should route events, enforce boundaries, persist logs, and expose Paddie capabilities safely.

Autopilot should create or reuse its own scoped opencode worker session for execution and receive structured results back through opencode events. It must not type into or submit the normal chat composer to start a run. Attaching an Autopilot run to normal chat is optional discussion context only.

Autopilot may parse Paddie-specific progress markers from its own scoped worker session, such as task start/done/blocked markers and final handoff summaries. Those markers are an Autopilot presentation contract only; they must not change normal opencode chat message handling.

Autopilot may run multiple native sessions at once when the user selects multiple codebases. Each run must keep its own workspace, worker session, activity timeline, and handoff. Cross-codebase runs must use explicit user-selected targets and must not broaden normal chat or code-builder scope.

## Existing Chat And Code Builder Must Stay Stable

Any Paddie feature must preserve these guarantees:

- Normal chat works when the feature is disabled.
- Normal code-builder behavior works when the feature is disabled.
- Existing Studio tabs render independently of optional feature runtime status.
- Existing prompt context behavior is not changed unless the user explicitly attaches new context.
- Feature state does not leak into unrelated sessions or chats.
- Tool permissions and approval behavior do not become broader by default.

If a feature needs to interact with chat, follow existing explicit-context patterns such as templates, inspiration references, or workflow context. Make the attached context visible, scoped, and removable.

## Existing And Connected Projects

Paddie features must support existing projects, not just new projects.

When operating on an existing or connected project:

- scope all file operations to the selected workspace
- preserve existing project settings unless the user approves changes
- detect existing package scripts/framework metadata instead of assuming a blank app
- store run logs and artifacts against the selected project
- show which project/workspace will be affected before autonomous work starts

## Upstream-Safe Coding Rules

- Prefer Paddie-owned modules for Paddie behavior.
- Prefer adapters over edits to upstream core files.
- Prefer existing API, SDK, CLI, Gateway, session, event, or tool boundaries.
- Keep upstream-adjacent changes small and clearly named.
- Avoid hidden global flags that alter normal upstream behavior.
- Avoid changing default chat/session semantics for a Paddie-only feature.
- Do not duplicate upstream provider/model credential systems.
- Do not fork large upstream modules just to add a small Paddie behavior.
- Document each integration point when a Paddie feature depends on an upstream boundary.
- Add regression tests around any touched upstream-adjacent path.

## When Touching Upstream-Owned Code Is Allowed

Sometimes an upstream-owned file must be touched. That is acceptable only when:

- there is no existing stable boundary for the feature
- the change is minimal and easy to rebase
- the Paddie-specific behavior is named clearly
- normal upstream behavior remains the default
- tests cover both normal behavior and Paddie behavior
- the reason is documented in the issue, PR, or nearby code when non-obvious

## Feature Flags And Failure Modes

Optional Paddie features should fail closed and leave normal behavior intact.

For features such as Autopilot:

- app startup must not require Autopilot
- missing optional Studio resources should show setup/status UI, not break Studio
- disabled feature flags should remove or disable only the feature surface
- failed feature runtimes should not block normal chat/code builder
- stop/pause/cancel must be respected before the next autonomous action

## Review Checklist

Before merging Paddie-specific work, verify:

- The change is additive or isolated behind a clear boundary.
- Normal chat still works.
- Normal code builder still works.
- Existing project workflows still work.
- The feature can be disabled or ignored.
- Upstream-owned files were not changed unnecessarily.
- Any upstream-adjacent changes are small and tested.
- Model/provider credentials are reused, not duplicated.
- Workspace boundaries and approvals are enforced.
- Tests were run from the relevant package directory, not repo root.

## GitHub Planning Links

For Autopilot work, keep these issues aligned with implementation. The active implementation direction is Paddie Native Autopilot over opencode's native session/tool runtime:

- #28 Autopilot orchestration epic
- #38 Two-way Autopilot/opencode agent communication
- #39 Define Paddie Autopilot adapter architecture
- #40 Keep Autopilot optional and isolated from normal chat/code builder
- #42 Route Autopilot through existing Paddie chat and code-builder systems
- #43 Keep Autopilot/opencode integration upstream-safe
- #44 Support Autopilot on existing and connected projects
