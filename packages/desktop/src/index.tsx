// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  filePickerFilters,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@opencode-ai/app"
import { convertFileSrc } from "@tauri-apps/api/core"
import type { AsyncStorage } from "@solid-primitives/storage"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { readImage } from "@tauri-apps/plugin-clipboard-manager"
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import { open, save } from "@tauri-apps/plugin-dialog"
import { exists, mkdir, readDir, readTextFile, stat, watch, writeTextFile } from "@tauri-apps/plugin-fs"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { type as ostype } from "@tauri-apps/plugin-os"
import { relaunch } from "@tauri-apps/plugin-process"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { Store } from "@tauri-apps/plugin-store"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../package.json"
import { initI18n, t } from "./i18n"
import { UPDATER_ENABLED } from "./updater"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { Channel } from "@tauri-apps/api/core"
import { commands, type InitStep } from "./bindings"
import { createMenu } from "./menu"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

let update: Update | null = null

const deepLinkEvent = "paddiestudio:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = async () => {
  const startUrls = await getCurrent().catch(() => null)
  if (startUrls?.length) emitDeepLinks(startUrls)
  await onOpenUrl((urls) => emitDeepLinks(urls)).catch(() => undefined)
}

const join = (dir: string, name: string) => {
  const root = dir.replace(/[\\/]+$/, "")
  if (!root) return name
  const sep = root.includes("\\") ? "\\" : "/"
  return `${root}${sep}${name}`
}

const base = (path: string) => {
  const trim = path.replace(/[\\/]+$/, "")
  const parts = trim.split(/[\\/]/)
  return parts.at(-1) ?? trim
}

const parent = (path: string) => {
  const trim = path.replace(/[\\/]+$/, "")
  const index = Math.max(trim.lastIndexOf("/"), trim.lastIndexOf("\\"))
  if (index <= 0) return trim
  return trim.slice(0, index)
}

