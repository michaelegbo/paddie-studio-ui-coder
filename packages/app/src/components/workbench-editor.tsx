import { createEffect, on, onCleanup, onMount } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"
import * as monaco from "monaco-editor"
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import { from, pick, type Problem } from "./workbench-problem"

const env = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_: string, label: string) => Worker
  }
}

env.MonacoEnvironment ??= {
  getWorker: (_, label) => {
    if (label === "json") return new JsonWorker()
    if (label === "css" || label === "scss" || label === "less") return new CssWorker()
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker()
    if (label === "typescript" || label === "javascript") return new TsWorker()
    return new EditorWorker()
  },
}

const FIX = "paddie.fix-problem"
const runs = new Map<string, (item: Problem) => void>()
let cmd: monaco.IDisposable | undefined
let hover: monaco.IDisposable | undefined
let code: monaco.IDisposable | undefined

const key = (path: string) => monaco.Uri.file(path).toString()
const range = (item: Problem) =>
  new monaco.Range(item.startLine, item.startChar + 1, item.endLine, Math.max(item.startChar + 1, item.endChar + 1))
const link = (item: Problem) => {
  return {
    value: `[Fix with Paddie Studio](command:${FIX}?${encodeURIComponent(JSON.stringify([item]))})`,
    isTrusted: true,
  } satisfies monaco.IMarkdownString
}
const list = (path: string, model: monaco.editor.ITextModel) =>
  monaco.editor.getModelMarkers({ resource: model.uri }).map((item) => from(path, item))
const setup = () => {
  cmd ??= monaco.editor.registerCommand(FIX, (_, item: Problem | undefined) => {
    if (!item) return
    runs.get(key(item.path))?.(item)
  })
  hover ??= monaco.languages.registerHoverProvider({ scheme: "file" }, {
    provideHover(model, pos) {
      const item = pick(list(model.uri.fsPath, model), pos.lineNumber, pos.column)
      if (!item) return
      return {
        range: range(item),
        contents: [link(item)],
      }
    },
  })
  code ??= monaco.languages.registerCodeActionProvider(
    { scheme: "file" },
    {
      provideCodeActions(model, range, ctx) {
        const all = ctx.markers.map((item) => from(model.uri.fsPath, item))
        const item = pick(all, range.startLineNumber, range.startColumn) ?? all[0]
        if (!item) {
          return {
            actions: [],
            dispose() {},
          }
        }
        return {
          actions: [
            {
              title: "Fix with Paddie Studio",
              kind: "quickfix",
              isPreferred: true,
              diagnostics: ctx.markers,
              command: {
                id: FIX,
                title: "Fix with Paddie Studio",
                arguments: [item],
              },
            },
          ],
          dispose() {},
        }
      },
    },
    { providedCodeActionKinds: ["quickfix"] },
  )
}

export function WorkbenchEditor(props: {
  path: string
  value: string
  onChange: (value: string) => void
  onSave: VoidFunction
  onProblem: (item: Problem) => void
}) {
  const theme = useTheme()
  let root: HTMLDivElement | undefined
  let view: monaco.editor.IStandaloneCodeEditor | undefined
  let model: monaco.editor.ITextModel | undefined
  let skip = false
  let act: monaco.IDisposable | undefined
  let mark: monaco.IDisposable | undefined
  let cur: monaco.editor.IContextKey<boolean> | undefined
  let item: Problem | undefined

  const sync = (path: string, value: string) => {
    if (!view) return
    const uri = monaco.Uri.file(path)
    const next = monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, undefined, uri)
    const prev = model
    model = next
    runs.set(next.uri.toString(), (item) => props.onProblem(item))
    if (prev && prev.uri.toString() !== next.uri.toString()) runs.delete(prev.uri.toString())
    if (next.getValue() !== value) {
      skip = true
      next.setValue(value)
      skip = false
    }
    skip = true
    view.setModel(next)
    skip = false
    const pos = view.getPosition()
    item = pos ? pick(list(path, next), pos.lineNumber, pos.column) : undefined
    cur?.set(!!item)
    if (prev === next) return
    prev?.dispose()
  }

  const problem = () => {
    if (!view || !model) return
    const pos = view.getPosition()
    item = pos ? pick(list(model.uri.fsPath, model), pos.lineNumber, pos.column) : undefined
    cur?.set(!!item)
  }

  onMount(() => {
    if (!root) return
    setup()

    view = monaco.editor.create(root, {
      automaticLayout: true,
      fontLigatures: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
    })

    cur = view.createContextKey("paddieProblem", false)
    act = view.addAction({
      id: "paddie.fix-problem.action",
      label: "Fix with Paddie Studio",
      precondition: "paddieProblem",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0.5,
      run: () => {
        if (!item) return
        props.onProblem(item)
      },
    })
    view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => props.onSave())
    view.onDidChangeCursorPosition(problem)
    view.onDidChangeModelContent(() => {
      if (skip || !view) return
      props.onChange(view.getValue())
    })
    mark = monaco.editor.onDidChangeMarkers((list) => {
      if (!model) return
      if (!list.some((item) => item.toString() === model?.uri.toString())) return
      problem()
    })

    sync(props.path, props.value)
  })

  createEffect(() => {
    monaco.editor.setTheme(theme.mode() === "dark" ? "vs-dark" : "vs")
  })

  createEffect(
    on(
      () => props.path,
      () => {
        if (!view) return
        sync(props.path, props.value)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!view || !model) return
    if (model.uri.fsPath !== monaco.Uri.file(props.path).fsPath) return
    if (model.getValue() === props.value) return
    skip = true
    model.setValue(props.value)
    skip = false
  })

  onCleanup(() => {
    runs.delete(model?.uri.toString() ?? "")
    mark?.dispose()
    act?.dispose()
    model?.dispose()
    view?.dispose()
  })

  return (
    <div
      ref={root}
      class="size-full"
      data-workbench-editor
      data-prevent-autofocus
      onPointerDown={() => view?.focus()}
    />
  )
}
