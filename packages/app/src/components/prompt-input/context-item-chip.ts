import { getFilenameTruncated } from "@opencode-ai/core/util/path"
import type { ContextItem } from "@/context/prompt"
import { penpotContextBody, penpotContextLabel } from "@/penpot/helpers"

export function contextItemChip(item: ContextItem & { key: string }) {
  if (item.type === "file") {
    return {
      label: getFilenameTruncated(item.path, 14),
      body: item.comment,
      icon: undefined,
    }
  }

  if (item.type === "element") {
    return {
      label: item.label,
      body: item.text?.trim() || item.selector,
      icon: "window-cursor" as const,
    }
  }

  if (item.type === "workflow") {
    return {
      label: item.workflowName,
      body: `${item.nodes.length} nodes, ${item.edges.length} links`,
      icon: "layout-right-full" as const,
    }
  }

  if (item.type === "memory") {
    return {
      label: item.label,
      body: item.mode === "integration" ? item.userIDStrategy || item.endpoint || item.userID : item.query || item.userID,
      icon: "brain" as const,
    }
  }

  if (item.type === "knowledge-base") {
    return {
      label: item.knowledgeBaseName,
      body:
        item.mode === "all"
          ? `${item.knowledgeBases?.length ?? 0} knowledge bases`
          : item.endpoint || item.integrationNote || item.label,
      icon: "layout-right-full" as const,
    }
  }

  if (item.type === "data-playground") {
    const runtime = item.llm?.provider ? ` via ${item.llm.provider}` : ""
    return {
      label: item.label,
      body:
        item.knowledgeBases.length > 0
          ? `${item.mode} memory, ${item.knowledgeBases.length} KB${item.knowledgeBases.length === 1 ? "" : "s"}${runtime}`
          : `${item.mode} memory playground${runtime}`,
      icon: "brain" as const,
    }
  }

  if (item.type === "inspiration") {
    return {
      label: item.mode === "page" ? item.pageTitle || item.label : item.label,
      body: item.mode === "page" ? item.url : item.text?.trim() || item.selector,
      icon: "window-cursor" as const,
    }
  }

  if (item.type === "autopilot") {
    return {
      label: "Autopilot",
      body: item.goal,
      icon: "brain" as const,
    }
  }

  if (item.type === "penpot-design") {
    return {
      label: penpotContextLabel(item),
      body: penpotContextBody(item),
      icon: "window-cursor" as const,
    }
  }

  return {
    label: item.label || item.partName || item.templateName,
    body: item.selector || item.description,
    icon: "layout-right-full" as const,
  }
}
