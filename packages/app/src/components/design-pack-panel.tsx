import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useAuth } from "@/context/auth"
import { usePrompt } from "@/context/prompt"
import {
  BASE_DESIGN_PACK,
  createDesignPackContextItem,
  createDesignPackVariants,
  designPackMetaFromPack,
  formatTokenEntries,
  normalizeDesignPack,
  normalizeDesignPackList,
  type StudioDesignPack,
  type StudioDesignPackMeta,
  type StudioDesignVariant,
} from "@/design-pack/helpers"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"

const baseMeta = designPackMetaFromPack(BASE_DESIGN_PACK)

export function DesignPackPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const auth = useAuth()
  const prompt = usePrompt()
  const [store, setStore] = createStore<{
    packs: StudioDesignPackMeta[]
    selectedID: string
    detail?: StudioDesignPack
    detailCache: Record<string, StudioDesignPack>
    loading: boolean
    detailLoading: boolean
    error?: string
    variants: StudioDesignVariant[]
  }>({
    packs: [baseMeta],
    selectedID: BASE_DESIGN_PACK.id,
    detail: BASE_DESIGN_PACK,
    detailCache: { [BASE_DESIGN_PACK.id]: BASE_DESIGN_PACK },
    loading: false,
    detailLoading: false,
    error: undefined,
    variants: [],
  })

  const promptText = () =>
    prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")

  const focusComposer = () => {
    if (props.chatHidden) props.onChatToggle?.()
    requestAnimationFrame(() => {
      const node = document.querySelector('[data-component="prompt-input"]')
      if (node instanceof HTMLElement) node.focus()
    })
  }

  const loadList = async (signedIn: boolean) => {
    if (!signedIn) {
      setStore("packs", [baseMeta])
      setStore("loading", false)
      setStore("error", undefined)
      return
    }

    setStore("loading", true)
    setStore("error", undefined)
    try {
      const items = normalizeDesignPackList(await paddieApi.get<unknown>("/studio/design-packs"))
      setStore("packs", [baseMeta, ...items.filter((item) => item.id !== BASE_DESIGN_PACK.id)])
    } catch (err) {
      setStore("packs", [baseMeta])
      setStore("error", paddieApiErrorMessage(err))
    } finally {
      setStore("loading", false)
    }
  }

  const loadDetail = async (id: string) => {
    const cached = store.detailCache[id]
    setStore("selectedID", id)
    setStore("variants", [])
    if (cached) {
      setStore("detail", cached)
      return cached
    }

    setStore("detailLoading", true)
    try {
      const detail = normalizeDesignPack(
        await paddieApi.get<unknown>(`/studio/design-packs/${encodeURIComponent(id)}?v=${Date.now()}`),
      )
      setStore("detail", detail)
      setStore("detailCache", id, detail)
      return detail
    } catch (err) {
      showToast({ variant: "error", title: "Could not load design pack", description: paddieApiErrorMessage(err) })
      setStore("detail", BASE_DESIGN_PACK)
      setStore("selectedID", BASE_DESIGN_PACK.id)
      return BASE_DESIGN_PACK
    } finally {
      setStore("detailLoading", false)
    }
  }

  const selectedMeta = createMemo(
    () => store.packs.find((item) => item.id === store.selectedID) ?? store.packs[0] ?? baseMeta,
  )

  const currentPack = createMemo(() => store.detail ?? store.detailCache[selectedMeta().id] ?? BASE_DESIGN_PACK)

  const attachPack = (variant?: StudioDesignVariant) => {
    const pack = currentPack()
    prompt.context.add({
      type: "design-pack",
      ...createDesignPackContextItem(pack, variant, promptText()),
    })
    focusComposer()
    showToast({
      title: variant ? "Design variant attached" : "Design pack attached",
      description: variant ? `${variant.name} from ${pack.name}` : pack.name,
    })
  }

  const exploreVariants = () => {
    const variants = createDesignPackVariants(currentPack(), promptText())
    setStore("variants", variants)
    showToast({ title: "Design variants ready", description: "Choose one direction to attach to chat." })
  }

  createEffect(on(() => auth.isAuthenticated(), (signedIn) => void loadList(signedIn), { defer: false }))

  return (
    <div class="min-h-full w-full bg-background-base">
      <div class="grid min-h-full gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div class="rounded-[20px] border border-border-weaker-base bg-surface-base p-3">
          <div class="flex items-center justify-between gap-2 px-1 pb-3">
            <div>
              <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Design Packs</div>
              <div class="mt-1 text-13-medium text-text-base">Select a system preset for chat.</div>
            </div>
            <Show when={store.loading}>
              <Icon name="status" class="size-4 text-text-weak" />
            </Show>
          </div>

          <Show when={store.error}>
            {(value) => (
              <div class="mb-3 rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-11-medium text-text-weak">
                Cloud packs unavailable: {value()}
              </div>
            )}
          </Show>

          <div class="flex flex-col gap-2">
            <For each={store.packs}>
              {(item) => (
                <button
                  type="button"
                  classList={{
                    "rounded-[14px] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-weak-base": true,
                    "border-border-weak-base bg-background-stronger": item.id === store.selectedID,
                    "border-border-weaker-base bg-background-base hover:bg-surface-base-hover": item.id !== store.selectedID,
                  }}
                  onClick={() => void loadDetail(item.id)}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-13-medium text-text-base">{item.name}</div>
                      <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">{item.description}</div>
                    </div>
                    <span class="shrink-0 rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                      {item.tier}
                    </span>
                  </div>
                  <div class="mt-3 flex items-center gap-1.5">
                    <For each={item.preview.colors}>
                      {(color) => (
                        <span
                          class="size-3 rounded-full border border-border-weaker-base"
                          style={{ "background-color": color }}
                        />
                      )}
                    </For>
                    <div class="min-w-0 flex-1" />
                    <For each={item.tags.slice(0, 2)}>
                      {(tag) => <span class="truncate text-10-medium text-text-weak">{tag}</span>}
                    </For>
                  </div>
                </button>
              )}
            </For>
          </div>

          <Show when={!auth.isAuthenticated()}>
            <div class="mt-3 rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2 text-11-medium text-text-weak">
              Sign in to load cloud and user packs. Base is available offline.
            </div>
          </Show>
        </div>

        <div class="rounded-[20px] border border-border-weaker-base bg-surface-base p-4">
          <Show
            when={!store.detailLoading}
            fallback={
              <div class="flex h-64 items-center justify-center text-13-medium text-text-weak">
                Loading design pack...
              </div>
            }
          >
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="m-0 text-18-medium text-text-base">{currentPack().name}</h2>
                    <span class="rounded-full border border-border-weaker-base px-2 py-0.5 text-10-medium text-text-weak">
                      {currentPack().tier}
                    </span>
                  </div>
                  <p class="mt-2 max-w-[720px] text-13-regular text-text-weak">{currentPack().description}</p>
                </div>
                <div class="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    class="h-9 px-3 text-12-medium"
                    onClick={() => attachPack()}
                  >
                    Attach pack
                  </Button>
                  <Button type="button" class="h-9 px-3 text-12-medium" onClick={exploreVariants}>
                    Explore variants
                  </Button>
                </div>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
                  <div class="text-11-medium uppercase tracking-[0.1em] text-text-weak">Rules</div>
                  <ul class="mt-2 flex flex-col gap-1.5">
                    <For each={currentPack().rules.slice(0, 6)}>
                      {(rule) => <li class="text-12-regular text-text-base">{rule}</li>}
                    </For>
                  </ul>
                </div>

                <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
                  <div class="text-11-medium uppercase tracking-[0.1em] text-text-weak">Tokens</div>
                  <div class="mt-2 flex flex-col gap-1.5">
                    <For each={formatTokenEntries(currentPack().tokens, 8)}>
                      {(token) => <div class="truncate text-12-regular text-text-base">{token}</div>}
                    </For>
                  </div>
                </div>

                <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
                  <div class="text-11-medium uppercase tracking-[0.1em] text-text-weak">Components</div>
                  <ul class="mt-2 flex flex-col gap-1.5">
                    <For each={currentPack().componentGuidance.slice(0, 6)}>
                      {(item) => <li class="text-12-regular text-text-base">{item}</li>}
                    </For>
                  </ul>
                </div>

                <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
                  <div class="text-11-medium uppercase tracking-[0.1em] text-text-weak">Skills</div>
                  <div class="mt-2 flex flex-col gap-2">
                    <For each={currentPack().skills.slice(0, 5)}>
                      {(skill) => (
                        <div>
                          <div class="text-12-medium text-text-base">{skill.name}</div>
                          <div class="mt-0.5 text-11-regular text-text-weak">{skill.trigger || "always"}</div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <Show when={store.variants.length > 0}>
                <div class="rounded-[16px] border border-border-weaker-base bg-background-stronger p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-11-medium uppercase tracking-[0.1em] text-text-weak">Variant Picker</div>
                      <div class="mt-1 text-13-medium text-text-base">Choose one compact design direction.</div>
                    </div>
                  </div>
                  <div class="mt-3 grid gap-2 lg:grid-cols-3">
                    <For each={store.variants}>
                      {(variant) => (
                        <div class="rounded-[14px] border border-border-weaker-base bg-background-base p-3">
                          <div class="text-13-medium text-text-base">{variant.name}</div>
                          <div class="mt-1 min-h-12 text-12-regular text-text-weak">{variant.summary}</div>
                          <Button
                            type="button"
                            variant="ghost"
                            class="mt-3 h-8 w-full justify-center text-12-medium"
                            onClick={() => attachPack(variant)}
                          >
                            Apply
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
