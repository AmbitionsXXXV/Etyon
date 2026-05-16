import type { ChatMention } from "@etyon/rpc"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useCallback } from "react"
import type { MouseEvent } from "react"

import {
  PROJECT_MENTION_NODE_TYPE,
  getMentionTokenTypeLabel
} from "@/renderer/lib/chat/prompt-input"

const getMentionName = (mention: Pick<ChatMention, "relativePath">): string =>
  mention.relativePath.split("/").at(-1) ?? mention.relativePath

const getMentionFromNodeAttrs = (
  attrs: Record<string, unknown>
): ChatMention => ({
  kind: attrs.kind === "folder" ? "folder" : "file",
  path: typeof attrs.path === "string" ? attrs.path : "",
  relativePath:
    typeof attrs.relativePath === "string" ? attrs.relativePath : "",
  snapshotId: typeof attrs.snapshotId === "string" ? attrs.snapshotId : ""
})

const ProjectMentionNodeView = ({ editor, getPos, node }: NodeViewProps) => {
  const mention = getMentionFromNodeAttrs(node.attrs)
  const handleRemove = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (typeof getPos !== "function") {
        return
      }

      const position = getPos()

      if (typeof position !== "number") {
        return
      }

      editor
        .chain()
        .focus()
        .deleteRange({
          from: position,
          to: position + node.nodeSize
        })
        .run()
    },
    [editor, getPos, node.nodeSize]
  )

  return (
    <NodeViewWrapper
      as="span"
      className="mx-0.5 inline-flex max-w-full align-baseline"
      data-project-mention=""
    >
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/80 px-1.5 py-1 text-sm font-medium text-foreground ring-1 ring-border/70"
        title={mention.relativePath}
      >
        <span className="grid h-5 min-w-5 place-items-center rounded-[4px] bg-foreground/15 px-1 text-[0.62rem] leading-none font-semibold text-muted-foreground uppercase">
          {getMentionTokenTypeLabel(mention)}
        </span>
        <span className="max-w-52 truncate">{getMentionName(mention)}</span>
        <button
          aria-label={`Remove ${mention.relativePath}`}
          className="rounded-sm text-muted-foreground opacity-70 transition-opacity hover:text-foreground hover:opacity-100"
          contentEditable={false}
          onClick={handleRemove}
          type="button"
        >
          <HugeiconsIcon
            className="size-3"
            icon={Cancel01Icon}
            strokeWidth={2}
          />
        </button>
      </span>
    </NodeViewWrapper>
  )
}

export const ProjectMentionExtension = Node.create({
  addAttributes() {
    return {
      kind: {
        default: "file"
      },
      path: {
        default: ""
      },
      relativePath: {
        default: ""
      },
      snapshotId: {
        default: ""
      }
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ProjectMentionNodeView)
  },
  atom: true,
  group: "inline",
  inline: true,
  name: PROJECT_MENTION_NODE_TYPE,
  parseHTML() {
    return [
      {
        tag: `span[data-type="${PROJECT_MENTION_NODE_TYPE}"]`
      }
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": PROJECT_MENTION_NODE_TYPE
      }),
      `@${HTMLAttributes.relativePath ?? ""}`
    ]
  },
  selectable: true
})
