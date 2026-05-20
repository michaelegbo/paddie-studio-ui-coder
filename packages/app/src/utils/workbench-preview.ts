import type { Platform } from "@/context/platform"

type Fs = NonNullable<Platform["workbench"]>
type Os = Platform["os"]
type Mgr = "bun" | "npm" | "pnpm" | "yarn"
type Pkg = {
  name?: string
  private?: boolean
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: unknown
}
type Lock = {
  mgr: Mgr
  time: number
}
type Hit = {
  dir: string
  pkg: Pkg
  names: string[]
}

type PreviewCommandTarget = {
  kind: "command"
  id: string
  cmd: string
  args: string[]
  cwd: string
  label: string
  note: string
  rel: string
  score: number
}

type PreviewStaticTarget = {
  kind: "static"
  id: string
  path: string
  cwd: string
  label: string
  note: string
  rel: string
  score: number
}

export type PreviewTarget = PreviewCommandTarget | PreviewStaticTarget

const SKIP = new Set([
  ".git",
  ".idea",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
])

const LOCKS = [
  { mgr: "bun" as const, path: "bun.lock" },
  { mgr: "bun" as const, path: "bun.lockb" },
  { mgr: "pnpm" as const, path: "pnpm-lock.yaml" },
  { mgr: "yarn" as const, path: "yarn.lock" },
  { mgr: "npm" as const, path: "package-lock.json" },
  { mgr: "npm" as const, path: "npm-shrinkwrap.json" },
]

const FRONT = [
  "next",
  "vite",
  "react",
  "react-dom",
  "solid-js",
  "vue",
  "nuxt",
  "astro",
  "svelte",
  "@sveltejs/kit",
  "@angular/core",
  "@builder.io/qwik-city",
  "@remix-run/dev",
  "gatsby",
]

const BACK = [
  "express",
  "fastify",
  "@nestjs/core",
  "koa",
  "hono",
  "elysia",
  "drizzle-kit",
  "prisma",
]

const MARK = [
  "index.html",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.js",
  "nuxt.config.ts",
  "astro.config.mjs",
  "astro.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "svelte.config.js",
  "svelte.config.ts",
  "app",
  "pages",
  "public",
]

const BUNDLED_MARK = new Set(MARK.filter((item) => item !== "index.html" && item !== "public"))

const rel = (root: string, dir: string) => {
  const a = root.replace(/[\\/]+$/, "")
  const b = dir.replace(/[\\/]+$/, "")
  if (!a || a === b) return ""
  const base = a.endsWith("\\") || a.endsWith("/") ? a : `${a}${a.includes("\\") ? "\\" : "/"}`
  if (!b.startsWith(base)) return b
  return b.slice(base.length)
}

const join = (dir: string, name: string) => {
  const root = dir.replace(/[\\/]+$/, "")
  if (!root) return name
  const sep = root.includes("\\") ? "\\" : "/"
  return `${root}${sep}${name}`
}

const up = (root: string, dir: string) => {
  const out = [dir]
  let cur = dir.replace(/[\\/]+$/, "")
  const stop = root.replace(/[\\/]+$/, "")
  while (cur && cur !== stop) {
    const next = cur.replace(/[\\/][^\\/]+$/, "")
    if (!next || next === cur) break
    out.push(next)
    cur = next
  }
  return out
}

const rank = (key: string, value: string) => {
  let score = 0
  const name = key.toLowerCase()
  const body = value.toLowerCase()

  if (name === "dev:web") score += 140
  if (name === "web:dev") score += 135
  if (name === "dev:frontend" || name === "frontend:dev") score += 120
  if (name === "dev:client" || name === "client:dev") score += 110
  if (name === "dev:site" || name === "site:dev") score += 105
  if (name === "dev:app" || name === "app:dev") score += 95
  if (name === "preview") score += 80
  if (name === "serve") score += 70
  if (name === "start") score += 60
  if (name === "dev") score += 50

  if (/(vite|next dev|nuxt dev|astro dev|solid-start|webpack serve|webpack-dev-server|react-scripts|rspack|parcel|remix dev)/.test(body)) {
    score += 50
  }

  if (/(turbo|nx|rush|lerna|pnpm).*(web|frontend|client|site|app|landing)/.test(body)) {
    score += 45
  }

  if (/(storybook|tauri|electron|lint|test|build|deploy|db:|migrate|seed)/.test(body)) {
    score -= 90
  }

  return score
}

