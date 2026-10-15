import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import {
  CheckmarkCircle01Icon,
  Film01Icon,
  Image01Icon,
  LayoutGridIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useParams } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useState } from "react"

import {
  APPROVAL_CARD_MOTION,
  InputToolAnsweredLine
} from "@/renderer/components/chat/input-card-chrome"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { requestPanelSurface } from "@/renderer/lib/chat/panel-open-request"
import {
  describeKeyframeJoin,
  getStoryboardCurateCardInput,
  getStoryboardCurateCardOutput,
  getStoryboardKeyframesState,
  getStoryboardPlanCardInput,
  getStoryboardPlanCardOutput,
  getStoryboardReelClips
} from "@/renderer/lib/chat/storyboard-message"
import { useHasChangedSinceMount } from "@/renderer/lib/motion"
import { addClipToEditor } from "@/renderer/lib/video-editor/editor-store"
import { buildMediaUrl } from "@/shared/chat/media-url"
import { STORYBOARD_VARIANTS } from "@/shared/chat/storyboard"
import type { StoryboardPicks, StoryboardPlan } from "@/shared/chat/storyboard"

const TEXTAREA_CLASS_NAME =
  "w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"

const PromptField = ({
  isDisabled,
  label,
  onChange,
  value
}: {
  isDisabled: boolean
  label: string
  onChange: (value: string) => void
  value: string
}) => (
  <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
    {label}
    <textarea
      className={TEXTAREA_CLASS_NAME}
      disabled={isDisabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      rows={2}
      value={value}
    />
  </label>
)

/**
 * The storyboard's first stop: the drafted keyframes and shots, interleaved in
 * the order they play, editable before any image is paid for.
 */
export const StoryboardPlanCard = ({
  isDisabled,
  onSubmit,
  part
}: {
  isDisabled: boolean
  onSubmit: (part: ChatToolPart, output: { plan: StoryboardPlan }) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const input = getStoryboardPlanCardInput(part)
  const isPending = part.state === "input-available"
  const isJustAnswered = useHasChangedSinceMount(isPending)
  const [submitted, setSubmitted] = useState(false)
  const [plan, setPlan] = useState<StoryboardPlan | null>(input?.plan ?? null)
  const isLocked = submitted || isDisabled || !isPending

  if (!isPending) {
    const answered = getStoryboardPlanCardOutput(part)

    return (
      <InputToolAnsweredLine
        icon={LayoutGridIcon}
        isJustAnswered={isJustAnswered}
        label={input?.title ?? t("chat.storyboard.planTitle")}
        value={
          answered
            ? t("chat.storyboard.shotCount", { count: answered.shots.length })
            : ""
        }
      />
    )
  }

  if (!(input && plan)) {
    return null
  }

  const setKeyframe = (index: number, prompt: string) =>
    setPlan({
      ...plan,
      keyframes: plan.keyframes.map((keyframe, candidate) =>
        candidate === index ? { prompt } : keyframe
      )
    })
  const setShot = (index: number, prompt: string) =>
    setPlan({
      ...plan,
      shots: plan.shots.map((shot, candidate) =>
        candidate === index ? { prompt } : shot
      )
    })
  const isComplete =
    plan.keyframes.every((keyframe) => keyframe.prompt.trim()) &&
    plan.shots.every((shot) => shot.prompt.trim())

  return (
    <motion.div
      animate={APPROVAL_CARD_MOTION.animate}
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/60 p-3"
      initial={APPROVAL_CARD_MOTION.initial}
      transition={APPROVAL_CARD_MOTION.transition}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={LayoutGridIcon}
          size={15}
        />
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-foreground">
          {t("chat.storyboard.planTitle")}
        </p>
      </div>
      <PromptField
        isDisabled={isLocked}
        label={t("chat.storyboard.style")}
        onChange={(style) => setPlan({ ...plan, style })}
        value={plan.style}
      />
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {plan.keyframes.map((keyframe, index) => {
          const shot = plan.shots[index]

          return (
            // oxlint-disable-next-line react/no-array-index-key -- positions are the identity: keyframe i always sits before shot i
            <li className="flex flex-col gap-2" key={`plan-${index}`}>
              <PromptField
                isDisabled={isLocked}
                label={t("chat.storyboard.keyframe", { index })}
                onChange={(prompt) => setKeyframe(index, prompt)}
                value={keyframe.prompt}
              />
              {shot ? (
                <div className="ml-3 border-l-2 border-border/70 pl-3">
                  <PromptField
                    isDisabled={isLocked}
                    label={t("chat.storyboard.shot", { index: index + 1 })}
                    onChange={(prompt) => setShot(index, prompt)}
                    value={shot.prompt}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
        <span className="text-xs text-muted-foreground">
          {t("chat.storyboard.imageCount", {
            count: plan.keyframes.length * STORYBOARD_VARIANTS
          })}
        </span>
        <Button
          className="ml-auto"
          isDisabled={isLocked || !isComplete}
          onPress={() => {
            setSubmitted(true)
            onSubmit(part, { plan })
          }}
          size="sm"
          type="button"
          variant="primary"
        >
          {t("chat.storyboard.makeKeyframes")}
        </Button>
      </div>
    </motion.div>
  )
}

/** One pick per keyframe; every pick joins the shot before it to the next. */
export const StoryboardCurateCard = ({
  isDisabled,
  onSubmit,
  part
}: {
  isDisabled: boolean
  onSubmit: (part: ChatToolPart, output: StoryboardPicks) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const { sessionId } = useParams({ strict: false })
  const input = getStoryboardCurateCardInput(part)
  const isPending = part.state === "input-available"
  const isJustAnswered = useHasChangedSinceMount(isPending)
  const [submitted, setSubmitted] = useState(false)
  const [picks, setPicks] = useState<number[]>(() =>
    (input?.keyframes ?? []).map(() => 0)
  )
  const isLocked = submitted || isDisabled || !isPending

  if (!isPending) {
    const answered = getStoryboardCurateCardOutput(part)

    return (
      <InputToolAnsweredLine
        icon={Image01Icon}
        isJustAnswered={isJustAnswered}
        label={input?.title ?? t("chat.storyboard.curateTitle")}
        value={
          answered
            ? answered.picks.map((pick) => `v${pick + 1}`).join(" · ")
            : ""
        }
      />
    )
  }

  if (!(input && sessionId)) {
    return null
  }

  const keyframeCount = input.keyframes.length

  return (
    <motion.div
      animate={APPROVAL_CARD_MOTION.animate}
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/60 p-3"
      initial={APPROVAL_CARD_MOTION.initial}
      transition={APPROVAL_CARD_MOTION.transition}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={Image01Icon}
          size={15}
        />
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-foreground">
          {t("chat.storyboard.curateTitle")}
        </p>
      </div>
      {input.keyframes.map((keyframe, index) => {
        const join = describeKeyframeJoin(index, keyframeCount)

        return (
          <fieldset
            className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
            // oxlint-disable-next-line react/no-array-index-key -- keyframes are positional and never reorder
            key={`curate-${index}`}
          >
            <legend className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="font-mono font-semibold text-foreground">
                K{index}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                {[
                  join.endsShot === null
                    ? null
                    : t("chat.storyboard.endsShot", { index: join.endsShot }),
                  join.startsShot === null
                    ? null
                    : t("chat.storyboard.startsShot", {
                        index: join.startsShot
                      })
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </legend>
            <div className="grid grid-cols-3 gap-1.5">
              {keyframe.frames.map((frame, variant) => {
                const isPicked = picks[index] === variant

                return (
                  <button
                    aria-label={t("chat.storyboard.variant", {
                      index,
                      variant: variant + 1
                    })}
                    aria-pressed={isPicked}
                    className={cn(
                      "relative overflow-hidden rounded-lg border-2 bg-muted p-0 disabled:opacity-60",
                      isPicked ? "border-accent" : "border-transparent"
                    )}
                    disabled={isLocked}
                    key={frame.url}
                    onClick={() =>
                      setPicks(
                        picks.map((pick, candidate) =>
                          candidate === index ? variant : pick
                        )
                      )
                    }
                    type="button"
                  >
                    <img
                      alt={keyframe.prompt}
                      className="aspect-video w-full object-cover"
                      src={buildMediaUrl({ path: frame.path, sessionId })}
                    />
                    {isPicked ? (
                      <HugeiconsIcon
                        className="absolute top-1 right-1 rounded-full bg-background text-accent"
                        icon={CheckmarkCircle01Icon}
                        size={16}
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
        <span className="text-xs text-warning-soft-foreground">
          {t("chat.storyboard.clipCount", { count: keyframeCount - 1 })}
        </span>
        <Button
          className="ml-auto"
          isDisabled={isLocked}
          onPress={() => {
            setSubmitted(true)
            onSubmit(part, { picks })
          }}
          size="sm"
          type="button"
          variant="primary"
        >
          {t("chat.storyboard.renderClips")}
        </Button>
      </div>
    </motion.div>
  )
}

/** The keyframe step's own line: progress while images render, then a count. */
export const StoryboardKeyframesLine = ({ part }: { part: ChatToolPart }) => {
  const { t } = useI18n()
  const state = getStoryboardKeyframesState(part)

  if (state.phase === "error") {
    return (
      <div className="inline-flex max-w-full flex-col gap-0.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <span className="font-medium text-danger">
          {t("chat.storyboard.keyframesFailed")}
        </span>
        {state.errorMessage ? (
          <span className="break-all text-muted-foreground">
            {state.errorMessage}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <HugeiconsIcon icon={Image01Icon} size={14} />
      {state.phase === "generating"
        ? t("chat.storyboard.makingKeyframes", {
            count: state.count,
            variants: state.variants
          })
        : t("chat.storyboard.keyframesReady", { count: state.count })}
    </div>
  )
}

/** The finished storyboard as one reel, a click away from the editor. */
export const StoryboardReelCard = ({
  part,
  sessionId
}: {
  part: ChatToolPart
  sessionId: string
}) => {
  const { t } = useI18n()
  const clips = getStoryboardReelClips(part)

  if (clips.length === 0) {
    return null
  }

  return (
    <div className="flex max-w-md items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
      <HugeiconsIcon
        className="text-muted-foreground"
        icon={Film01Icon}
        size={16}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {t("chat.storyboard.reel", { count: clips.length })}
      </span>
      <Button
        onPress={() => {
          for (const clip of clips) {
            addClipToEditor(sessionId, clip)
          }

          requestPanelSurface({ kind: "videoEditor", sessionId })
        }}
        size="sm"
        variant="secondary"
      >
        {t("chat.storyboard.openReel")}
      </Button>
    </div>
  )
}
