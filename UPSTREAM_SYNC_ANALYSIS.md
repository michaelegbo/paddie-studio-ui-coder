# Upstream Sync Analysis

Date: 2026-05-20

## Current State

| Item | Value |
| --- | --- |
| Local comparison base | `988c9894f21cf6d9688cad37667b668139be8820` |
| Paddie remote branch | `origin/dev` |
| Upstream branch | `upstream/dev` / `anomalyco/opencode:dev` |
| Current upstream head checked | `66d409d67` |
| GitHub fork counter before this port | Paddie was 7 commits ahead and 2209 commits behind upstream |
| Why the counter still shows behind | The previous "sync" was a local/ported commit, not a real merge or rebase of upstream history |
| Safe implementation shape | Create a fresh branch from `upstream/dev`, then reapply Paddie work in controlled groups |

The direct merge simulation is conflict-heavy. `git merge-tree origin/dev upstream/dev` reports conflicts across app, desktop, opencode core, SDK/OpenAPI, package manifests, and docs. This confirms we should not click GitHub "Sync fork" or do a blind merge.

## Upstream Feature Gains

| Upstream area | What upstream has that is better/newer | Relevant commits/examples | Recommendation |
| --- | --- | --- | --- |
| Core runtime architecture | Effect-native event/runtime paths, RuntimeFlags, fewer legacy instance fallbacks, typed error boundaries, cleaner process/file abstractions | `Add Effect-native core event system (#27415)`, many `refactor(flags)`, `effect(server)`, `effect(worktree)` commits | Use upstream as source of truth |
| Session/agent/prompt engine | More tested session processor, typed busy/session errors, interrupted assistant finalization, message read wrappers, prompt tool extraction, reminder extraction | `fix(session): finalize interrupted assistant messages`, `refactor(session): extract prompt tool resolution`, `fix(session): tighten http error contracts` | Use upstream as source of truth |
| Follow-up behavior | Upstream migrates `queue` to `steer` and prevents queue-by-default behavior from returning through settings | `packages/app/src/context/settings.tsx` in upstream coerces `queue` to `steer` | Prefer upstream; do not keep Paddie queue-by-default unless redesigned later |
| HTTP API / SDK / OpenAPI | Public v2 error schemas, preserved OpenAPI errors, v2 model listing, generated SDK updates | `feat(httpapi): add v2 public error schemas`, `core: expose v2 model listing API` | Use upstream; regenerate JS SDK if contracts change |
| Provider/model handling | Better auth/model errors, model suggestions, native LLM preview path, Anthropic API-key routing through native runtime, models snapshot from core | `Preview native LLM runtime stack`, `fix(provider): restore model suggestions`, `Load models.dev snapshot from build global` | Use upstream, then reapply only Paddie model filtering if still needed |
| TUI and CLI | OpenTUI upgrades, syntax highlighting, pinned session switching, prompt paste fixes, TUI notifications/sounds, CLI subprocess regression coverage | `upgrade opentui`, `feat(tui): enable pinned session switching`, `run: replay session history` | Use upstream |
| App performance/UI correctness | Session timeline virtualization, provider query invalidation, question dock overflow fixes, session sorting fixes, prompt streaming markdown fixes | `perf(app): virtualize session timeline rows`, `fix(ui): fix question dock overflow`, `fix(app): invalidate provider queries` | Use upstream, then reapply Studio integrations carefully |
| Desktop upstream track | Upstream moved toward Electron desktop work: utility process server, Electron package consolidation, update/install fixes, Linux menu behavior | `refactor(desktop): consolidate desktop-electron into desktop package`, `feat(desktop): move server to utilityProcess` | Do not adopt as-is; conflicts with Paddie Tauri |
| Tests | Large migration to Effect-backed tests, CLI subprocess harnesses, HTTP API exercise tests, config fixture migration | many `test(...)`, `Migrate ... fixtures`, `Run CLI subprocess tests concurrently` | Use upstream test structure, keep/add focused Paddie tests |
| Internationalization/docs | Ukrainian locale and translated docs refreshes | `feat(i18n): add Ukrainian (uk) locale support` | Use upstream unless Paddie docs intentionally replace them |
| Console / Go / Zen | Referral support, billing/usage updates, rate limiter work, Go UI changes | `feat(go): referral support`, `chore(go): referral improvements` | Usually use upstream if we keep console packages; low priority for desktop-only release |