const createPlatform = (): Platform => {
  const os = (() => {
    const type = ostype()
    if (type === "macos" || type === "windows" || type === "linux") return type
    return undefined
  })()

  const wslHome = async () => {
    if (os !== "windows" || !window.__OPENCODE__?.wsl) return undefined
    return commands.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !window.__OPENCODE__?.wsl) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => commands.wslPath(path, "linux").catch(() => path))) as any
    }
    return commands.wslPath(result, "linux").catch(() => result) as any
  }

  const host = async (path: string) => {
    if (os !== "windows" || !window.__OPENCODE__?.wsl) return path
    return commands.wslPath(path, "windows").catch(() => path)
  }

  const guest = async (paths: string[]) => {
    if (os !== "windows" || !window.__OPENCODE__?.wsl) return paths
    return Promise.all(paths.map((path) => commands.wslPath(path, "linux").catch(() => path)))
  }

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await open({
        directory: true,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await open({
        directory: false,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        filters: filePickerFilters(opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS),
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await save({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      void shellOpen(url).catch(() => undefined)
    },
    async openPath(path: string, app?: string) {
      await commands.openPath(path, app ?? null)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage: (() => {
      type StoreLike = {
        get(key: string): Promise<string | null | undefined>
        set(key: string, value: string): Promise<unknown>
        delete(key: string): Promise<unknown>
        clear(): Promise<unknown>
        keys(): Promise<string[]>
        length(): Promise<number>
      }

      const WRITE_DEBOUNCE_MS = 250

      const storeCache = new Map<string, Promise<StoreLike>>()
      const apiCache = new Map<string, AsyncStorage & { flush: () => Promise<void> }>()
      const memoryCache = new Map<string, StoreLike>()

      const flushAll = async () => {
        const apis = Array.from(apiCache.values())
        await Promise.all(apis.map((api) => api.flush().catch(() => undefined)))
      }

      if ("addEventListener" in globalThis) {
        const handleVisibility = () => {
          if (document.visibilityState !== "hidden") return
          void flushAll()
        }

        window.addEventListener("pagehide", () => void flushAll())
        document.addEventListener("visibilitychange", handleVisibility)
      }

      const createMemoryStore = () => {
        const data = new Map<string, string>()
        const store: StoreLike = {
          get: async (key) => data.get(key),
          set: async (key, value) => {
            data.set(key, value)
          },
          delete: async (key) => {
            data.delete(key)
          },
          clear: async () => {
            data.clear()
          },
          keys: async () => Array.from(data.keys()),
          length: async () => data.size,
        }
        return store
      }

      const getStore = (name: string) => {
        const cached = storeCache.get(name)
        if (cached) return cached

        const store = Store.load(name).catch(() => {
          const cached = memoryCache.get(name)
          if (cached) return cached

          const memory = createMemoryStore()
          memoryCache.set(name, memory)
          return memory
        })

        storeCache.set(name, store)
        return store
      }

      const createStorage = (name: string) => {
        const pending = new Map<string, string | null>()
        let timer: ReturnType<typeof setTimeout> | undefined
        let flushing: Promise<void> | undefined

        const flush = async () => {
          if (flushing) return flushing

          flushing = (async () => {
            const store = await getStore(name)
            while (pending.size > 0) {
              const batch = Array.from(pending.entries())
              pending.clear()
              for (const [key, value] of batch) {
                if (value === null) {
                  await store.delete(key).catch(() => undefined)
                } else {
                  await store.set(key, value).catch(() => undefined)
                }
              }
            }
          })().finally(() => {
            flushing = undefined
          })

          return flushing
        }

        const schedule = () => {
          if (timer) return
          timer = setTimeout(() => {
            timer = undefined
            void flush()
          }, WRITE_DEBOUNCE_MS)
        }

        const api: AsyncStorage & { flush: () => Promise<void> } = {
          flush,
          getItem: async (key: string) => {
            const next = pending.get(key)
            if (next !== undefined) return next

            const store = await getStore(name)
            const value = await store.get(key).catch(() => null)
            if (value === undefined) return null
            return value
          },
          setItem: async (key: string, value: string) => {
            pending.set(key, value)
            schedule()
          },
          removeItem: async (key: string) => {
            pending.set(key, null)
            schedule()
          },
          clear: async () => {
            pending.clear()
            const store = await getStore(name)
            await store.clear().catch(() => undefined)
          },
          key: async (index: number) => {
            const store = await getStore(name)
            return (await store.keys().catch(() => []))[index]
          },
          getLength: async () => {
            const store = await getStore(name)
            return await store.length().catch(() => 0)
          },
          get length() {
            return api.getLength()
          },
        }

        return api
      }

      return (name = "default.dat") => {
        const cached = apiCache.get(name)
        if (cached) return cached

        const api = createStorage(name)
        apiCache.set(name, api)
        return api
      }
    })(),

    checkUpdate: async () => {
      if (!UPDATER_ENABLED) return { updateAvailable: false }
      const next = await check().catch(() => null)
      if (!next) return { updateAvailable: false }
      const ok = await next
        .download()
        .then(() => true)
        .catch(() => false)
      if (!ok) return { updateAvailable: false }
      update = next
      return { updateAvailable: true, version: next.version }
    },

    updateAndRestart: async () => {
      if (!UPDATER_ENABLED || !update) return
      if (ostype() === "windows") await commands.killSidecar().catch(() => undefined)
      await update.install().catch(() => undefined)
    },

    restart: async () => {
      await commands.killSidecar().catch(() => undefined)
      await relaunch()
    },

    notify: async (title, description, href) => {
      const granted = await isPermissionGranted().catch(() => false)
      const permission = granted ? "granted" : await requestPermission().catch(() => "denied")
      if (permission !== "granted") return

      const win = getCurrentWindow()
      const focused = await win.isFocused().catch(() => document.hasFocus())
      if (focused) return

      await Promise.resolve()
        .then(() => {
          const notification = new Notification(title, {
            body: description ?? "",
            icon: "https://opencode.ai/favicon-96x96-v3.png",
          })
          notification.onclick = () => {
            const win = getCurrentWindow()
            void win.show().catch(() => undefined)
            void win.unminimize().catch(() => undefined)
            void win.setFocus().catch(() => undefined)
            handleNotificationClick(href)
            notification.close()
          }
        })
        .catch(() => undefined)
    },

    fetch: (input, init) => {
      if (input instanceof Request) {
        return tauriFetch(input)
      } else {
        return tauriFetch(input, init)
      }
    },

    getWslEnabled: async () => {
      const next = await commands.getWslConfig().catch(() => null)
      if (next) return next.enabled
      return window.__OPENCODE__!.wsl ?? false
    },

    setWslEnabled: async (enabled) => {
      await commands.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await commands.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await commands.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      const result = await commands.getDisplayBackend().catch(() => null)
      return result
    },

    setDisplayBackend: async (backend) => {
      await commands.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => commands.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return commands.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await readImage().catch(() => null)
      if (!image) return null
      const bytes = await image.rgba().catch(() => null)
      if (!bytes || bytes.length === 0) return null
      const size = await image.size().catch(() => null)
      if (!size) return null
      const canvas = document.createElement("canvas")
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const imageData = ctx.createImageData(size.width, size.height)
      imageData.data.set(bytes)
      ctx.putImageData(imageData, 0, 0)
      return new Promise<File | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null)
          resolve(
            new File([blob], `pasted-image-${Date.now()}.png`, {
              type: "image/png",
            }),
          )
        }, "image/png")
      })
    },

    workbench: {
      list: async (path) => {
        const root = await host(path)
        const list = await readDir(root)
        const out = await Promise.all(
          list.map(async (item) => {
            const file = join(path, item.name)
            const next = await stat(join(root, item.name)).catch(() => null)
            return {
              name: item.name,
              path: file,
              dir: item.isDirectory,
              file: item.isFile,
              size: next?.size ?? 0,
              mtime: next?.mtime ? next.mtime.getTime() : null,
            }
          }),
        )
        return out.sort((a, b) => {
          if (a.dir !== b.dir) return a.dir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      },

      stat: async (path) => {
        const next = await host(path)
        const ok = await exists(next).catch(() => false)
        if (!ok) return null
        const info = await stat(next)
        return {
          name: base(path),
          path,
          dir: info.isDirectory,
          file: info.isFile,
          size: info.size,
          mtime: info.mtime ? info.mtime.getTime() : null,
        }
      },

      read: async (path) => readTextFile(await host(path)),
      write: async (path, data) => writeTextFile(await host(path), data),
      previewUrl: async (path) => convertFileSrc(await host(path)),
      watch: async (path, cb) => {
        const stop = await watch(await host(path), (event) => {
          void guest(event.paths).then((paths) => cb({ paths }))
        }, { recursive: false, delayMs: 150 })
        return () => stop()
      },
      create: async (input) => {
        const root = join(input.parent, input.name)
        const hostRoot = await host(root)
        const present = await exists(hostRoot).catch(() => false)
        if (present) {
          const kids = await readDir(hostRoot).catch(() => [])
          if (kids.length > 0) throw new Error("Destination folder already exists and is not empty.")
        } else {
          await mkdir(hostRoot, { recursive: true })
        }

        await Promise.all(
          input.files.map(async (file) => {
            const next = join(root, file.path)
            await mkdir(await host(parent(next)), { recursive: true })
            await writeTextFile(await host(next), file.content)
          }),
        )
        return root
      },
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
createMenu((id) => {
  menuTrigger?.(id)
})
void listenForDeepLinks()

// Expose Tauri's fetch globally so paddie-api.ts and auth.tsx can bypass CORS
;(window as any).__paddie_fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  input instanceof Request ? tauriFetch(input) : tauriFetch(input, init)

render(() => {
  const platform = createPlatform()
  const loadLocale = async () => {
    const current = await platform.storage?.("paddie-studio.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  // Fetch sidecar credentials from Rust (available immediately, before health check)
  const [sidecar] = createResource(() => commands.awaitInitialization(new Channel<InitStep>() as any))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  // Build the sidecar server connection once credentials arrive
  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const http = {
      url: data.url,
      username: data.username ?? undefined,
      password: data.password ?? undefined,
    }
    const server: ServerConnection.Sidecar = {
      displayName: t("desktop.server.local"),
      type: "sidecar",
      variant: "base",
      http,
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)
    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={!defaultServer.loading && !sidecar.loading && !locale.loading}>
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
