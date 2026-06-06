import Konva from "konva"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useAuth } from "@/context/auth"
import { usePrompt } from "@/context/prompt"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"
import {
  applyPaddieDesignOperations,
  createDefaultDesignDocument,
  createDesignerId,
  createPaddieDesignContext,
  currentDesignPage,
  designContextPrompt,
  designElements,
  designFrames,
  formatPaddieDesignNote,
  frameChildren,
  generateHtmlReference,
  parsePaddieDesignOperations,
  type PaddieDesignDocument,
  type PaddieDesignElement,
  type PaddieDesignFrame,
  type PaddieDesignMode,
  type PaddieDesignTransaction,
} from "@/designer/helpers"

type DesignerListItem = {
  id: string
  name: string
  updatedAt: string
  frameCount: number
}

type DesignerPayload = {
  id: string
  name: string
  document: PaddieDesignDocument
  updatedAt: string
}

const LOCAL_KEY = "paddie:designer:documents:v1"

export function DesignerPanel(props: {
  chatHidden?: boolean
  onChatToggle?: VoidFunction
}) {
  const auth = useAuth()
  const prompt = usePrompt()
  const [document, setDocument] = createSignal(createDefaultDesignDocument("Paddie Design"))
  const [selectedIds, setSelectedIds] = createSignal<string[]>([])
  const [undoStack, setUndoStack] = createSignal<PaddieDesignTransaction[]>([])
  const [redoStack, setRedoStack] = createSignal<PaddieDesignTransaction[]>([])
  const [reload, setReload] = createSignal(0)
  const [saving, setSaving] = createSignal(false)
  const [opsText, setOpsText] = createSignal("")
  const [aiPrompt, setAiPrompt] = createSignal("Design a polished SaaS landing page hero with a pricing card.")
  const [designs, designsApi] = createResource(
    () => ({ token: auth.token(), reload: reload() }),
    async (input) => {
      if (!input.token) return localDesigns()
      return paddieApi.get<DesignerListItem[]>("/studio/designs").catch(() => localDesigns())
    },
  )
  const page = createMemo(() => currentDesignPage(document()))
  const frames = createMemo(() => designFrames(document()))
  const elements = createMemo(() => designElements(document()))
  const selected = createMemo(() => selectedIds().flatMap((id) => {
    const item = page()?.elements[id]
    return item ? [item] : []
  }))
  const selectedElement = createMemo(() => selected()[0])
  const selectedFrameIds = createMemo(() => {
    const selectedFrames = selected().filter((item): item is PaddieDesignFrame => item.type === "frame")
    if (selectedFrames.length) return selectedFrames.map((item) => item.id)
    const fromChildren = selected().flatMap((item) => item.parentId ? [item.parentId] : [])
    if (fromChildren.length) return fromChildren
    return frames().slice(0, 1).map((item) => item.id)
  })

  const commit = (label: string, next: (current: PaddieDesignDocument) => PaddieDesignDocument) => {
    const before = document()
    const after = next(structuredClone(before))
    setDocument(after)
    setUndoStack((items) => [
      ...items,
      {
        id: createDesignerId("txn"),
        label,
        before,
        after,
        at: new Date().toISOString(),
      },
    ].slice(-80))
    setRedoStack([])
  }

  const updateElement = (id: string, patch: Partial<PaddieDesignElement>) => {
    commit("Update element", (current) => {
      const active = currentDesignPage(current)
      if (!active?.elements[id]) return current
      active.elements[id] = { ...active.elements[id], ...patch }
      return { ...current, updatedAt: new Date().toISOString() }
    })
  }

  const addFrame = () => {
    commit("Add frame", (current) => {
      const active = currentDesignPage(current)
      if (!active) return current
      const id = createDesignerId("frame")
      active.elements[id] = {
        id,
        type: "frame",
        name: `Frame ${active.frameIds.length + 1}`,
        x: 120 + active.frameIds.length * 48,
        y: 100 + active.frameIds.length * 36,
        width: 720,
        height: 440,
        fill: current.tokens.colors.surface,
        stroke: current.tokens.colors.border,
        strokeWidth: 1,
        radius: 14,
      }
      active.frameIds = [...active.frameIds, id]
      setSelectedIds([id])
      return { ...current, updatedAt: new Date().toISOString() }
    })
  }

  const addShape = (type: "rect" | "ellipse") => {
    commit(`Add ${type}`, (current) => {
      const active = currentDesignPage(current)
      if (!active) return current
      const id = createDesignerId("shape")
      active.elements[id] = {
        id,
        type,
        parentId: selectedFrameIds()[0],
        name: type === "rect" ? "Rectangle" : "Ellipse",
        x: 180,
        y: 170,
        width: 180,
        height: 120,
        fill: current.tokens.colors.accent,
        radius: type === "rect" ? 8 : undefined,
      }
      setSelectedIds([id])
      return { ...current, updatedAt: new Date().toISOString() }
    })
  }

  const addText = () => {
    commit("Add text", (current) => {
      const active = currentDesignPage(current)
      if (!active) return current
      const id = createDesignerId("text")
      active.elements[id] = {
        id,
        type: "text",
        parentId: selectedFrameIds()[0],
        name: "Text",
        x: 190,
        y: 190,
        width: 320,
        height: 64,
        text: "New text",
        fill: current.tokens.colors.text,
        fontSize: 28,
        fontWeight: 650,
        lineHeight: 1.15,
      }
      setSelectedIds([id])
      return { ...current, updatedAt: new Date().toISOString() }
    })
  }

  const removeSelected = () => {
    const ids = selectedIds()
    if (!ids.length) return
    commit("Delete selection", (current) => {
      const active = currentDesignPage(current)
      if (!active) return current
      ids.forEach((id) => {
        delete active.elements[id]
        active.frameIds = active.frameIds.filter((frameId) => frameId !== id)
        Object.values(active.elements)
          .filter((element) => element.parentId === id)
          .forEach((element) => delete active.elements[element.id])
      })
      setSelectedIds([])
      return { ...current, updatedAt: new Date().toISOString() }
    })
  }

  const undo = () => {
    const last = undoStack().at(-1)
    if (!last) return
    setDocument(last.before)
    setUndoStack((items) => items.slice(0, -1))
    setRedoStack((items) => [...items, last])
  }

  const redo = () => {
    const last = redoStack().at(-1)
    if (!last) return
    setDocument(last.after)
    setRedoStack((items) => items.slice(0, -1))
    setUndoStack((items) => [...items, last])
  }

  const newDesign = () => {
    const next = createDefaultDesignDocument("Untitled design")
    setDocument(next)
    setSelectedIds(designFrames(next).slice(0, 1).map((item) => item.id))
    setUndoStack([])
    setRedoStack([])
  }

  const loadDesign = async (id: string) => {
    if (!auth.token()) {
      const found = localPayloads().find((item) => item.id === id)
      if (found) setDocument(found.document)
      return
    }
    try {
      const payload = await paddieApi.get<DesignerPayload>(`/studio/designs/${encodeURIComponent(id)}`)
      setDocument(payload.document)
      setSelectedIds(designFrames(payload.document).slice(0, 1).map((item) => item.id))
      setUndoStack([])
      setRedoStack([])
    } catch (err) {
      showToast({ variant: "error", title: "Could not open design", description: paddieApiErrorMessage(err) })
    }
  }

  const saveDesign = async () => {
    setSaving(true)
    try {
      if (!auth.token()) {
        writeLocalDesign(document())
        setReload((value) => value + 1)
        showToast({ title: "Design saved locally" })
        return
      }
      const payload = { name: document().name, document: document() }
      const saved = await paddieApi.put<DesignerPayload>(`/studio/designs/${encodeURIComponent(document().id)}`, payload)
      setDocument(saved.document)
      setReload((value) => value + 1)
      void designsApi.refetch()
      showToast({ title: "Design saved" })
    } catch (err) {
      writeLocalDesign(document())
      showToast({ variant: "error", title: "Saved locally", description: paddieApiErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const attach = (mode: PaddieDesignMode) => {
    const item = createPaddieDesignContext({
      document: document(),
      selectedIds: selectedIds(),
      mode,
      writebackAllowed: mode === "ai-edit",
    })
    prompt.context.add({ type: "paddie-design", ...item })
    const text = designContextPrompt(mode)
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    if (props.chatHidden) props.onChatToggle?.()
    showToast({ title: "Design attached", description: item.frameNames.join(", ") || item.designName })
  }

  const copyAiRequest = async () => {
    const item = createPaddieDesignContext({
      document: document(),
      selectedIds: selectedIds(),
      mode: "ai-edit",
      writebackAllowed: true,
    })
    const text = [
      "Return only JSON for Paddie Designer operations.",
      "Allowed operation types: createFrame, createShape, createText, updateBounds, updateStyle, deleteElement, createToken.",
      `Goal: ${aiPrompt()}`,
      formatPaddieDesignNote(item),
    ].join("\n\n")
    await navigator.clipboard?.writeText(text).catch(() => undefined)
    attach("ai-edit")
    showToast({ title: "AI edit request prepared", description: "Send the prompt, then paste the returned operations into Apply JSON ops." })
  }

  const draftFromPrompt = () => {
    const frameId = createDesignerId("frame")
    const titleId = createDesignerId("text")
    const cardId = createDesignerId("shape")
    const ctaId = createDesignerId("shape")
    const words = aiPrompt().replace(/\s+/g, " ").trim() || "New interface"
    setOpsText(
      JSON.stringify(
        [
          { type: "createFrame", id: frameId, name: "AI Draft", x: 120, y: 120, width: 960, height: 540, fill: "#101114" },
          { type: "createText", id: titleId, parentId: frameId, name: "Prompt headline", x: 176, y: 170, width: 560, height: 90, text: words, fill: "#f5f5f5", fontSize: 42, fontWeight: 720 },
          { type: "createShape", id: cardId, shape: "rect", parentId: frameId, name: "Content card", x: 672, y: 166, width: 320, height: 260, fill: "#18181b", stroke: "#333338", radius: 14 },
          { type: "createShape", id: ctaId, shape: "rect", parentId: frameId, name: "Primary button", x: 178, y: 360, width: 170, height: 46, fill: "#00d4aa", radius: 8 },
        ],
        null,
        2,
      ),
    )
    showToast({ title: "Draft operations created", description: "Review and apply the generated operations." })
  }

  const applyOps = () => {
    try {
      const operations = parsePaddieDesignOperations(opsText())
      const before = document()
      const result = applyPaddieDesignOperations(before, operations)
      if (result.rejected.length) {
        showToast({
          variant: "error",
          title: "Some operations were rejected",
          description: result.rejected.map((item) => `#${item.index + 1}: ${item.reason}`).join("; "),
        })
      }
      if (result.document === before) return
      setDocument(result.document)
      setUndoStack((items) => [
        ...items,
        {
          id: createDesignerId("txn"),
          label: "Apply design operations",
          before,
          after: result.document,
          at: new Date().toISOString(),
        },
      ].slice(-80))
      setRedoStack([])
    } catch (err) {
      showToast({ variant: "error", title: "Invalid operations", description: err instanceof Error ? err.message : "Could not parse JSON." })
    }
  }

  const exportJson = () => download(`${document().name || "design"}.json`, JSON.stringify(document(), null, 2), "application/json")
  const exportHtml = () => download(`${document().name || "design"}.html`, generateHtmlReference(document(), selectedFrameIds()), "text/html")

  onMount(() => {
    setSelectedIds(frames().slice(0, 1).map((item) => item.id))
  })

  createEffect(() => {
    if (auth.token()) return
    const first = localPayloads()[0]
    if (first) setDocument(first.document)
  })

  return (
    <div class="grid min-h-[760px] grid-cols-[240px_minmax(0,1fr)_300px] overflow-hidden rounded-xl border border-border-weaker-base bg-background-base">
      <aside class="min-h-0 border-r border-border-weaker-base bg-surface-base flex flex-col">
        <div class="border-b border-border-weaker-base p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-13-medium text-text-base">Designer</div>
              <div class="truncate text-11-medium text-text-weak">{auth.isAuthenticated() ? "Cloud designs" : "Local designs"}</div>
            </div>
            <Button variant="ghost" class="h-8 px-2 text-11-medium" onClick={newDesign}>
              New
            </Button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-2">
          <For each={designs() ?? []}>
            {(item) => (
              <button
                type="button"
                class="mb-1 w-full rounded-lg px-2 py-2 text-left hover:bg-background-stronger"
                onClick={() => void loadDesign(item.id)}
              >
                <div class="truncate text-12-medium text-text-base">{item.name}</div>
                <div class="mt-0.5 truncate text-11-medium text-text-weak">{item.frameCount} frames</div>
              </button>
            )}
          </For>
          <Show when={designs.loading}>
            <div class="p-2 text-12-medium text-text-weak">Loading designs...</div>
          </Show>
        </div>
        <div class="border-t border-border-weaker-base p-2">
          <div class="mb-2 text-11-medium text-text-weak">Layers</div>
          <For each={frames()}>
            {(frame) => (
              <div class="mb-1">
                <LayerButton item={frame} selected={selectedIds().includes(frame.id)} onSelect={() => setSelectedIds([frame.id])} />
                <div class="ml-3">
                  <For each={frameChildren(document(), frame.id)}>
                    {(item) => <LayerButton item={item} selected={selectedIds().includes(item.id)} onSelect={() => setSelectedIds([item.id])} />}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </aside>

      <main class="min-w-0 min-h-0 flex flex-col">
        <div class="min-h-11 border-b border-border-weaker-base bg-surface-base px-3 py-2 flex flex-wrap items-center gap-2">
          <input
            class="h-8 w-56 rounded-lg border border-border-weaker-base bg-background-base px-2 text-12-medium text-text-base outline-none"
            value={document().name}
            onInput={(event) => setDocument((current) => ({ ...current, name: event.currentTarget.value, updatedAt: new Date().toISOString() }))}
            aria-label="Design name"
          />
          <ToolbarButton label="Frame" onClick={addFrame} />
          <ToolbarButton label="Rect" onClick={() => addShape("rect")} />
          <ToolbarButton label="Ellipse" onClick={() => addShape("ellipse")} />
          <ToolbarButton label="Text" onClick={addText} />
          <ToolbarButton label="Delete" onClick={removeSelected} disabled={!selectedIds().length} />
          <div class="mx-1 h-5 w-px bg-border-weaker-base" />
          <ToolbarButton label="Undo" onClick={undo} disabled={!undoStack().length} />
          <ToolbarButton label="Redo" onClick={redo} disabled={!redoStack().length} />
          <div class="min-w-0 flex-1" />
          <ToolbarButton label="JSON" onClick={exportJson} />
          <ToolbarButton label="HTML" onClick={exportHtml} />
          <Button class="h-8 px-3 text-11-medium" onClick={() => void saveDesign()} disabled={saving()}>
            {saving() ? "Saving" : "Save"}
          </Button>
        </div>

        <div class="min-h-0 flex-1 bg-[#0f0f0f]">
          <DesignerCanvas
            document={document()}
            selectedIds={selectedIds()}
            onSelect={(ids) => setSelectedIds(ids)}
            onChange={(id, patch) => updateElement(id, patch)}
          />
        </div>

        <div class="border-t border-border-weaker-base bg-surface-base p-2 flex flex-wrap items-center gap-2">
          <ToolbarButton label="Attach" onClick={() => attach("chat")} />
          <ToolbarButton label="Inspiration" onClick={() => attach("inspiration")} />
          <ToolbarButton label="Build website" onClick={() => attach("website")} />
          <ToolbarButton label="Create template" onClick={() => attach("template")} />
          <ToolbarButton label="AI edit" onClick={() => void copyAiRequest()} />
        </div>
      </main>

      <aside class="min-h-0 border-l border-border-weaker-base bg-surface-base flex flex-col">
        <div class="border-b border-border-weaker-base p-3">
          <div class="text-13-medium text-text-base">Inspector</div>
          <div class="mt-1 text-11-medium text-text-weak">
            {selectedElement() ? selectedElement()?.name : "Select a frame or layer"}
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-3">
          <Show when={selectedElement()} fallback={<div class="text-12-medium text-text-weak">No selection.</div>}>
            {(item) => (
              <div class="grid gap-3">
                <InspectorText label="Name" value={item().name} onInput={(value) => updateElement(item().id, { name: value })} />
                <div class="grid grid-cols-2 gap-2">
                  <InspectorNumber label="X" value={item().x} onInput={(value) => updateElement(item().id, { x: value })} />
                  <InspectorNumber label="Y" value={item().y} onInput={(value) => updateElement(item().id, { y: value })} />
                  <InspectorNumber label="W" value={item().width} onInput={(value) => updateElement(item().id, { width: value })} />
                  <InspectorNumber label="H" value={item().height} onInput={(value) => updateElement(item().id, { height: value })} />
                </div>
                <InspectorText label="Fill" value={item().fill ?? ""} onInput={(value) => updateElement(item().id, { fill: value })} />
                <InspectorText label="Stroke" value={item().stroke ?? ""} onInput={(value) => updateElement(item().id, { stroke: value || undefined })} />
                <InspectorNumber label="Radius" value={item().radius ?? 0} onInput={(value) => updateElement(item().id, { radius: value })} />
                <Show when={item().type === "text"}>
                  <InspectorText label="Text" value={item().text ?? ""} onInput={(value) => updateElement(item().id, { text: value })} multiline />
                  <InspectorNumber label="Font size" value={item().fontSize ?? 16} onInput={(value) => updateElement(item().id, { fontSize: value })} />
                </Show>
              </div>
            )}
          </Show>

          <div class="mt-6 border-t border-border-weaker-base pt-4">
            <div class="text-13-medium text-text-base">AI operations</div>
            <textarea
              class="mt-2 h-20 w-full resize-none rounded-lg border border-border-weaker-base bg-background-base p-2 text-12-regular text-text-base outline-none"
              value={aiPrompt()}
              onInput={(event) => setAiPrompt(event.currentTarget.value)}
              aria-label="AI design prompt"
            />
            <div class="mt-2 flex gap-2">
              <Button variant="ghost" class="h-8 px-2 text-11-medium" onClick={draftFromPrompt}>
                Draft ops
              </Button>
              <Button variant="ghost" class="h-8 px-2 text-11-medium" onClick={() => void copyAiRequest()}>
                Request ops
              </Button>
            </div>
            <textarea
              class="mt-3 h-44 w-full resize-none rounded-lg border border-border-weaker-base bg-background-base p-2 font-mono text-11-regular text-text-base outline-none"
              value={opsText()}
              onInput={(event) => setOpsText(event.currentTarget.value)}
              placeholder='[{"type":"createFrame","name":"Hero"}]'
              aria-label="Paddie Designer JSON operations"
            />
            <Button class="mt-2 h-8 w-full justify-center text-11-medium" onClick={applyOps}>
              Apply JSON ops
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function DesignerCanvas(props: {
  document: PaddieDesignDocument
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onChange: (id: string, patch: Partial<PaddieDesignElement>) => void
}) {
  let host: HTMLDivElement | undefined
  let stage: Konva.Stage | undefined
  let layer: Konva.Layer | undefined
  let transformer: Konva.Transformer | undefined
  let observer: ResizeObserver | undefined
  const nodeMap = new Map<string, Konva.Node>()

  onMount(() => {
    if (!host) return
    stage = new Konva.Stage({ container: host, width: host.clientWidth, height: host.clientHeight })
    layer = new Konva.Layer()
    transformer = new Konva.Transformer({
      rotateEnabled: false,
      borderStroke: "#00d4aa",
      anchorStroke: "#00d4aa",
      anchorFill: "#0f0f0f",
      anchorSize: 8,
    })
    stage.add(layer)
    layer.add(transformer)
    stage.on("click tap", (event) => {
      if (event.target === stage) props.onSelect([])
    })
    observer = new ResizeObserver(() => {
      if (!host || !stage) return
      stage.size({ width: host.clientWidth, height: host.clientHeight })
      stage.batchDraw()
    })
    observer.observe(host)
    onCleanup(() => {
      observer?.disconnect()
      stage?.destroy()
    })
  })

  createEffect(() => {
    if (!stage || !layer || !transformer) return
    nodeMap.clear()
    layer.destroyChildren()
    drawGrid(layer, stage.width(), stage.height())
    designFrames(props.document).forEach((frame) => drawElement(layer!, frame, props))
    designElements(props.document)
      .filter((item) => item.type !== "frame")
      .forEach((item) => drawElement(layer!, item, props))
    layer.add(transformer)
    transformer.nodes(props.selectedIds.flatMap((id) => {
      const node = nodeMap.get(id)
      return node ? [node] : []
    }))
    layer.batchDraw()
  })

  const drawElement = (target: Konva.Layer, item: PaddieDesignElement, input: typeof props) => {
    const common = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      opacity: item.opacity ?? 1,
      draggable: !item.locked,
    }
    const node: Konva.Shape =
      item.type === "text"
        ? new Konva.Text({
            ...common,
            text: item.text ?? "",
            fill: item.fill ?? "#f5f5f5",
            fontSize: item.fontSize ?? 16,
            fontFamily: item.fontFamily ?? "system-ui",
            fontStyle: String(item.fontWeight ?? "normal"),
            lineHeight: item.lineHeight ?? 1.2,
          })
        : item.type === "ellipse"
          ? new Konva.Ellipse({
              x: item.x + item.width / 2,
              y: item.y + item.height / 2,
              radiusX: item.width / 2,
              radiusY: item.height / 2,
              fill: item.fill,
              stroke: item.stroke,
              strokeWidth: item.strokeWidth ?? 1,
              opacity: item.opacity ?? 1,
              draggable: !item.locked,
            })
          : new Konva.Rect({
              ...common,
              fill: item.fill,
              stroke: item.stroke,
              strokeWidth: item.strokeWidth ?? 0,
              cornerRadius: item.radius ?? 0,
            })
    node.name(item.id)
    node.on("click tap", (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true
      input.onSelect("shiftKey" in event.evt && event.evt.shiftKey ? [...input.selectedIds, item.id] : [item.id])
    })
    node.on("dragend", () => {
      if (item.type === "ellipse") {
        input.onChange(item.id, { x: node.x() - item.width / 2, y: node.y() - item.height / 2 })
        return
      }
      input.onChange(item.id, { x: node.x(), y: node.y() })
    })
    node.on("transformend", () => {
      const scaleX = node.scaleX()
      const scaleY = node.scaleY()
      node.scale({ x: 1, y: 1 })
      input.onChange(item.id, {
        x: item.type === "ellipse" ? node.x() - (item.width * scaleX) / 2 : node.x(),
        y: item.type === "ellipse" ? node.y() - (item.height * scaleY) / 2 : node.y(),
        width: Math.max(8, item.width * scaleX),
        height: Math.max(8, item.height * scaleY),
      })
    })
    target.add(node)
    nodeMap.set(item.id, node)
    if (item.type === "frame") {
      target.add(
        new Konva.Text({
          x: item.x,
          y: item.y - 20,
          text: item.name,
          fill: "#a1a1aa",
          fontSize: 12,
          listening: false,
        }),
      )
    }
  }

  return <div ref={host} class="h-full w-full" />
}

function drawGrid(layer: Konva.Layer, width: number, height: number) {
  const size = 40
  for (let x = 0; x < width; x += size) {
    layer.add(new Konva.Line({ points: [x, 0, x, height], stroke: "#1f1f22", strokeWidth: 1, listening: false }))
  }
  for (let y = 0; y < height; y += size) {
    layer.add(new Konva.Line({ points: [0, y, width, y], stroke: "#1f1f22", strokeWidth: 1, listening: false }))
  }
}

function ToolbarButton(props: { label: string; onClick: VoidFunction; disabled?: boolean }) {
  return (
    <Button variant="ghost" class="h-8 px-2 text-11-medium" onClick={props.onClick} disabled={props.disabled}>
      {props.label}
    </Button>
  )
}

function LayerButton(props: { item: PaddieDesignElement; selected: boolean; onSelect: VoidFunction }) {
  return (
    <button
      type="button"
      class={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-11-medium ${
        props.selected ? "bg-background-stronger text-text-base" : "text-text-weak hover:bg-background-stronger"
      }`}
      onClick={props.onSelect}
    >
      <span class="truncate">{props.item.name}</span>
    </button>
  )
}

function InspectorText(props: { label: string; value: string; onInput: (value: string) => void; multiline?: boolean }) {
  return (
    <label class="grid gap-1 text-11-medium text-text-weak">
      {props.label}
      <Show
        when={props.multiline}
        fallback={
          <input
            class="h-8 rounded-lg border border-border-weaker-base bg-background-base px-2 text-12-medium text-text-base outline-none"
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        }
      >
        <textarea
          class="h-20 resize-none rounded-lg border border-border-weaker-base bg-background-base p-2 text-12-medium text-text-base outline-none"
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      </Show>
    </label>
  )
}

function InspectorNumber(props: { label: string; value: number; onInput: (value: number) => void }) {
  return (
    <label class="grid gap-1 text-11-medium text-text-weak">
      {props.label}
      <input
        type="number"
        class="h-8 rounded-lg border border-border-weaker-base bg-background-base px-2 text-12-medium text-text-base outline-none"
        value={props.value}
        onInput={(event) => props.onInput(Number(event.currentTarget.value) || 0)}
      />
    </label>
  )
}

function localPayloads(): DesignerPayload[] {
  const raw = window.localStorage.getItem(LOCAL_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isDesignerPayload) : []
  } catch {
    return []
  }
}

function localDesigns(): DesignerListItem[] {
  return localPayloads().map((item) => ({
    id: item.id,
    name: item.name,
    updatedAt: item.updatedAt,
    frameCount: designFrames(item.document).length,
  }))
}

function writeLocalDesign(document: PaddieDesignDocument) {
  const payload = {
    id: document.id,
    name: document.name,
    document,
    updatedAt: new Date().toISOString(),
  }
  const next = [payload, ...localPayloads().filter((item) => item.id !== document.id)].slice(0, 20)
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function isDesignerPayload(value: unknown): value is DesignerPayload {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.id === "string" && typeof record.name === "string" && !!record.document
}