## Full Upstream Feature Inventory

This is a feature-level inventory of the upstream changes since our fork point. It is not a commit list. Small bug fixes, chores, generated-file updates, and tests are grouped under the user-facing or engineering capability they support.

### Core, Agent, Session, And Runtime

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Effect-native runtime | Runtime services for app process, filesystem, sync events, background jobs, runtime flags, and event bus behavior | Paddie still carries older inherited runtime plus some local app hooks | Keep upstream |
| RuntimeFlags system | Moves feature/runtime switches out of scattered globals into typed runtime flags | Paddie has beta/studio UI flags, but not the full upstream runtime refactor | Keep upstream, re-add Paddie UI flag separately |
| Typed error model | Typed auth, provider, session, storage, busy, validation, and HTTP errors instead of loose thrown objects | Paddie has older error handling plus local desktop/app fixes | Keep upstream |
| Effect Schema migration | Moves validation away from Zod/internal Zod bridges toward Effect Schema | Paddie inherited older generated/schema code | Keep upstream |
| Event system | Versioned event keys, explicit LLM lifecycle events, SyncEvent service, and safer event projection | Paddie needs events for Studio/chat but should not own core event semantics | Keep upstream |
| Session processor improvements | Better prompt tool resolution, reminder extraction, message reads, busy-state mapping, and cancellation/finalization behavior | Paddie has prompt context additions that touch request building | Keep upstream processor, reapply Paddie context at boundary |
| Session compaction | Better compaction tail handling, legacy summary compatibility, and timestamp/usage preservation | Paddie does not intentionally change compaction | Keep upstream |
| Session fork / warp | Full session fork fixes, session warping, copy file changes when warping, external workspace creation | Paddie Studio/workbench may benefit from workspace/session correctness | Keep upstream |
| Background subagents | Experimental background subagent support and background job foundation | Paddie did not add separate subagent engine | Keep upstream unless unstable behind upstream flags |
| Scout/repo research | Built-in scout agent, configured reference repo materialization, configured mention autocomplete | Paddie has inspiration/workflow context, not the same repo-reference system | Keep upstream; integrate later if useful |
| Tool registry hardening | Custom tool metadata/args handling, plugin tool attachment preservation, shell truncation fixes, read/write/glob/grep/apply_patch Effect migrations | Paddie does not need custom behavior here | Keep upstream |
| Shell and command execution | Shell-aware prompts for bash/pwsh/cmd, configurable truncation, safer subprocess handling, signal forwarding, non-interactive exit fixes | Paddie terminal panel relies on shell behavior but should not override it | Keep upstream |
| Permissions/security | Permission ordering fixes, subagent deny-rule inheritance, external directory permission checks, task self-permission preservation | Paddie has no better local implementation | Keep upstream |
| Worktree/project handling | Detached worktrees by default, worktree expected-error typing, better worktree cleanup, smarter names, project cache fixes | Paddie Studio project/template flow depends on project correctness | Keep upstream |
| File/reference handling | File reference fixes, repository cache, configured reference contracts, file context improvements and disable options | Paddie preview/workbench uses files but does not own core file semantics | Keep upstream |
| LSP/editor context | Roslyn/C# support, pull diagnostics, LSP runtime flags, editor context reconnects, Zed context polling/selection support | Paddie does not conflict except UI surfaces | Keep upstream |
| Storage/data migrations | Workspace time migration, legacy numeric/session schemas, traceable data migrations | Paddie should not keep older storage behavior | Keep upstream |

