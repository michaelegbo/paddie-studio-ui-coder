import { getFilenameTruncated } from "@opencode-ai/core/util/path"
import type { ContextItem } from "@/context/prompt"

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

  if (item.type === "inspiration") {
    return {
      label: item.mode === "page" ? item.pageTitle || item.label : item.label,
      body: item.mode === "page" ? item.url : item.text?.trim() || item.selector,
      icon: "window-cursor" as const,
    }
  }

  return {
    label: item.label || item.partName || item.templateName,
    body: item.selector || item.description,
    icon: "layout-right-full" as const,
  }
}
