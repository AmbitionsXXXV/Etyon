import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"

import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_FADE_IN,
  MOTION_RISE_PX
} from "@/renderer/lib/motion"

/**
 * Chrome shared by the timeline's interaction cards (ask_user, plans, the
 * Video skill and storyboard cards): how a card enters, and the one-line
 * summary it collapses to once answered.
 */

// The one entrance in the timeline allowed a scale: an approval or interaction
// card asks the user to act, so it lands with slightly more weight than a row.
export const APPROVAL_CARD_MOTION = {
  animate: { opacity: 1, scale: 1, y: 0 },
  initial: { opacity: 0, scale: 0.97, y: MOTION_RISE_PX },
  transition: { duration: MOTION_DURATION.gentle, ease: MOTION_EASE }
}

// Answered / historical collapse for both interaction cards: one compact
// trace-style line echoing the prompt and the chosen answer.
export const InputToolAnsweredLine = ({
  icon,
  isJustAnswered,
  label,
  value
}: {
  icon: IconSvgElement
  // Only the card that settled in front of the user cross-fades; a historical
  // answer is simply there when its message mounts.
  isJustAnswered: boolean
  label: string
  value: string
}) => (
  <motion.div
    animate={MOTION_FADE_IN.animate}
    className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2 py-1.5"
    initial={isJustAnswered ? MOTION_FADE_IN.initial : false}
    transition={MOTION_FADE_IN.transition}
  >
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
      <HugeiconsIcon icon={icon} size={13} />
    </span>
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      {label}
    </span>
    {value ? (
      <span className="max-w-[55%] min-w-0 shrink-0 truncate text-xs font-medium text-foreground">
        {value}
      </span>
    ) : null}
  </motion.div>
)
