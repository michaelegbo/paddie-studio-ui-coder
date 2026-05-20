import { getFilename } from "@opencode-ai/core/util/path"
import { type AgentPartInput, type FilePartInput, type Part, type TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type {
  AgentPart,
  ElementContextItem,
  FileAttachmentPart,
  FileContextItem,
  ImageAttachmentPart,
  InspirationContextItem,
  Prompt,
  TemplateContextItem,
  WorkflowContextItem,
} from "@/context/prompt"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type PromptRequestPart = (TextPartInput | FilePartInput | AgentPartInput) & { id: string }

type BuildRequestPartsInput = {
  prompt: Prompt
  context: ({
    key: string
  } & (FileContextItem | ElementContextItem | TemplateContextItem | WorkflowContextItem | InspirationContextItem))[]
  images: ImageAttachmentPart[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"
const isElementContext = (item: BuildRequestPartsInput["context"][number]): item is { key: string } & ElementContextItem =>
  item.type === "element"
const isTemplateContext = (
  item: BuildRequestPartsInput["context"][number],
): item is { key: string } & TemplateContextItem => item.type === "template"
const isWorkflowContext = (
  item: BuildRequestPartsInput["context"][number],
): item is { key: string } & WorkflowContextItem => item.type === "workflow"
const isInspirationContext = (
  item: BuildRequestPartsInput["context"][number],
): item is { key: string } & InspirationContextItem => item.type === "inspiration"

const TEMPLATE_REFERENCE_FILE_LIMIT = 48_000
const TEMPLATE_REFERENCE_TOTAL_LIMIT = 140_000
const TEMPLATE_REFERENCE_EXCLUDED =
  /(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo|\.vite)(\/|$)|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb)$|\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|eot|mp4|webm|mov|zip|gz|br|pdf)$/i

const templatePath = (value: string) => value.replaceAll("\\", "/")

const isTemplateReferenceFile = (file: TemplateContextItem["files"][number]) => {
  if (file.encoding === "base64") return false
  return !TEMPLATE_REFERENCE_EXCLUDED.test(templatePath(file.path))
}

const trimTemplateReference = (content: string, limit: number) => {
  if (content.length <= limit) return { content, truncated: false }
  return {
    content: `${content.slice(0, limit)}\n\n[Template file truncated after ${limit} characters.]`,
    truncated: true,
  }
}

const formatTemplateReferenceFiles = (files: TemplateContextItem["files"]) => {
  const usable = files.filter(isTemplateReferenceFile)
  const result = usable.reduce<{
    blocks: string[]
    used: number
    omitted: number
    truncated: number
  }>(
    (acc, file) => {
      const remaining = TEMPLATE_REFERENCE_TOTAL_LIMIT - acc.used
      if (remaining <= 0) return { ...acc, omitted: acc.omitted + 1 }
      const trimmed = trimTemplateReference(file.content, Math.min(TEMPLATE_REFERENCE_FILE_LIMIT, remaining))
      return {
        blocks: [...acc.blocks, [`--- ${file.path} ---`, trimmed.content].join("\n")],
        used: acc.used + trimmed.content.length,
        omitted: acc.omitted,
        truncated: acc.truncated + (trimmed.truncated ? 1 : 0),
      }
    },
    { blocks: [], used: 0, omitted: files.length - usable.length, truncated: 0 },
  )

  const notes = [
    result.omitted > 0
      ? `${result.omitted} generated, binary, lock, or overflow file${result.omitted === 1 ? " was" : "s were"} omitted to keep the template reference focused.`
      : "",
    result.truncated > 0
      ? `${result.truncated} large template file${result.truncated === 1 ? " was" : "s were"} truncated.`
      : "",
  ].filter(Boolean)

  return { blocks: result.blocks, notes }
}

const formatElementNote = (item: ElementContextItem) => {
  const lines = [
    `The user selected the following preview element from ${item.url}.`,
    `Element: ${item.label}`,
    `Selector: ${item.selector}`,
  ]
  const text = item.text?.trim()
  if (text) lines.push(`Text: ${text}`)
  lines.push(`Outer HTML:\n${item.html}`)
  return lines.join("\n")
}

const formatTemplateNote = (item: TemplateContextItem) => {
  const references = formatTemplateReferenceFiles(item.files)
  const lines = [
    "The user attached the following design template as a high-fidelity implementation reference.",
    `Template: ${item.templateName}`,
    `Description: ${item.description}`,
    `Stack: ${item.stack}`,
  ]
  if (item.partName) lines.push(`Selected part: ${item.partName}`)
  if (item.label) lines.push(`Selected element: ${item.label}`)
  if (item.selector) lines.push(`Selector: ${item.selector}`)
  if (item.text?.trim()) lines.push(`Text: ${item.text.trim()}`)
  if (item.html?.trim()) lines.push(`Outer HTML:\n${item.html.trim()}`)
  if (item.hint?.trim()) lines.push(`Guidance: ${item.hint.trim()}`)
  lines.push(
    "Apply the selected template faithfully: preserve its visible layout, spacing, hierarchy, colors, and interaction intent while fitting the current codebase.",
  )
  lines.push("Use the selected element, selector, and part guidance as the priority signal when they are present.")
  if (references.notes.length) lines.push(...references.notes)
  lines.push("Reference files:")
  lines.push(...references.blocks)
  return lines.join("\n\n")
}

const formatWorkflowNote = (item: WorkflowContextItem) => {
  const nodes = item.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    name: node.name,
    config: node.config ?? {},
  }))
  const edges = item.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    condition: edge.condition,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }))
  const lines = [
    "The user attached the following Paddie Studio workflow as an implementation reference.",
    `Workflow: ${item.workflowName}`,
    `Workflow ID: ${item.workflowID}`,
    `Status: ${item.status}`,
    `Nodes: ${item.nodes.length}`,
    `Edges: ${item.edges.length}`,
  ]
  if (item.description?.trim()) lines.push(`Description: ${item.description.trim()}`)
  if (item.method) lines.push(`Webhook method: ${item.method}`)
  if (item.webhookUrl) lines.push(`Webhook URL: ${item.webhookUrl}`)
  if (item.updatedAt) lines.push(`Last updated: ${item.updatedAt}`)
  if (item.revision !== undefined) lines.push(`Revision: ${item.revision}`)
  lines.push(
    "Use this workflow from the current codebase by creating or updating a small integration wrapper, service, hook, route, or action that calls the generated client. Do not rewrite the workflow graph manually unless the user asks.",
  )
  lines.push(
    "Prefer environment/config-driven URLs when appropriate, keep the generated function reusable, and preserve the workflow's node order and data-flow semantics.",
  )
  lines.push(`Generated ${item.language} client code:\n${item.code}`)
  lines.push(`Workflow graph JSON:\n${JSON.stringify({ nodes, edges }, null, 2)}`)
  return lines.join("\n\n")
}