### HTTP API, SDK, And Server

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Native HttpApi server | Bun.serve-backed native HTTP API listener with websocket upgrade support | Paddie desktop sidecar talks to server; no better local server | Keep upstream |
| Route bridge expansion | Bridges workspace, worktree, project, config, catalog, file read/search, sync, session lifecycle/read/mutation, pty, event stream, MCP, tool, and TUI routes | Paddie Studio uses server APIs and should use the current contract | Keep upstream |
| OpenAPI parity | Server OpenAPI generation, parity checks, parameter/query/body shape fixes | Paddie generated SDK must match this | Keep upstream and regenerate SDK |
| Public v2 error schemas | Structured public errors for v2 HTTP API | Paddie may currently assume older wrapped errors | Keep upstream, adapt callers |
| SDK error handling | Real error surfacing, SDK-wrapped error unwrapping, thrown error body wrapping | Paddie app benefits from clearer errors | Keep upstream |
| PTY websockets | Authenticated PTY websocket tickets and desktop PTY support through HttpApi | Paddie terminal/desktop panel depends on PTY stability | Keep upstream and retest terminal |
| Auth and CORS | Basic auth challenge, username option, server auth respect, CORS middleware and CSP fixes | Paddie desktop auth bridge may touch this | Keep upstream, preserve Paddie auth bridge only if still needed |
| Response compression | HTTP API response compression | No Paddie overlap | Keep upstream |
| Embedded UI serving | Embedded UI from BunFS, public manifest asset support, CSP allowance fixes | Paddie desktop packaging needs to verify this | Keep upstream unless it breaks Tauri assets |
| Server diagnostics | Structured validation errors, diagnosable schema rejections, safer unknown 500 handling | No better local implementation | Keep upstream |
| V2 model listing | Core-backed v2 model listing API | Paddie model filtering may need to plug into this | Keep upstream, reapply Paddie filtering if needed |

### Provider, LLM, Models, And AI Behavior

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Native LLM runtime | Native LLM foundation and preview runtime stack | Paddie did not build this separately | Keep upstream |
| Anthropic native API-key route | Routes Anthropic API-key models through native runtime | No Paddie conflict expected | Keep upstream |
| Native LLM token/auth preference | Prefers console opencode token where needed | Paddie auth may differ but core provider behavior should be upstream | Keep upstream |
| Provider/model typed errors | Typed auth/model-not-found/init errors, safer model suggestions | Paddie has model filtering concerns only | Keep upstream |
| Provider options fixes | Anthropic, Bedrock, OpenAI-compatible, Azure, Gemini, Google Vertex, DeepSeek, Moonshot, Mistral, OpenRouter, LiteLLM, Cloudflare AI gateway fixes | Paddie should benefit directly | Keep upstream |
| Model variants/reasoning | GPT-5 reasoning variants, Claude/Opus efforts, DeepSeek thinking, Mistral reasoning, Kimi/K2.6 limits, small-model fallback controls | Paddie model list may hide/show models | Keep upstream, then apply Paddie product filtering |
| Model pricing/cost | Updated pricing schema and session usage totals | Paddie may show usage later | Keep upstream |
| Model snapshot | Models snapshot moved into core/build global | Paddie should not keep older snapshot wiring | Keep upstream |
| LLM cache policy | Auto cache placement, TTL hints, breakpoint cap, and tool placement | No Paddie conflict expected | Keep upstream |
| LLM stream lifecycle | Explicit stream lifecycle events | Paddie Studio/chat may benefit | Keep upstream |
| Tool/image attachments | Preserves tool image attachments and rejects unsupported image formats | Paddie may attach preview/context images later | Keep upstream |
| Image handling | Auto-resize and max image constraints, image resizer wasm fixes | Paddie not better here | Keep upstream |
| Web search | Parallel websearch provider rollout and provider label fixes | No Paddie conflict expected | Keep upstream |
| DigitalOcean provider | DigitalOcean OAuth and inference routers | No Paddie conflict expected | Keep upstream |
| NVIDIA provider | NVIDIA popular provider entry, docs, and origin headers | No Paddie conflict expected | Keep upstream |
| MCP handling | MCP OAuth/status/control routes, schema/output tolerance, auth handling | Paddie desktop may show MCP state later | Keep upstream |

