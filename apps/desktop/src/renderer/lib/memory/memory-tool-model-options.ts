import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"

export const MEMORY_TOOL_MODEL_AUTO_VALUE = "__auto__"

export const findChatModelLabel = (
  modelGroups: ChatModelGroup[],
  value: string
): string | null =>
  modelGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === value)?.label ?? null

export const getMemoryToolModelSelectedValue = (value: string): string =>
  value || MEMORY_TOOL_MODEL_AUTO_VALUE

export const normalizeMemoryToolModelValue = (
  value: null | number | string
): string =>
  value === null || value === MEMORY_TOOL_MODEL_AUTO_VALUE
    ? MEMORY_TOOL_MODEL_AUTO_VALUE
    : String(value)
