import { Alert, Button, CloseButton } from "@heroui/react"
import { Idea01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useCallback, useEffect, useReducer } from "react"

import {
  INITIAL_PLAN_HINT_STATE,
  planHintReducer,
  shouldSuggestPlanMode
} from "@/renderer/lib/chat/plan-hint"

const PLAN_HINT_DEBOUNCE_MS = 600

// Enter-only motion tuned to the composer's other micro-motions (see
// PERMISSION_MODE_PULSE_MOTION) — a short fade + rise, no layout shift. No
// AnimatePresence exit: in the dev renderer the exit path could leave the
// wrapper mounted at opacity 0, and the invisible strip swallowed clicks on
// the message-actions row beneath it. Hiding unmounts immediately instead.
const PLAN_HINT_MOTION = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 6 },
  transition: { duration: 0.18 }
}

/**
 * Owns the timed plan-mode hint's visibility. The pure {@link planHintReducer}
 * enforces the frequency rules (once per draft, stop after two dismissals); this
 * hook layers the debounce and eligibility side-effects on top.
 */
export const usePlanModeHint = ({
  draft,
  isEligible
}: {
  draft: string
  isEligible: boolean
}): {
  conceal: () => void
  dismiss: () => void
  isVisible: boolean
} => {
  const [state, dispatch] = useReducer(planHintReducer, INITIAL_PLAN_HINT_STATE)

  // Draft sent or cleared: end this draft lifecycle so a fresh one may show.
  useEffect(() => {
    if (draft.trim().length === 0) {
      dispatch({ type: "reset" })
    }
  }, [draft])

  // Evaluate ~600ms after typing pauses, only while the composer is eligible.
  useEffect(() => {
    if (!isEligible || draft.trim().length === 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      dispatch({ canShow: shouldSuggestPlanMode(draft), type: "evaluate" })
    }, PLAN_HINT_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [draft, isEligible])

  // Leaving an eligible state (mode switch, request start, image mode) hides the
  // hint without counting it as a dismissal.
  useEffect(() => {
    if (!isEligible) {
      dispatch({ type: "conceal" })
    }
  }, [isEligible])

  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), [])
  const conceal = useCallback(() => dispatch({ type: "conceal" }), [])

  return { conceal, dismiss, isVisible: state.visible }
}

export const ComposerPlanHint = ({
  dismissLabel,
  isVisible,
  onConceal,
  onDismiss,
  onSwitch,
  switchLabel,
  title
}: {
  dismissLabel: string
  isVisible: boolean
  // Auto-timeout — hides without counting toward the two-dismissal guard.
  onConceal: () => void
  // Explicit close (X / Escape) — counts toward the guard.
  onDismiss: () => void
  onSwitch: () => void
  switchLabel: string
  title: string
}) => {
  useEffect(() => {
    if (!isVisible) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isVisible, onDismiss])

  if (!isVisible) {
    return null
  }

  return (
    <motion.div
      animate={PLAN_HINT_MOTION.animate}
      className="plan-hint-surface pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2"
      initial={PLAN_HINT_MOTION.initial}
      transition={PLAN_HINT_MOTION.transition}
    >
      <Alert
        className="pointer-events-auto relative overflow-hidden border border-warning/30 bg-warning/10 shadow-overlay"
        status="warning"
      >
        <Alert.Indicator>
          <HugeiconsIcon icon={Idea01Icon} size={16} />
        </Alert.Indicator>
        <Alert.Content className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Alert.Title className="text-sm">{title}</Alert.Title>
          <Button
            className="ml-auto shrink-0"
            onPress={onSwitch}
            size="sm"
            type="button"
            variant="primary"
          >
            {switchLabel}
          </Button>
        </Alert.Content>
        <CloseButton aria-label={dismissLabel} onPress={onDismiss} />
        <span
          aria-hidden="true"
          className="plan-hint-countdown absolute inset-x-0 bottom-0 h-[1.5px] bg-warning"
          onAnimationEnd={onConceal}
        />
      </Alert>
    </motion.div>
  )
}