### App UI And Web Client

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Session timeline virtualization | Faster timeline rendering and smoke coverage | Paddie modifies session panel for Studio | Start with upstream, reapply Studio panel |
| Message rendering | Streaming markdown cutoff fixes, patch/edit rendering fixes, reasoning renderer guards, markdown tables, KaTeX SVG preservation | Paddie does not have a better renderer | Keep upstream |
| Prompt input behavior | Shell mode UI, prompt history fixes, paste layout refresh, multiline mentions, placeholder fixes, concurrent submit guards | Paddie adds workflow/template context attachments | Use upstream prompt behavior, reapply Paddie attachments |
| Question/follow-up UI | Question dock overflow/layout fixes; follow-up settings default/migration to steer | Paddie local setting still allows queue | Use upstream steer behavior |
| Todo dock | Persist collapsed state | No Paddie conflict expected | Keep upstream |
| Project switching | Ctrl/Cmd-number project switching, better close-next behavior, keyed project layout fixes | Paddie Studio adds project/template entrypoints | Keep upstream and reapply Paddie entrypoints |
| Project icons | Project icon override field, localStorage preservation, fallback avatar handling | Paddie has branding/icons but not better project icon logic | Keep upstream |
| Model picker/session model state | Remember selected model variant across sessions/projects; conditional model variant selector | Paddie model filtering may need adaptation | Keep upstream |
| Provider settings refresh | Custom providers show immediately after config update | No Paddie conflict expected | Keep upstream |
| Loading/server status | Better loading states, ready getters fix, bootstrap error suppression, session status busy state | Paddie desktop startup has local fixes | Keep upstream and retest startup |
| Terminal UI | Terminal font settings and built-in Nerd Font, terminal recovery loop fix, desktop PTY fixes | Paddie terminal panel exists | Keep upstream terminal fixes |
| Desktop titlebar settings | Hide desktop titlebar tools behind settings, beta/dev badge, Windows zoom stabilization | Paddie adds Studio button/titlebar branding | Reconcile carefully |
| Settings UI | Progress bar toggle, shell selection, terminal font, titlebar tool visibility, follow-up behavior settings | Paddie adds beta/studio toggle | Keep upstream settings, add Paddie toggle |
| File tree / workspace UI | File tree gating, workspace loading/persist readiness, layout polish | Paddie has workbench file tree/editor | Reconcile carefully |
| PWA/browser polish | PWA status bar theme color, clipboard fallback | No Paddie conflict expected | Keep upstream |
| Error formatting | Better SDK error formatting in app | No Paddie conflict expected | Keep upstream |

### TUI And CLI

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| OpenTUI upgrades | Multiple OpenTUI upgrades through 0.2.x | Paddie should not pin older TUI | Keep upstream |
| Keymap engine | Keymap as sole key/cmd engine, fallback priority, legacy PgUp/PgDown aliases | No Paddie conflict expected | Keep upstream |
| Pinned sessions | Pin, quick-switch, cycle recent sessions; pinned-only switching fixes | No Paddie conflict expected | Keep upstream |
| Thinking mode | Minimal thinking mode and toggle defaults | Paddie does not override TUI | Keep upstream |
| Prompt behavior | Paste summary, prompt history, editable shell mode, wide-character cursor math | No Paddie conflict expected | Keep upstream |
| Dialog prompt | Dialog prompt submit keybind and event sink | No Paddie conflict expected | Keep upstream |
| Notifications/sounds | TUI notifications and attention sounds, logo sound removal | No Paddie conflict expected | Keep upstream |
| Zed/editor integration | Builtin protocol context, Zed context polling/selection/terminal focus improvements | No Paddie conflict expected | Keep upstream |
| Session replay/run | Replay session history on interactive resume, split-footer mode, JSON draining, non-interactive exit behavior | Paddie CLI sidecar should benefit | Keep upstream |
| CLI commands | Effect command wrappers, instance lifecycle disposal, debug/startup/debug info commands | No Paddie conflict expected | Keep upstream |
| Custom themes | Invalid theme handling and truecolor rendering fixes | No Paddie conflict expected | Keep upstream |
| Syntax highlighting | Added languages: elixir, fsharp, r, make, vim, xml, agda | No Paddie conflict expected | Keep upstream |

