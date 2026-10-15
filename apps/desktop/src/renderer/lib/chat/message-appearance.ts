import type {
  ChatMessageActions,
  ChatMessageStyle,
  ChatSettings
} from "@etyon/rpc"

/**
 * Chat message appearance (Settings → Chat → Message style). Assistant replies
 * always fill the reading column; only the user side changes shape.
 *
 * Pure module: no rpc/window imports, so it stays node-testable.
 */

/** Shared width for the message column and the composer, so their edges align. */
export const CHAT_READING_COLUMN_CLASS_NAME = "mx-auto w-full max-w-[720px]"

export const getChatMessageStyle = (
  chat: Pick<ChatSettings, "messageStyle"> | undefined
): ChatMessageStyle => chat?.messageStyle ?? "soft"

export const getChatMessageActions = (
  chat: Pick<ChatSettings, "messageActions"> | undefined
): ChatMessageActions => chat?.messageActions ?? "hover"

// `w-fit` keeps a short bubble hugging its text: without it the bubble is a
// block that stretches to the action row below it, leaving blank space on the
// right of messages like "hello".
const USER_BUBBLE_CLASS_NAME_BY_STYLE = {
  bubble:
    "w-fit rounded-[18px] rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground [&_*]:text-primary-foreground!",
  document:
    "w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-foreground",
  soft: "w-fit rounded-[18px] bg-default px-3.5 py-2 text-default-foreground"
} as const satisfies Record<ChatMessageStyle, string>

export const getUserBubbleClassName = (style: ChatMessageStyle): string =>
  USER_BUBBLE_CLASS_NAME_BY_STYLE[style]

/** The user message wrapper: right-aligned and capped, or full width for document. */
export const getUserMessageColumnClassName = (
  style: ChatMessageStyle
): string =>
  style === "document"
    ? "flex w-full flex-col items-stretch"
    : "flex max-w-[80%] flex-col items-end"

export const getMessageActionsVisibilityClassName = (
  mode: ChatMessageActions
): string =>
  mode === "always"
    ? "visible opacity-100"
    : "invisible opacity-0 group-hover/message:visible group-hover/message:opacity-100 group-focus-within/message:visible group-focus-within/message:opacity-100"
