import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, on, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useAuth } from "@/context/auth"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import {
  BASE_DESIGN_PACK,
  createDesignPackContextItem,
  designPackMetaFromPack,
  normalizeDesignPack,
  normalizeDesignPackList,
  type StudioDesignPack,
  type StudioDesignPackMeta,
} from "@/design-pack/helpers"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"
import { Persist, persisted } from "@/utils/persist"

const baseMeta = designPackMetaFromPack(BASE_DESIGN_PACK)

const promptText = (prompt: ReturnType<typeof usePrompt>) =>
  prompt
    .current()
    .map((part) => ("content" in part ? part.content : ""))
    .join("")

export function PromptDesignPackControl(props: {
  class?: string
  style?: JSX.CSSProperties
  restoreFocus: () => void
}) {
  const sdk = useSDK()
  const auth = useAuth()
  const prompt = usePrompt()
  const [selection, setSelection] = persisted(
    {
      ...Persist.workspace(sdk.directory, "design-pack", ["design-pack.v1"]),
      debounceWriteMs: 300,
    },
    createStore({
      selectedID: BASE_DESIGN_PACK.id,
    }),
  )
  const [store, setStore] = createStore<{
    packs: StudioDesignPackMeta[]
    detailCache: Record<string, StudioDesignPack>
    loading: boolean
  }>({
    packs: [baseMeta],
    detailCache: { [BASE_DESIGN_PACK.id]: BASE_DESIGN_PACK },
    loading: false,
  })

  const selected = createMemo(
    () => store.packs.find((item) => item.id === selection.selectedID) ?? store.packs[0] ?? baseMeta,
  )

  const loadList = async (signedIn: boolean) => {
    if (!signedIn) {
      setStore("packs", [baseMeta])
      setStore("loading", false)
      return
    }

    setStore("loading", true)
    try {
      const items = normalizeDesignPackList(await paddieApi.get<unknown>("/studio/design-packs"))
      setStore("packs", [baseMeta, ...items.filter((item) => item.id !== BASE_DESIGN_PACK.id)])
    } catch {
      setStore("packs", [baseMeta])
    } finally {
      setStore("loading", false)
    }
  }

  const loadDetail = async (meta: StudioDesignPackMeta) => {
    const cached = store.detailCache[meta.id]
    if (cached) return cached
    const detail = normalizeDesignPack(
      await paddieApi.get<unknown>(`/studio/design-packs/${encodeURIComponent(meta.id)}?v=${Date.now()}`),
    )
    setStore("detailCache", meta.id, detail)
    return detail
  }

  const attach = async (meta: StudioDesignPackMeta | undefined) => {
    if (!meta) return
    setSelection("selectedID", meta.id)
    try {
      const pack = await loadDetail(meta)
      prompt.context.add({
        type: "design-pack",
        ...createDesignPackContextItem(pack, undefined, promptText(prompt)),
      })
      showToast({ title: "Design pack attached", description: pack.name })
    } catch (err) {
      showToast({ variant: "error", title: "Could not attach design pack", description: paddieApiErrorMessage(err) })
    } finally {
      props.restoreFocus()
    }
  }

  createEffect(on(() => auth.isAuthenticated(), (signedIn) => void loadList(signedIn), { defer: false }))

  return (
    <Select
      size="normal"
      options={store.packs}
      current={selected()}
      value={(item) => item.id}
      label={(item) => (store.loading && item.id === BASE_DESIGN_PACK.id ? "Design..." : item.name)}
      onSelect={(item) => void attach(item)}
      class={`max-w-[160px] text-text-base ${props.class ?? ""}`}
      valueClass="truncate text-13-regular text-text-base"
      triggerStyle={props.style}
      triggerProps={{ "data-action": "prompt-design-pack" }}
      variant="ghost"
    />
  )
}