### Desktop Packaging

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Electron consolidation | Upstream consolidates `desktop-electron` into `packages/desktop` | Directly conflicts with Paddie Tauri | Do not adopt as-is |
| Electron utility process | Desktop server moved to Electron utilityProcess | Directly conflicts with Tauri sidecar model | Do not adopt as-is |
| Electron update/install fixes | Silent install, user-wide scope, relaunch fixes, disable auto-install-on-quit | Paddie has Tauri updater and NSIS flow | Port concepts only if applicable |
| Desktop security | Electron context isolation/sandbox/custom protocol/CORS work | Mostly Electron-specific | Do not adopt unless relevant to Tauri webview |
| Desktop environment | Proxy, system certificates, login shell/env, app settings menu, Mac/Linux behavior | Some concepts may apply to Tauri | Review selectively |
| Desktop UX | Working indicator on project sidebar, notification permission, MCP client status/auth handling, free-limit dialogs | Some app-side features may still be useful | Port app-side pieces if they do not depend on Electron |
| Desktop platform metadata | Linux AppStream MetaInfo, desktop file updates, auto-hide menu bar, Windows zoom | Paddie Tauri has its own metadata/icons | Keep Paddie metadata, selectively port bugfixes |
| Sentry/onboarding/debug | Desktop Sentry integration, onboarding env, DevTools MCP debug port | Paddie release/privacy decision needed | Defer unless wanted |
| Code signing/updating | Upstream disables Windows update code signature verification in Electron path | Paddie has Tauri updater signing | Keep Paddie updater signing |

### Console, Go, Zen, Web, Billing

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Go referral system | Referral support, invite UI style, referral improvements | Paddie desktop does not depend directly | Keep upstream if console stays |
| Go/model endpoints | Go model listing endpoint, model limits/copy/rate-limit metadata | Paddie may not expose Go | Keep upstream if console stays |
| Zen rate limiting | Sticky sessions, tps/tpm rate limiting, model-specific limiters, DeepSeek/Kimi/Tencent updates | Paddie does not maintain this separately | Keep upstream |
| Console billing/usage | Billing/reload/redeem sections, usage graph changes, workspace billing updates | Low relevance to desktop | Prefer upstream unless Paddie removes console |
| Console auth | Auth session and callback changes, middleware updates, stripe webhook changes | No Paddie-specific alternative | Prefer upstream |
| Monitoring/alerts | Honeycomb/stat worker, low TPS alerts, monitoring query/noise reductions | Paddie release may not use upstream infra | Keep if infra remains; otherwise ignore |
| Web docs/download | Download asset naming, docs for Go/Zen/providers/tools/keybinds/ecosystem | Paddie docs conflict with upstream branding | Keep upstream docs only where useful; keep Paddie README |
| Internationalization | Ukrainian locale plus translation updates across app, web, console, UI | Paddie does not have better i18n | Keep upstream, then add Paddie strings |

### Build, CI, Tests, And Repo Hygiene

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Bun/toolchain | Bun upgrade to 1.3.13+, package lock refreshes, dependency layout changes | Paddie local machine had Bun 1.3.11 push-hook issue | Keep upstream toolchain |
| Oxlint | Adds oxlint correctness/suspicious/type-aware rules and fixes many warnings | Paddie code may need lint compatibility | Keep upstream, then fix Paddie additions |
| CI coverage | Typecheck/test workflows, native runners, UI unit tests, beta validation, PR cleanup automation | Paddie has desktop release workflow | Keep upstream CI basics plus Paddie release workflow |
| Release versions | Upstream release syncs through v1.15.5 | Paddie has separate v1.4.x desktop versioning | Keep upstream package logic, keep Paddie app versioning policy |
| Nix/package outputs | Electron/Nix derivations and package updates | Paddie Tauri may not need Electron derivation | Review selectively |
| Test harness | CLI subprocess harness, AppProcess/FileSystem tests, HTTP API exercise DSL, Effect test migrations | Paddie has focused Studio tests | Keep upstream tests, add Paddie tests |
| App e2e changes | Old app e2e deleted/reworked into smoke coverage | Paddie may need browser verification more than old e2e | Accept upstream, keep focused Paddie tests |
| Generated SDK/specs | OpenAPI and generated SDK files updated repeatedly | Paddie must not manually diverge | Regenerate after integration |
| Security hygiene | Vouch workflow removal, gitleaks ignore, contributor/triage workflow changes | Repo policy decision | Prefer upstream unless it conflicts with Paddie governance |

### Plugins, Skills, And Extensibility

