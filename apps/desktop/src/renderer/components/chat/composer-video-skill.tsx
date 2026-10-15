import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Cancel01Icon, Video01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { ComposerImageSkill } from "@/renderer/components/chat/composer-image-skill"
import { resolveImageModeForModelChange } from "@/renderer/lib/chat/image-mode"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_TRANSITION_FAST_CLASS
} from "@/renderer/lib/motion"

const SKILL_ENTER_MOTION = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 4 },
  transition: { duration: MOTION_DURATION.base, ease: MOTION_EASE }
}

/** The active Video skill chip that takes the agent-mode pill's place. */
export const ComposerVideoSkillChip = ({
  disabled,
  label,
  onRemove,
  removeLabel
}: {
  disabled: boolean
  label: string
  onRemove: () => void
  removeLabel: string
}) => (
  <motion.span
    animate={SKILL_ENTER_MOTION.animate}
    className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft pr-1 pl-2.5 text-xs font-medium text-accent-soft-foreground"
    initial={SKILL_ENTER_MOTION.initial}
    transition={SKILL_ENTER_MOTION.transition}
  >
    <HugeiconsIcon icon={Video01Icon} size={14} strokeWidth={2} />
    <span>{label}</span>
    <button
      aria-label={removeLabel}
      className={cn(
        "flex size-6 items-center justify-center rounded-full hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        MOTION_TRANSITION_FAST_CLASS
      )}
      disabled={disabled}
      onClick={onRemove}
      type="button"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.25} />
    </button>
  </motion.span>
)

/**
 * Owns the Video skill's on/off state for one composer. The render settings
 * (model included) are picked afterwards on the choices card, so the skill only
 * names a default video model: the selected chat model when it renders video,
 * else the first one configured. Selecting a video model as the chat model
 * turns the skill on (it cannot chat), the same rule as the Image skill.
 */
export const useComposerVideoSkill = ({
  modelGroups,
  selectedModelValue
}: {
  modelGroups: ChatModelGroup[]
  selectedModelValue: string
}) => {
  const { t } = useI18n()
  const videoOptions = useMemo(
    () =>
      modelGroups
        .flatMap((group) => group.options)
        .filter((option) => option.rendersVideo),
    [modelGroups]
  )
  const isSelectedModelVideoCapable = videoOptions.some(
    (option) => option.value === selectedModelValue
  )
  const [isSkillOn, setIsSkillOn] = useState(isSelectedModelVideoCapable)
  const previousCapableRef = useRef(isSelectedModelVideoCapable)
  const videoModelValue = isSelectedModelVideoCapable
    ? selectedModelValue
    : (videoOptions[0]?.value ?? null)
  const isVideoMode = isSkillOn && videoModelValue !== null
  const hasVideoModels = videoModelValue !== null

  useEffect(() => {
    setIsSkillOn((previous) =>
      resolveImageModeForModelChange({
        isCapable: isSelectedModelVideoCapable,
        previous,
        wasCapable: previousCapableRef.current
      })
    )
    previousCapableRef.current = isSelectedModelVideoCapable
  }, [isSelectedModelVideoCapable])

  const skill = useMemo<ComposerImageSkill>(
    () => ({
      isActive: isVideoMode,
      isAvailable: hasVideoModels,
      labels: {
        menuDescription: t("chat.videoSkill.menuDescription"),
        menuLabel: t("chat.videoSkill.label"),
        remove: t("chat.videoSkill.remove"),
        suggestion: "",
        suggestionDismiss: ""
      },
      onActivate: () => setIsSkillOn(hasVideoModels),
      onDeactivate: () => setIsSkillOn(false)
    }),
    [hasVideoModels, isVideoMode, t]
  )

  return {
    isVideoMode,
    skill,
    videoModelValue: isVideoMode ? (videoModelValue ?? undefined) : undefined
  }
}
