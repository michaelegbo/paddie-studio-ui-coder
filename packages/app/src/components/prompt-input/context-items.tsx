import { Component, For, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import type { ContextItem } from "@/context/prompt"
import { contextItemChip } from "./context-item-chip"

type PromptContextItem = ContextItem & { key: string }

type ContextItemsProps = {
  items: PromptContextItem[]
  active: (item: PromptContextItem) => boolean
  openComment: (item: PromptContextItem) => void
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}

export const PromptContextItems: Component<ContextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
        <For each={props.items}>
          {(item) => {
            const selected = props.active(item)
            const clickable = item.type === "file" && !!item.commentID
            const chip = contextItemChip(item)
            const label = chip.label
            const tip =
              item.type === "file" ? (
                <span class="flex max-w-[300px]">
                  <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">
                    {getDirectory(item.path)}
                  </span>
                  <span class="shrink-0">{getFilename(item.path)}</span>
                </span>
              ) : item.type === "element" ? (
                <div class="flex max-w-[320px] flex-col gap-1">
                  <span class="truncate text-text-invert-base">{item.label}</span>
                  <span class="break-all text-text-invert-base/80">{item.selector}</span>
                </div>
              ) : item.type === "workflow" ? (
                <div class="flex max-w-[320px] flex-col gap-1">
                  <span class="truncate text-text-invert-base">{item.workflowName}</span>
                  <span class="text-text-invert-base/80">
                    {item.nodes.length} nodes, {item.edges.length} links
                  </span>
                  <Show when={item.webhookUrl}>{(value) => <span class="break-all text-text-invert-base/70">{value()}</span>}</Show>
                </div>
              ) : item.type === "inspiration" ? (
                <div class="flex max-w-[320px] flex-col gap-1">
                  <span class="truncate text-text-invert-base">{item.mode === "page" ? item.pageTitle : item.label}</span>
                  <span class="break-all text-text-invert-base/80">{item.url}</span>
                  <Show when={item.selector}>{(value) => <span class="break-all text-text-invert-base/70">{value()}</span>}</Show>
                </div>
              ) : (
                <div class="flex max-w-[320px] flex-col gap-1">
                  <span class="truncate text-text-invert-base">{item.templateName}</span>
                  <span class="text-text-invert-base/80">{item.stack}</span>
                  <Show when={item.partName}>{(value) => <span class="text-text-invert-base/70">{value()}</span>}</Show>
                  <span class="text-text-invert-base/70">{item.files.length} reference files</span>
                </div>
              )
            const body = chip.body

            return (
              <Tooltip value={tip} placement="top" openDelay={2000}>
                <div
                  classList={{
                    "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
                    "hover:bg-surface-interactive-weak": clickable && !selected,
                    "bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover": selected,
                    "bg-background-stronger": !selected,
                  }}
                  onClick={() => clickable && props.openComment(item)}
                >
                  <div class="flex items-center gap-1.5">
                    {item.type === "file" ? (
                      <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-3.5" />
                    ) : item.type === "element" ? (
                      <Icon name="window-cursor" class="shrink-0 size-3.5 text-icon-info-base" />
                    ) : item.type === "workflow" ? (
                      <Icon name="layout-right-full" class="shrink-0 size-3.5 text-icon-info-base" />
                    ) : item.type === "inspiration" ? (
                      <Icon name="window-cursor" class="shrink-0 size-3.5 text-icon-info-base" />
                    ) : (
                      <Icon name="layout-right-full" class="shrink-0 size-3.5 text-icon-info-base" />
                    )}
                    <div class="flex items-center text-11-regular min-w-0 font-medium">
                      <span class="text-text-strong whitespace-nowrap">{label}</span>
                      <Show when={item.type === "file" ? item.selection : undefined}>
                        {(sel) => (
                          <span class="text-text-weak whitespace-nowrap shrink-0">
                            {sel().startLine === sel().endLine
                              ? `:${sel().startLine}`
                              : `:${sel().startLine}-${sel().endLine}`}
                          </span>
                        )}
                      </Show>
                    </div>
                    <IconButton
                      type="button"
                      icon="close-small"
                      variant="ghost"
                      class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.remove(item)
                      }}
                      aria-label={props.t("prompt.context.removeFile")}
                    />
                  </div>
                  <Show when={body}>
                    {(value) => <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{value()}</div>}
                  </Show>
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