| Feature / capability | What upstream adds or improves | Paddie overlap | Suggested decision |
| --- | --- | --- | --- |
| Plugin tool behavior | Plugin `ask` promise fix, tool attachments, custom tool metadata, invalid exports tolerance | Paddie has no better plugin system | Keep upstream |
| MCP routes/auth | MCP status/control/oauth route bridge and auth behavior | Paddie desktop may expose MCP state later | Keep upstream |
| Built-in skills | `customize-opencode` enabled by default, `opencode-meta`, architecture/effect skills | Paddie can inherit | Keep upstream unless branding requires renaming |
| Config schema | Full IntelliSense for tool permission keys, remote config support, active provider/model status | Paddie has no better config system | Keep upstream |
| Startup config | Create global `opencode.jsonc` when no config exists | Paddie users benefit | Keep upstream |

### Paddie-Specific Features Not Supplied By Upstream

| Paddie feature | Upstream equivalent? | Decision |
| --- | --- | --- |
| Studio/workbench surface | No direct upstream equivalent | Keep Paddie |
| Template/gallery flow | No direct upstream equivalent | Keep Paddie |
| Workspace preview engine including static HTML | No direct upstream equivalent | Keep Paddie |
| Workflow builder | No direct upstream equivalent | Keep Paddie |
| Inspiration references | No direct upstream equivalent | Keep Paddie |
| Paddie workflow/template context attachment | Partial overlap with prompt/context systems only | Reapply on upstream prompt system |
| Paddie Tauri desktop package | Upstream is Electron-oriented | Keep Paddie |
| Paddie updater/release workflow | Upstream release system differs | Keep Paddie |
| Paddie branding/waitlist/readme screenshots | Upstream is OpenCode branded | Keep Paddie with attribution |

## Paddie Features To Preserve

| Paddie area | What we have locally | Conflict with upstream? | Recommendation |
| --- | --- | --- | --- |
| Studio workbench | `WorkbenchPanel`, editor, workflow builder, file/workspace controls | Mostly local-only files, but route/layout/titlebar/session integration conflicts | Preserve; reapply on top of upstream app |
| Template/gallery flow | `template-panel`, template helpers, landing starter, curated parts, create-from-template flow | Mostly local-only, but home/session/titlebar/settings integration conflicts | Preserve |
| Workspace preview engine | Static HTML preview, Vite/React/Next detection, preview sizing copied from template preview behavior | Mostly local-only utility files; integration in workbench conflicts indirectly | Preserve and retest |
| Paddie workflow context | Workflow/context attachment chips and prompt submit support | Direct conflict in `prompt-input`, `submit`, `build-request-parts`, `context-items` | Reapply on upstream prompt pipeline, not the old one |
| Inspiration references | `inspiration-panel`, inspiration helpers | Local-only plus template/workflow integration | Preserve |
| Paddie auth/API bridge | `context/auth.tsx`, `lib/paddie-api.ts`, `lib/paddie-links.ts` | Local-only but route/context integration may move | Preserve if still used |
| Paddie desktop packaging | Tauri app, sidecar CLI, updater signing, beta/stable endpoints, Paddie icons, NSIS installer hooks | Direct conflict with upstream Electron desktop | Preserve Tauri; do not import upstream Electron packaging |
| Paddie release workflow | `.github/workflows/paddie-desktop-release.yml`, Tauri updater signing, beta rolling manifest | Upstream release workflows differ | Preserve Paddie workflow |
| Branding | Paddie names, icons, README screenshots, GitHub homepage/waitlist positioning | Conflicts with upstream docs/assets | Preserve Paddie branding while keeping required upstream MIT attribution |
| Beta feature toggle | Stable can hide/show Studio features; dev/beta default on | Upstream has channel/UI settings changes | Keep, but consider making Studio stable by default later if desired |

## Main Conflict Decisions

