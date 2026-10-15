import { isImageOutputModel } from "@/shared/providers/image-output"

import type { ChatModelGroup, ChatModelOption } from "./model-options"

/**
 * The composer's Image skill: direct image generation with an image-output
 * model, picked separately from the chat model so turning the skill on never
 * rewrites the session's (or the default) chat model.
 *
 * Pure module: no rpc/window imports, so it stays node-testable.
 */

const IMAGE_SKILL_MIN_DRAFT_LENGTH = 6

// Top-level literal: zh/en/ja image-request phrasing. English verbs are
// word-boundaried so "drawer" or "iconic" do not fire; "render" and "paint"
// are left out on purpose — in a coding app they mean React renders and
// browser paints far more often than pictures.
const IMAGE_INTENT_PATTERN =
  /\b(?:draw|sketch|illustrate)\b|\b(?:generate|make|create|design)\s+(?:an?\s+|the\s+)?(?:image|picture|photo|illustration|logo|icon|poster|wallpaper|avatar)s?\b|画(?!面)|生成.{0,6}(?:图|图片|图像|照片)|海报|插画|头像|壁纸|イラスト|画像を/iu

/** True when the draft reads like a request for an image. */
export const shouldSuggestImageSkill = (draft: string): boolean => {
  const trimmed = draft.trim()

  return (
    trimmed.length >= IMAGE_SKILL_MIN_DRAFT_LENGTH &&
    IMAGE_INTENT_PATTERN.test(trimmed)
  )
}

const isImageOutputOption = (option: ChatModelOption): boolean =>
  isImageOutputModel({ capabilities: option.capabilities, id: option.id })

/** Every configured model that can output images, in provider order. */
export const getImageSkillModelOptions = (
  groups: readonly ChatModelGroup[]
): ChatModelOption[] =>
  groups.flatMap((group) => group.options.filter(isImageOutputOption))

/**
 * The image model the skill should use: the user's last pick while it is still
 * configured, else the selected chat model when it can make images, else the
 * first image-output model. Null when none is configured.
 */
export const resolveImageSkillModel = ({
  options,
  preferredValue,
  selectedChatModelValue
}: {
  options: readonly ChatModelOption[]
  preferredValue: string | null
  selectedChatModelValue: string
}): string | null => {
  const values = new Set(options.map((option) => option.value))

  if (preferredValue && values.has(preferredValue)) {
    return preferredValue
  }

  if (values.has(selectedChatModelValue)) {
    return selectedChatModelValue
  }

  return options[0]?.value ?? null
}