const formatStyleSignals = (item: InspirationContextItem) => {
  const groups = [
    ["Colors", item.styleSignals.colors],
    ["Typography", item.styleSignals.typography],
    ["Layout and spacing", item.styleSignals.layout],
    ["Borders", item.styleSignals.borders],
    ["Shadows", item.styleSignals.shadows],
    ["Transitions", item.styleSignals.transitions],
    ["Animations", item.styleSignals.animations],
    ["Keyframes", item.styleSignals.keyframes],
  ] as const

  return groups.flatMap(([label, values]) => (values.length ? [`${label}: ${values.join("; ")}`] : []))
}

const formatInspirationNote = (item: InspirationContextItem) => {
  const lines = [
    "The user attached the following public website as a high-fidelity design and motion inspiration reference.",
    `URL: ${item.url}`,
    `Page title: ${item.pageTitle}`,
    `Reference mode: ${item.mode}`,
    `Reference label: ${item.label}`,
  ]
  if (item.selector) lines.push(`Selector: ${item.selector}`)
  if (item.text?.trim()) lines.push(`Text: ${item.text.trim()}`)
  lines.push(
    "Adapt the visible layout, spacing, hierarchy, colors, typography, component density, and motion intent to the current project. Do not copy private assets, logos, trademarks, brand text, or branding verbatim.",
  )
  const signals = formatStyleSignals(item)
  if (signals.length) {
    lines.push("Extracted style and motion signals:")
    lines.push(...signals)
  }
  if (item.html.trim()) lines.push(`Reference HTML:\n${item.html.trim()}`)
  return lines.join("\n\n")
}

const toOptimisticPart = (part: PromptRequestPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.filename,
      url: part.url,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.source,
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: PromptRequestPart[] = [
    {
      id: Identifier.ascending("part"),
      type: "text",
      text: input.text,
    },
  ]

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url: `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      filename: getFilename(attachment.path),
      source: {
        type: "file",
        text: {
          value: attachment.content,
          start: attachment.start,
          end: attachment.end,
        },
        path,
      },
    } satisfies PromptRequestPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies PromptRequestPart
  })

  const used = new Set(files.map((part) => part.url))
  const context: PromptRequestPart[] = input.context.flatMap<PromptRequestPart>((item) => {
    if (isElementContext(item)) {
      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatElementNote(item),
          synthetic: true,
        } satisfies PromptRequestPart,
      ]
    }

    if (isTemplateContext(item)) {
      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatTemplateNote(item),
          synthetic: true,
        } satisfies PromptRequestPart,
      ]
    }

    if (isWorkflowContext(item)) {
      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatWorkflowNote(item),
          synthetic: true,
        } satisfies PromptRequestPart,
      ]
    }

    if (isInspirationContext(item)) {
      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatInspirationNote(item),
          synthetic: true,
        } satisfies PromptRequestPart,
      ]
    }

    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(url)) return []
    used.add(url)

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url,
      filename: getFilename(item.path),
    } satisfies PromptRequestPart

    if (!comment) return [filePart]

    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(url)) return []
      used.add(url)
      return [
        {
          id: Identifier.ascending("part"),
          type: "file",
          mime: "text/plain",
          url,
          filename: getFilename(path),
        } satisfies PromptRequestPart,
      ]
    })

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: formatCommentNote({ path: item.path, selection: item.selection, comment }),
        synthetic: true,
        metadata: createCommentMetadata({
          path: item.path,
          selection: item.selection,
          comment,
          preview: item.preview,
          origin: item.commentOrigin,
        }),
      } satisfies PromptRequestPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    } satisfies PromptRequestPart
  })

  requestParts.push(...files, ...context, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}