| Conflict area | Exact files/examples | Upstream position | Paddie position | Recommended decision |
| --- | --- | --- | --- | --- |
| Desktop package | `packages/desktop/*`, `packages/desktop/src-tauri/*`, `packages/desktop/electron-builder.config.ts` | Electron desktop consolidation and Electron release flow | Tauri desktop app with updater, NSIS, sidecar, Paddie app ids | Keep Paddie Tauri. Only manually port upstream desktop bugfix concepts if applicable |
| Core session/agent/runner | `packages/opencode/src/session/*`, `packages/opencode/src/effect/*`, `packages/opencode/src/server/*` | Newer, tested runtime | Old local port plus some Paddie prompt context hooks | Use upstream core. Reapply only minimal Paddie hooks at API boundaries |
| Follow-up queue/steer | `packages/app/src/context/settings.tsx`, follow-up settings UI | Force/migrate queue to steer | Local settings still allow queue | Use upstream steer behavior |
| Prompt context attachments | `packages/app/src/components/prompt-input/*`, `packages/app/src/context/prompt.tsx` | Newer prompt submit and pending request behavior | Adds Paddie workflow/template/inspiration context | Start from upstream, reapply Paddie context attachment support with tests |
| App shell/session UI | `packages/app/src/pages/session.tsx`, `message-timeline.tsx`, `titlebar.tsx`, `layout.tsx` | Timeline virtualization, session status fixes, UI bugfixes | Studio side panel, titlebar Studio button, preview/workbench routing | Use upstream app shell, reapply Studio UI in the smallest possible places |
| Settings | `packages/app/src/components/settings-general.tsx`, `packages/app/src/context/settings.tsx` | Follow-up migration, updated UI settings | Beta features toggle, Studio visibility settings | Keep upstream settings behavior plus Paddie Studio toggle |
| SDK/OpenAPI | `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/*` | New generated v2 contracts | Older generated files plus local prompt context assumptions | Use upstream, regenerate SDK, then adapt Paddie calls |
| Package manifests/lockfile | `package.json`, `bun.lock`, package `package.json` files | New dependency graph, Bun 1.3.13+, Oxlint, test deps | Paddie Tauri/dev deps and release scripts | Use upstream manifests, then add Paddie-specific deps/scripts |
| Tests | `packages/opencode/test/*`, `packages/app/e2e/*` | More current Effect/CLI/API tests | Paddie Studio/workbench focused tests | Use upstream tests and add Paddie tests back |
| Docs/readme | `README.md`, translated README files | OpenCode docs | Paddie product screenshots/copy | Keep Paddie primary docs; preserve license/attribution |
| Console/Go | `packages/console/*`, `packages/web/*`, `packages/llm/*` | New billing/referral/Zen/provider logic | Mostly inherited, not Paddie-specific | Prefer upstream unless Paddie product depends on local changes |

## Implementation Recommendation

| Step | Action | Default conflict rule |
| --- | --- | --- |
| 1 | Create `codex/upstream-dev-paddie-port` from latest `upstream/dev` | No local code yet |
| 2 | Port Paddie Studio files that are local-only | Keep Paddie |
| 3 | Port Paddie app integration points one by one | Start from upstream, add Paddie hooks |
| 4 | Port Tauri desktop package and release workflow | Keep Paddie Tauri, ignore upstream Electron package |
| 5 | Regenerate SDK if OpenAPI/generated SDK changes | Upstream contracts are authoritative |
| 6 | Run package installs/typechecks/tests | Validate before PR |
| 7 | Browser-check Studio, template preview, workspace preview, terminal, normal chat, steer behavior | Must pass before release |

## Proposed Keep/Replace Policy

| Default | Applies to |
| --- | --- |
| Keep upstream | `packages/opencode`, API/server/session/agent/runner/tool/provider/model/SDK behavior |
| Keep Paddie | Studio, workbench, template/gallery, Paddie preview engine, Paddie auth/API helpers, Tauri desktop/release/signing, Paddie branding |
| Reconcile carefully | App prompt input, settings, titlebar, session layout, timeline, terminal panel, package manifests |
| Drop local behavior | Queue-by-default or backend FIFO runner behavior that overrides upstream steer/session runtime |

## Open Decisions For You

| Decision | Options | My recommendation |
| --- | --- | --- |
| Desktop platform | Keep Tauri or migrate to upstream Electron | Keep Tauri for now |
| Studio availability | Keep beta toggle or make Studio always stable/on | Keep toggle until the upstream port passes; then decide |
| Queue behavior | Keep local queue option or upstream steer-only behavior | Use upstream steer-only behavior |
| Console packages | Fully track upstream console/Go or minimize desktop-only scope | Track upstream unless it blocks desktop release |
| Docs | Keep Paddie-first README or restore upstream docs | Keep Paddie-first README with attribution |