const choose = (scripts: Record<string, string>) =>
  Object.entries(scripts)
    .map(([key, value]) => ({ key, value, score: rank(key, value) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]

const parse = (text: string) => {
  try {
    return JSON.parse(text) as Pkg
  } catch {
    return
  }
}

const scoreMgr = (mgr: Mgr) => {
  if (mgr === "npm") return 4
  if (mgr === "pnpm") return 3
  if (mgr === "yarn") return 2
  return 1
}

const manager = (pkg: Pkg, locks: Lock[], map: Map<string, Pkg>, root: string, dir: string) => {
  const dirs = up(root, dir)
  for (const item of dirs) {
    const name = map.get(item)?.packageManager?.split("@")[0]
    if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") return name
  }

  const next = Array.from(
    locks.reduce((acc, item) => {
      acc.set(item.mgr, Math.max(acc.get(item.mgr) ?? 0, item.time))
      return acc
    }, new Map<Mgr, number>()),
    ([mgr, time]) => ({ mgr, time }),
  ).sort((a, b) => b.time - a.time || scoreMgr(b.mgr) - scoreMgr(a.mgr))[0]?.mgr

  if (next) return next
  const name = pkg.packageManager?.split("@")[0]
  if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") return name
  return "npm"
}

const preview = (mgr: Mgr, script: string, dir: string, relpath: string, score: number, why: string[]) => {
  const label =
    mgr === "bun"
      ? `bun run ${script}`
      : mgr === "pnpm"
        ? `pnpm ${script}`
        : mgr === "yarn"
          ? `yarn ${script}`
          : `npm run ${script}`

  const cmd =
    mgr === "bun"
      ? { cmd: "bun", args: ["run", script] }
      : mgr === "pnpm"
        ? { cmd: "pnpm", args: [script] }
        : mgr === "yarn"
          ? { cmd: "yarn", args: [script] }
          : { cmd: "npm", args: ["run", script] }

  return {
    kind: "command",
    id: `${dir}\n${label}`,
    ...cmd,
    cwd: dir,
    label,
    rel: relpath,
    note: why.join(", "),
    score,
  } satisfies PreviewTarget
}

const shell = (text: string, root: string, os?: Os) => {
  if (os === "windows") {
    return {
      kind: "command",
      id: `${root}\n${text}`,
      cmd: "cmd.exe",
      args: ["/d", "/s", "/c", text],
      cwd: root,
      label: text,
      rel: "",
      note: "manual startup command",
      score: Number.MAX_SAFE_INTEGER,
    } satisfies PreviewTarget
  }

  return {
    kind: "command",
    id: `${root}\n${text}`,
    cmd: "sh",
    args: ["-lc", text],
    cwd: root,
    label: text,
    rel: "",
    note: "manual startup command",
    score: Number.MAX_SAFE_INTEGER,
  } satisfies PreviewTarget
}

const hasBuildMarker = (names: string[]) => names.some((item) => BUNDLED_MARK.has(item))

const hasBuildPackage = (pkg: Pkg | undefined) => {
  if (!pkg) return false
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const keys = Object.keys(deps)
  if (FRONT.some((item) => keys.includes(item))) return true
  return Object.values(pkg.scripts ?? {}).some((value) =>
    /(vite|next dev|nuxt dev|astro dev|solid-start|webpack serve|webpack-dev-server|react-scripts|rspack|parcel|remix dev|svelte-kit)/i.test(
      value,
    ),
  )
}

const htmlNeedsBuild = (html: string) =>
  /@vite\/client/i.test(html) || /\s(?:src|href)=["']\/?src\/[^"']+\.(tsx|ts|jsx)(?:\?[^"']*)?["']/i.test(html)

const staticPreview = (dir: string, relpath: string, score: number, why: string[]) =>
  ({
    kind: "static",
    id: `${dir}\nindex.html`,
    path: join(dir, "index.html"),
    cwd: dir,
    label: relpath ? `${relpath}/index.html` : "index.html",
    rel: relpath,
    note: why.join(", "),
    score,
  }) satisfies PreviewTarget

const score = (hit: Hit, script?: { key: string; value: string; score: number }) => {
  let out = 0
  const why: string[] = []
  const deps = { ...hit.pkg.dependencies, ...hit.pkg.devDependencies }
  const keys = Object.keys(deps)
  const text = `${hit.pkg.name ?? ""} ${hit.dir}`.toLowerCase()

  if (script) {
    out += script.score
    why.push(`script ${script.key}`)
  }

  const front = FRONT.filter((item) => keys.includes(item))
  if (front.length > 0) {
    out += 70 + front.length * 8
    why.push(`deps ${front.slice(0, 2).join(", ")}`)
  }

  const back = BACK.filter((item) => keys.includes(item))
  if (back.length > 0) out -= 35 + back.length * 4

  if (MARK.some((item) => hit.names.includes(item))) {
    out += 35
    why.push("frontend files")
  }

  if (hit.names.some((item) => item.startsWith("src")) && hit.names.some((item) => item === "public")) {
    out += 10
  }

  if (/(web|frontend|client|site|landing|dashboard|admin|studio|app)/.test(text)) {
    out += 25
    why.push("frontend path")
  }

  if (/(backend|api|server|worker|cli|daemon|db)/.test(text)) out -= 35

  if (hit.pkg.workspaces) {
    out += 10
    if (script && /(web|frontend|client|site|app)/.test(script.key + script.value)) {
      out += 25
      why.push("workspace frontend task")
    }
  }

  return { out, why }
}

async function scan(fs: Fs, root: string) {
  const seen = new Set<string>()
  const dirs = [root]
  const list = new Map<string, Awaited<ReturnType<Fs["list"]>>>()
  const pkg = new Map<string, Pkg>()

  while (dirs.length > 0 && seen.size < 160) {
    const batch = dirs.splice(0, 8).filter((dir) => !seen.has(dir))
    if (batch.length === 0) continue
    batch.forEach((dir) => seen.add(dir))

    const rows = await Promise.all(batch.map((dir) => fs.list(dir).catch(() => null)))
    await Promise.all(
      rows.map(async (row, i) => {
        const dir = batch[i]
        if (!row) return
        list.set(dir, row)

        const path = join(dir, "package.json")
        if (row.some((item) => item.file && item.name === "package.json")) {
          const text = await fs.read(path).catch(() => null)
          if (text) {
            const data = parse(text)
            if (!data) return
            pkg.set(dir, data)
          }
        }

        const depth = rel(root, dir).split(/[\\/]/).filter(Boolean).length
        if (depth >= 4) return

        row
          .filter((item) => item.dir && !SKIP.has(item.name) && !item.name.startsWith("."))
          .forEach((item) => dirs.push(item.path))
      }),
    )
  }

  return { list, pkg }
}

export async function detectPreview(input: {
  fs: Fs
  root: string
  start?: string
  os?: Os
}): Promise<PreviewTarget[]> {
  const start = input.start?.trim()
  if (start) return [shell(start, input.root, input.os)]

  const data = await scan(input.fs, input.root)
  const commandTargets: PreviewTarget[] = Array.from(data.pkg.entries())
    .flatMap(([dir, pkg]) => {
      const names = data.list.get(dir)?.map((item) => item.name) ?? []
      const script = choose(pkg.scripts ?? {})
      const result = score({ dir, pkg, names }, script)
      if (!script || result.out <= 0) return []

      const locks = up(input.root, dir).flatMap((item) =>
        LOCKS.flatMap((lock) => {
          const hit = data.list.get(item)?.find((entry) => entry.name === lock.path)
          if (!hit) return []
          return [{ mgr: lock.mgr, time: hit.mtime ?? 0 }]
        }),
      )

      const mgr = manager(pkg, locks, data.pkg, input.root, dir)
      return [preview(mgr, script.key, dir, rel(input.root, dir), result.out, result.why)]
    })

  const staticTargets: PreviewTarget[] = (
    await Promise.all(
      Array.from(data.list.entries()).map(async ([dir, entries]) => {
        if (!entries.some((item) => item.file && item.name.toLowerCase() === "index.html")) return
        const names = entries.map((item) => item.name)
        const pkg = data.pkg.get(dir)
        if (hasBuildMarker(names) || hasBuildPackage(pkg)) return

        const html = await input.fs.read(join(dir, "index.html")).catch(() => "")
        if (!html || htmlNeedsBuild(html)) return

        const relpath = rel(input.root, dir)
        const why = ["static HTML"]
        let result = 45
        if (!relpath) {
          result += 25
          why.push("workspace root")
        }
        if (/(web|frontend|client|site|landing|dashboard|admin|studio|app)/i.test(`${pkg?.name ?? ""} ${dir}`)) {
          result += 15
          why.push("frontend path")
        }
        if (!pkg) result += 10

        return staticPreview(dir, relpath, result, why)
      }),
    )
  ).filter((item): item is Extract<PreviewTarget, { kind: "static" }> => !!item)

  const out = [...commandTargets, ...staticTargets].sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))

  return out
}
