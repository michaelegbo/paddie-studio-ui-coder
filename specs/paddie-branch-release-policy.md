# Paddie Branch And Release Policy

Paddie should follow upstream opencode's branch model unless we deliberately decide otherwise.

Upstream opencode currently uses `dev` as the default branch. Stable versions are produced as versioned releases and tags, not by treating `main` as the primary development branch.

## Branch Roles

### `dev`

`dev` is the default development branch.

Use `dev` as the base branch for normal pull requests and day-to-day integration work. Feature branches and forks should target `dev`.

### `main`

`main` is not the primary working branch for Paddie while we are following upstream opencode's model.

Do not treat `main` as the default target for feature work. If `main` remains in the repository, treat it as a legacy or reserved branch unless a future release policy explicitly assigns it a role.

### Release Tags

Stable shipped versions should be represented by version tags and GitHub releases.

The preferred stable-release shape is:

```text
feature branches / forks
  -> pull request into dev
  -> test and validate dev
  -> create versioned release/tag from the approved dev state
```

This matches upstream opencode more closely than a long-lived `main`-as-live flow.

### `beta`

Do not keep a long-lived Paddie `beta` branch unless we intentionally reintroduce upstream-style beta release automation.

Beta product behavior should usually be controlled by feature flags, channel config, or runtime settings instead of a separate branch. A beta branch should only exist if it has a clear automation purpose and a documented workflow.

### `production`

Only use a `production` branch if we add an actual production deployment workflow that needs it.

Do not create or use `production` as a symbolic stable branch without deployment automation behind it.

## Protection Expectations

`dev` should be protected.

Expected protection:

- no force pushes
- no branch deletion
- pull requests preferred for feature work
- only trusted maintainers have write/admin access

On a personal GitHub repository, GitHub does not support per-user branch push restrictions the same way organization repositories do. Because of that, collaborator access is the real control point: do not grant write/admin access to people who should only contribute through forks and pull requests.

If the repository moves to a GitHub organization, add explicit branch restrictions so only approved maintainers can merge or push protected branches.

## Upstream Sync Rule

Because upstream opencode's default branch is `dev`, upstream sync work should use upstream `dev` as the primary source of truth.

Avoid building release policy around branches that upstream does not use for the same purpose. This keeps Paddie easier to sync, review, and reason about.

## Practical Policy

For now:

- Keep `dev` as the default branch.
- Target PRs to `dev`.
- Use tags/releases for stable builds.
- Do not use `main` as the live branch.
- Do not recreate `beta` unless beta release automation is intentionally restored.
- Keep Paddie feature gates separate from branch names.
