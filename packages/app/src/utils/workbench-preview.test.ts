import { describe, expect, test } from "bun:test"
import type { Platform } from "@/context/platform"
import { detectPreview } from "./workbench-preview"

type Fs = NonNullable<Platform["workbench"]>

const join = (dir: string, name: string) => `${dir}/${name}`.replace(/\/+/g, "/")

function fs(input: Record<string, { dir?: string[]; file?: Record<string, string> }>): Fs {
  return {
    async list(path) {
      const item = input[path]
      if (!item) throw new Error(`missing ${path}`)
      return [
        ...(item.dir ?? []).map((name) => ({
          name,
          path: join(path, name),
          dir: true,
          file: false,
          size: 0,
          mtime: 1,
        })),
        ...Object.keys(item.file ?? {}).map((name) => ({
          name,
          path: join(path, name),
          dir: false,
          file: true,
          size: 0,
          mtime: 1,
        })),
      ]
    },
    async stat(path) {
      const dir = path.replace(/[\\/][^\\/]+$/, "")
      const name = path.split(/[\\/]/).at(-1) ?? ""
      const item = input[dir]
      if (item?.file?.[name] !== undefined) {
        return { name, path, dir: false, file: true, size: 0, mtime: 1 }
      }
      if ((item?.dir ?? []).includes(name)) {
        return { name, path, dir: true, file: false, size: 0, mtime: 1 }
      }
      return null
    },
    async read(path) {
      const dir = path.replace(/[\\/][^\\/]+$/, "")
      const name = path.split(/[\\/]/).at(-1) ?? ""
      const item = input[dir]?.file?.[name]
      if (item === undefined) throw new Error(`missing ${path}`)
      return item
    },
    async write() {},
    async create(input) {
      return join(input.parent, input.name)
    },
    async watch() {
      return () => undefined
    },
  }
}

describe("detectPreview", () => {
  test("prefers the frontend app in a monorepo", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          dir: ["apps", "packages"],
          file: {
            "package.json": JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }),
            "pnpm-lock.yaml": "lock",
          },
        },
        "/repo/apps": { dir: ["web"] },
        "/repo/apps/web": {
          dir: ["public", "src"],
          file: {
            "package.json": JSON.stringify({
              name: "web",
              scripts: { dev: "next dev" },
              dependencies: { next: "15.0.0", react: "19.0.0" },
            }),
            "next.config.ts": "export default {}",
          },
        },
        "/repo/packages": { dir: ["api"] },
        "/repo/packages/api": {
          file: {
            "package.json": JSON.stringify({
              name: "api",
              scripts: { dev: "tsx src/index.ts" },
              dependencies: { express: "5.0.0" },
            }),
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.cwd).toBe("/repo/apps/web")
    expect(out[0]?.label).toBe("pnpm dev")
  })

  test("uses the root workspace script when it is the clearest frontend task", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          dir: ["apps"],
          file: {
            "package.json": JSON.stringify({
              private: true,
              workspaces: ["apps/*"],
              scripts: { "dev:web": "turbo run dev --filter=web" },
            }),
            "pnpm-lock.yaml": "lock",
          },
        },
        "/repo/apps": { dir: ["api"] },
        "/repo/apps/api": {
          file: {
            "package.json": JSON.stringify({
              name: "api",
              scripts: { dev: "tsx src/index.ts" },
              dependencies: { express: "5.0.0" },
            }),
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.cwd).toBe("/repo")
    expect(out[0]?.label).toBe("pnpm dev:web")
  })

  test("honors a manual startup command", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": { file: {} },
      }),
      root: "/repo",
      start: "pnpm --filter web dev",
      os: "windows",
    })

    expect(out[0]?.kind).toBe("command")
    if (out[0]?.kind === "command") {
      expect(out[0].cmd).toBe("cmd.exe")
      expect(out[0].args).toEqual(["/d", "/s", "/c", "pnpm --filter web dev"])
    }
  })

  test("prefers npm when npm and pnpm lockfiles both exist", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          dir: ["apps"],
          file: {
            "package-lock.json": "lock",
            "pnpm-lock.yaml": "lock",
          },
        },
        "/repo/apps": { dir: ["site"] },
        "/repo/apps/site": {
          dir: ["public"],
          file: {
            "package.json": JSON.stringify({
              name: "site",
              scripts: { dev: "next dev" },
              dependencies: { next: "15.0.0", react: "19.0.0" },
            }),
            "next.config.ts": "export default {}",
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.label).toBe("npm run dev")
  })

  test("skips invalid package json files", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          dir: ["apps"],
          file: {},
        },
        "/repo/apps": { dir: ["bad", "web"] },
        "/repo/apps/bad": {
          file: {
            "package.json": "{",
          },
        },
        "/repo/apps/web": {
          dir: ["public"],
          file: {
            "package.json": JSON.stringify({
              name: "web",
              scripts: { dev: "vite" },
              dependencies: { react: "19.0.0", vite: "6.0.0" },
            }),
            "vite.config.ts": "export default {}",
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.cwd).toBe("/repo/apps/web")
    expect(out.length).toBe(1)
  })

  test("detects a plain static html project", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          file: {
            "index.html": "<!doctype html><html><head><link rel=\"stylesheet\" href=\"style.css\"></head></html>",
            "style.css": "body { color: black }",
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.kind).toBe("static")
    expect(out[0]?.label).toBe("index.html")
    if (out[0]?.kind === "static") expect(out[0].path).toBe("/repo/index.html")
  })

  test("keeps bundled vite projects on the dev server path", async () => {
    const out = await detectPreview({
      fs: fs({
        "/repo": {
          dir: ["src"],
          file: {
            "index.html": "<div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script>",
            "package.json": JSON.stringify({
              scripts: { dev: "vite" },
              dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest" },
            }),
            "vite.config.ts": "export default {}",
          },
        },
        "/repo/src": {
          file: {
            "main.tsx": "console.log('ok')",
          },
        },
      }),
      root: "/repo",
    })

    expect(out[0]?.kind).toBe("command")
    expect(out[0]?.label).toBe("npm run dev")
    expect(out.some((item) => item.kind === "static")).toBe(false)
  })
})
