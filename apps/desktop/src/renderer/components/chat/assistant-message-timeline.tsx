import { useI18n } from "@etyon/i18n/react"
import type { StreamdownAnimation } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChainOfThought } from "@heroui-pro/react"
import { Button, Input, ScrollShadow, TextField } from "@heroui/react"
import {
  BrowserIcon,
  CheckmarkCircle01Icon,
  ClipboardIcon,
  HelpCircleIcon,
  Video01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { getToolName } from "ai"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { ComponentPropsWithoutRef } from "react"
import type { Components, ExtraProps } from "streamdown"

import { AgentMarkdown } from "@/renderer/components/chat/agent-markdown"
import { BrowserScreenshotImage } from "@/renderer/components/chat/browser-screenshot"
import { ImagenMessageImage } from "@/renderer/components/chat/imagen-message"
import {
  APPROVAL_CARD_MOTION,
  InputToolAnsweredLine
} from "@/renderer/components/chat/input-card-chrome"
import {
  StoryboardCurateCard,
  StoryboardKeyframesLine,
  StoryboardPlanCard,
  StoryboardReelCard
} from "@/renderer/components/chat/storyboard-cards"
import { WorkSubagentEntry } from "@/renderer/components/chat/subagents/subagent-entries"
import { VideogenMessageVideo } from "@/renderer/components/chat/video-message"
import {
  useWorkElapsedMs,
  WorkTextEntry,
  WorkThinkingEntry,
  WorkTodoEntry,
  WorkToolGroupEntry
} from "@/renderer/components/chat/work-entries"
import type { Translate } from "@/renderer/components/chat/work-entries"
import {
  getPublishedArtifactRef,
  isArtifactToolPart
} from "@/renderer/lib/chat/artifact-panel"
import type { ChatArtifactRef } from "@/renderer/lib/chat/artifact-panel"
import {
  buildAssistantChainEntries,
  getAssistantBodyText,
  getRunLimitData,
  getUrlHost,
  getWorkSectionInitialExpanded,
  getWorkSectionStatus,
  groupChainEntries,
  hasPendingApproval,
  isReferencePart,
  isWorkSectionForcedExpanded,
  isWorkSectionSelfCollapsing,
  openExternalUrl,
  shouldReopenWorkSection
} from "@/renderer/lib/chat/assistant-message-timeline"
import type {
  ChatToolPart,
  ChatUiMessage,
  FileChatPart,
  GroupedChainEntry,
  SourceDocumentChatPart,
  SourceUrlChatPart,
  WorkSectionStatus
} from "@/renderer/lib/chat/assistant-message-timeline"
import { getBrowserScreenshotView } from "@/renderer/lib/chat/browser-tool-ui"
import { isImagenToolPart } from "@/renderer/lib/chat/imagen-message"
import {
  formatAskUserAnswer,
  getAskUserCardInput,
  getAskUserCardOutput,
  getProposePlanCardDecision,
  getProposePlanCardInput
} from "@/renderer/lib/chat/input-tools-ui"
import type {
  AskUserCardOutput,
  InputToolOutput
} from "@/renderer/lib/chat/input-tools-ui"
import { parseChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import {
  isStoryboardKeyframesPart,
  isStoryboardReelPart
} from "@/renderer/lib/chat/storyboard-message"
import { getStreamdownAnimateOptions } from "@/renderer/lib/chat/streamdown-settings"
import { useHasSubagentApprovalPending } from "@/renderer/lib/chat/subagent-stream-store"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import {
  formatVideoChoices,
  getVideoOptionsCardInput,
  getVideoOptionsCardOutput,
  isVideogenToolPart
} from "@/renderer/lib/chat/video-message"
import {
  MOTION_FADE_IN_FAST,
  MOTION_ROW_RISE_IN,
  MOTION_TRANSITION_GENTLE_CLASS,
  useEntranceGuard,
  useHasChangedSinceMount
} from "@/renderer/lib/motion"
import { formatElapsedDuration } from "@/renderer/lib/utils"
import { PROPOSE_PLAN_TOOL_NAME } from "@/shared/agents/input-tools"
import type { PlanDecision } from "@/shared/agents/input-tools"
import {
  STORYBOARD_CURATE_TOOL_NAME,
  STORYBOARD_PLAN_TOOL_NAME,
  STORYBOARD_SHOT_COUNTS,
  STORYBOARD_VARIANTS
} from "@/shared/chat/storyboard"
import {
  estimateVideoTokens,
  VIDEO_DURATIONS,
  VIDEO_IMAGE_USES,
  VIDEO_OPTIONS_TOOL_NAME,
  VIDEO_RATIOS,
  getVideoResolutions
} from "@/shared/chat/video-tools"
import type { VideoChoices } from "@/shared/chat/video-tools"

type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & ExtraProps

const STREAMDOWN_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-sm leading-6 text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_li]:my-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_[data-streamdown=code-block]]:my-3 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-lg [&_[data-streamdown=code-block]]:border-border/80 [&_[data-streamdown=code-block]]:bg-muted/80 [&_[data-streamdown=code-block]]:p-0",
  "[&_[data-streamdown=code-block-actions]]:top-0 [&_[data-streamdown=code-block-actions]]:-mt-8 [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity",
  "[&_[data-streamdown=code-block-actions]>div]:border-0 [&_[data-streamdown=code-block-actions]>div]:bg-transparent [&_[data-streamdown=code-block-actions]>div]:px-2",
  "[&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0",
  "[&_[data-streamdown=code-block-body]>pre]:bg-transparent [&_[data-streamdown=code-block-body]>pre]:p-3",
  "[&_[data-streamdown=code-block-header]]:h-8 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border/60 [&_[data-streamdown=code-block-header]]:px-3",
  "[&_[data-streamdown=code-block-header]>span]:ml-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
)

const MarkdownTable = ({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps) => (
  <table
    className={cn("my-3 w-full border-collapse text-sm", className)}
    {...props}
  >
    {children}
  </table>
)

const STREAMDOWN_MARKDOWN_COMPONENTS = {
  table: MarkdownTable
} satisfies Components

const AssistantMarkdownContent = ({
  isAnimating,
  streamdownAnimation,
  text
}: {
  isAnimating: boolean
  streamdownAnimation: StreamdownAnimation
  text: string
}) => {
  if (!text.trim()) {
    return null
  }

  const animated = getStreamdownAnimateOptions(streamdownAnimation)
  const shouldAnimate = isAnimating && animated !== false

  return (
    <AgentMarkdown
      animated={animated}
      caret={shouldAnimate ? "block" : undefined}
      className={STREAMDOWN_MARKDOWN_CLASS_NAME}
      components={STREAMDOWN_MARKDOWN_COMPONENTS}
      isAnimating={shouldAnimate}
    >
      {text}
    </AgentMarkdown>
  )
}

const getWorkSectionLabelText = (
  t: Translate,
  status: WorkSectionStatus,
  duration: string
): string => {
  switch (status) {
    case "failed": {
      return t("chat.workSection.failedAfter", { duration })
    }
    case "stopped": {
      return t("chat.workSection.stoppedAfter", { duration })
    }
    case "waiting": {
      return t("chat.workSection.waitingApproval")
    }
    case "working": {
      return t("chat.workSection.working")
    }
    default: {
      return t("chat.workSection.worked", { duration })
    }
  }
}

// Answers a suspended ask_user / propose_plan tool. `switchToAgent` flips the
// composer to agent mode and resumes there (the plan "Implement" path).
export type InputToolResultHandler = (
  part: ChatToolPart,
  output: InputToolOutput,
  options?: { switchToAgent?: boolean }
) => void

const AskUserCard = ({
  isDisabled,
  onSubmit,
  part
}: {
  isDisabled: boolean
  onSubmit: (part: ChatToolPart, output: AskUserCardOutput) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const input = getAskUserCardInput(part)
  const isPending = part.state === "input-available"
  const isJustAnswered = useHasChangedSinceMount(isPending)
  const [submitted, setSubmitted] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [customText, setCustomText] = useState("")
  const isLocked = submitted || isDisabled || !isPending

  if (!isPending) {
    const output = getAskUserCardOutput(part)

    return (
      <InputToolAnsweredLine
        icon={HelpCircleIcon}
        isJustAnswered={isJustAnswered}
        label={input?.question ?? t("chat.askUser.title")}
        value={output ? formatAskUserAnswer(output) : ""}
      />
    )
  }

  if (!input) {
    return null
  }

  const submit = (output: AskUserCardOutput) => {
    if (isLocked) {
      return
    }

    setSubmitted(true)
    onSubmit(part, output)
  }

  const toggleOption = (label: string) => {
    setSelected((current) =>
      current.includes(label)
        ? current.filter((entry) => entry !== label)
        : [...current, label]
    )
  }

  const submitCustom = () => {
    const custom = customText.trim()

    if (custom.length > 0) {
      submit({ custom, selected: [] })
    }
  }

  return (
    <motion.div
      animate={APPROVAL_CARD_MOTION.animate}
      className="flex flex-col gap-2.5 rounded-xl border border-warning/25 bg-warning/5 p-3"
      initial={APPROVAL_CARD_MOTION.initial}
      transition={APPROVAL_CARD_MOTION.transition}
    >
      <div className="flex min-w-0 items-start gap-2">
        <HugeiconsIcon
          className="mt-0.5 shrink-0 text-warning"
          icon={HelpCircleIcon}
          size={15}
        />
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-foreground">
          {input.question}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {input.options.map((option) => {
          const isOptionSelected = selected.includes(option.label)

          return (
            <Button
              className="h-auto min-h-9 w-full justify-start gap-2 px-3 py-1.5 text-left"
              isDisabled={isLocked}
              key={option.label}
              onPress={() =>
                input.multiSelect
                  ? toggleOption(option.label)
                  : submit({ custom: null, selected: [option.label] })
              }
              size="sm"
              type="button"
              variant={
                input.multiSelect && isOptionSelected ? "secondary" : "outline"
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="truncate text-[0.6875rem] font-normal text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {input.multiSelect && isOptionSelected ? (
                <HugeiconsIcon
                  className="shrink-0 text-success"
                  icon={CheckmarkCircle01Icon}
                  size={14}
                />
              ) : null}
            </Button>
          )
        })}
      </div>
      {input.multiSelect ? (
        <Button
          isDisabled={isLocked || selected.length === 0}
          onPress={() => submit({ custom: null, selected })}
          size="sm"
          type="button"
          variant="primary"
        >
          {t("chat.askUser.confirm")}
        </Button>
      ) : null}
      <div className="flex items-center gap-2">
        <TextField
          aria-label={t("chat.askUser.customPlaceholder")}
          className="flex-1"
          isDisabled={isLocked}
          onChange={setCustomText}
          value={customText}
        >
          <Input
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submitCustom()
              }
            }}
            placeholder={t("chat.askUser.customPlaceholder")}
            variant="secondary"
          />
        </TextField>
        <Button
          isDisabled={isLocked || customText.trim().length === 0}
          onPress={submitCustom}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("chat.askUser.customSubmit")}
        </Button>
      </div>
    </motion.div>
  )
}

const ProposePlanCard = ({
  isDisabled,
  onDecision,
  part
}: {
  isDisabled: boolean
  onDecision: (part: ChatToolPart, decision: PlanDecision) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const input = getProposePlanCardInput(part)
  const isPending = part.state === "input-available"
  const isJustAnswered = useHasChangedSinceMount(isPending)
  const [submitted, setSubmitted] = useState(false)
  const isLocked = submitted || isDisabled || !isPending

  if (!isPending) {
    const decision = getProposePlanCardDecision(part)
    let value = ""

    if (decision === "implement") {
      value = t("chat.planProposal.decisionImplement")
    } else if (decision === "not_now") {
      value = t("chat.planProposal.decisionNotNow")
    }

    return (
      <InputToolAnsweredLine
        icon={ClipboardIcon}
        isJustAnswered={isJustAnswered}
        label={input?.title ?? t("chat.planProposal.title")}
        value={value}
      />
    )
  }

  if (!input) {
    return null
  }

  const decide = (decision: PlanDecision) => {
    if (isLocked) {
      return
    }

    setSubmitted(true)
    onDecision(part, decision)
  }

  return (
    <motion.div
      animate={APPROVAL_CARD_MOTION.animate}
      className="flex flex-col gap-2.5 rounded-xl border border-warning/25 bg-warning/5 p-3"
      initial={APPROVAL_CARD_MOTION.initial}
      transition={APPROVAL_CARD_MOTION.transition}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          className="shrink-0 text-warning"
          icon={ClipboardIcon}
          size={15}
        />
        <span className="text-[0.625rem] font-semibold tracking-wide text-warning uppercase">
          {t("chat.planProposal.title")}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {input.title}
        </span>
      </div>
      <ScrollShadow className="max-h-[360px] rounded-lg border border-border/60 bg-background/50 px-3 py-2">
        <AgentMarkdown
          animated={false}
          className={STREAMDOWN_MARKDOWN_CLASS_NAME}
          components={STREAMDOWN_MARKDOWN_COMPONENTS}
          isAnimating={false}
        >
          {input.plan}
        </AgentMarkdown>
      </ScrollShadow>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          isDisabled={isLocked}
          onPress={() => decide("implement")}
          size="sm"
          type="button"
          variant="primary"
        >
          {t("chat.planProposal.implement")}
        </Button>
        <Button
          isDisabled={isLocked}
          onPress={() => decide("not_now")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("chat.planProposal.notNow")}
        </Button>
      </div>
    </motion.div>
  )
}

const TOKENS_PER_THOUSAND = 1000

const VideoChoiceGroup = <Value extends boolean | number | string>({
  isDisabled,
  label,
  onSelect,
  options,
  value
}: {
  isDisabled: boolean
  label: string
  onSelect: (value: Value) => void
  options: readonly { label: string; value: Value }[]
  value: Value
}) => (
  <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
    <legend className="float-left mr-1 w-20 shrink-0 text-xs text-muted-foreground">
      {label}
    </legend>
    {options.map((option) => {
      const isSelected = option.value === value

      return (
        <Button
          aria-pressed={isSelected}
          className="h-7 min-w-0 px-2.5 text-xs"
          isDisabled={isDisabled}
          key={String(option.value)}
          onPress={() => onSelect(option.value)}
          size="sm"
          type="button"
          variant={isSelected ? "secondary" : "outline"}
        >
          {option.label}
        </Button>
      )
    })}
  </fieldset>
)

// The Video skill's choices card: the render's settings as one-tap choices,
// with a live token estimate, answered with the user's picks on Render.
const VideoOptionsCard = ({
  isDisabled,
  onSubmit,
  part
}: {
  isDisabled: boolean
  onSubmit: (part: ChatToolPart, output: VideoChoices) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const input = getVideoOptionsCardInput(part)
  const isPending = part.state === "input-available"
  const isJustAnswered = useHasChangedSinceMount(isPending)
  const [submitted, setSubmitted] = useState(false)
  const [choices, setChoices] = useState<VideoChoices | null>(
    input?.defaults ?? null
  )
  const isLocked = submitted || isDisabled || !isPending

  if (!isPending) {
    const output = getVideoOptionsCardOutput(part)

    return (
      <InputToolAnsweredLine
        icon={Video01Icon}
        isJustAnswered={isJustAnswered}
        label={input?.title ?? t("chat.videogen.label")}
        value={output ? formatVideoChoices(output, input?.models ?? []) : ""}
      />
    )
  }

  if (!(input && choices)) {
    return null
  }

  const pick = <Key extends keyof VideoChoices>(
    key: Key,
    value: VideoChoices[Key]
  ) => setChoices({ ...choices, [key]: value })

  const render = () => {
    if (isLocked) {
      return
    }

    setSubmitted(true)
    onSubmit(part, choices)
  }

  return (
    <motion.div
      animate={APPROVAL_CARD_MOTION.animate}
      className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-background/60 p-3"
      initial={APPROVAL_CARD_MOTION.initial}
      transition={APPROVAL_CARD_MOTION.transition}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={Video01Icon}
          size={15}
        />
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-foreground">
          {t("chat.videogen.optionsTitle")}
        </p>
      </div>
      {input.models.length > 1 ? (
        <VideoChoiceGroup
          isDisabled={isLocked}
          label={t("chat.videogen.model")}
          onSelect={(model) => {
            const resolutions = getVideoResolutions(model)

            // Keep the quality when the new model takes it, else its first.
            setChoices({
              ...choices,
              model,
              resolution: resolutions.includes(choices.resolution)
                ? choices.resolution
                : (resolutions[0] ?? choices.resolution)
            })
          }}
          options={input.models}
          value={choices.model}
        />
      ) : null}
      <VideoChoiceGroup
        isDisabled={isLocked}
        label={t("chat.videogen.shots")}
        onSelect={(value) => pick("shots", value)}
        options={STORYBOARD_SHOT_COUNTS.map((value) => ({
          label:
            value === 1
              ? t("chat.videogen.singleClip")
              : t("chat.videogen.shotCount", { count: value }),
          value
        }))}
        value={choices.shots ?? 1}
      />
      <VideoChoiceGroup
        isDisabled={isLocked}
        label={t("chat.videogen.length")}
        onSelect={(value) => pick("duration", value)}
        options={VIDEO_DURATIONS.map((value) => ({
          label: t("chat.videogen.seconds", { count: value }),
          value
        }))}
        value={choices.duration}
      />
      <VideoChoiceGroup
        isDisabled={isLocked}
        label={t("chat.videogen.shape")}
        onSelect={(value) => pick("ratio", value)}
        options={VIDEO_RATIOS.map((value) => ({
          label:
            value === "adaptive" ? t("chat.videogen.ratioAdaptive") : value,
          value
        }))}
        value={choices.ratio}
      />
      <VideoChoiceGroup
        isDisabled={isLocked}
        label={t("chat.videogen.quality")}
        onSelect={(value) => pick("resolution", value)}
        options={getVideoResolutions(choices.model).map((value) => ({
          label: value,
          value
        }))}
        value={choices.resolution}
      />
      <VideoChoiceGroup
        isDisabled={isLocked}
        label={t("chat.videogen.sound")}
        onSelect={(value) => pick("generateAudio", value)}
        options={[
          { label: t("chat.videogen.soundOn"), value: true },
          { label: t("chat.videogen.soundOff"), value: false }
        ]}
        value={choices.generateAudio}
      />
      {input.hasImage ? (
        <VideoChoiceGroup
          isDisabled={isLocked}
          label={t("chat.videogen.image")}
          onSelect={(value) => pick("imageUse", value)}
          options={VIDEO_IMAGE_USES.map((value) => ({
            label: t(`chat.videogen.imageUse.${value}`),
            value
          }))}
          value={choices.imageUse}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
        <span className="text-xs text-warning-soft-foreground tabular-nums">
          {(choices.shots ?? 1) > 1
            ? t("chat.videogen.estimateStoryboard", {
                count: Math.round(
                  (estimateVideoTokens(choices) * (choices.shots ?? 1)) /
                    TOKENS_PER_THOUSAND
                ),
                images: ((choices.shots ?? 1) + 1) * STORYBOARD_VARIANTS
              })
            : t("chat.videogen.estimate", {
                count: Math.round(
                  estimateVideoTokens(choices) / TOKENS_PER_THOUSAND
                )
              })}
        </span>
        <Button
          className="ml-auto"
          isDisabled={isLocked}
          onPress={render}
          size="sm"
          type="button"
          variant="primary"
        >
          {t("chat.videogen.render")}
        </Button>
      </div>
    </motion.div>
  )
}

const AssistantInputToolEntry = ({
  isDisabled,
  onInputToolResult,
  part
}: {
  isDisabled: boolean
  onInputToolResult: InputToolResultHandler
  part: ChatToolPart
}) => {
  if (getToolName(part) === STORYBOARD_PLAN_TOOL_NAME) {
    return (
      <StoryboardPlanCard
        isDisabled={isDisabled}
        onSubmit={(planPart, output) => onInputToolResult(planPart, output)}
        part={part}
      />
    )
  }

  if (getToolName(part) === STORYBOARD_CURATE_TOOL_NAME) {
    return (
      <StoryboardCurateCard
        isDisabled={isDisabled}
        onSubmit={(curatePart, output) => onInputToolResult(curatePart, output)}
        part={part}
      />
    )
  }

  if (getToolName(part) === VIDEO_OPTIONS_TOOL_NAME) {
    return (
      <VideoOptionsCard
        isDisabled={isDisabled}
        onSubmit={(videoPart, output) => onInputToolResult(videoPart, output)}
        part={part}
      />
    )
  }

  if (getToolName(part) === PROPOSE_PLAN_TOOL_NAME) {
    return (
      <ProposePlanCard
        isDisabled={isDisabled}
        onDecision={(planPart, decision) =>
          onInputToolResult(
            planPart,
            { decision },
            decision === "implement" ? { switchToAgent: true } : undefined
          )
        }
        part={part}
      />
    )
  }

  return (
    <AskUserCard
      isDisabled={isDisabled}
      onSubmit={(askPart, output) => onInputToolResult(askPart, output)}
      part={part}
    />
  )
}

const AssistantWorkEntry = ({
  entry,
  isApprovalActionDisabled,
  isLive,
  isRunActive,
  onApprovalResponse,
  onInputToolResult,
  parentRunId,
  thoughtDurationsMs
}: {
  entry: GroupedChainEntry
  isApprovalActionDisabled: boolean
  isLive: boolean
  isRunActive: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onInputToolResult: InputToolResultHandler
  parentRunId?: string
  thoughtDurationsMs?: number[]
}) => {
  if (entry.kind === "reasoning") {
    return (
      <WorkThinkingEntry
        durationMs={thoughtDurationsMs?.[entry.index]}
        isRunActive={isRunActive}
        streaming={entry.streaming}
        text={entry.text}
      />
    )
  }

  if (entry.kind === "text") {
    return (
      <div className={cn("py-1", !isLive && "px-2")}>
        <WorkTextEntry text={entry.text} />
      </div>
    )
  }

  if (entry.kind === "subagent-call") {
    return (
      <WorkSubagentEntry
        entry={entry}
        isApprovalActionDisabled={isApprovalActionDisabled}
        onApprovalResponse={onApprovalResponse}
        parentRunId={parentRunId}
      />
    )
  }

  if (entry.kind === "todo") {
    return <WorkTodoEntry parentRunId={parentRunId} part={entry.part} />
  }

  if (entry.kind === "input-tool") {
    return (
      <AssistantInputToolEntry
        isDisabled={isApprovalActionDisabled}
        onInputToolResult={onInputToolResult}
        part={entry.part}
      />
    )
  }

  return (
    <WorkToolGroupEntry
      entry={entry}
      isApprovalActionDisabled={isApprovalActionDisabled}
      onApprovalResponse={onApprovalResponse}
    />
  )
}

const AssistantWorkSection = ({
  entries,
  exitReason,
  isApprovalActionDisabled,
  isRunActive,
  liveWorkTimeStartedAt,
  onApprovalResponse,
  onInputToolResult,
  parentRunId,
  thoughtDurationsMs,
  workTimeMs
}: {
  entries: GroupedChainEntry[]
  exitReason?: string | null
  isApprovalActionDisabled: boolean
  isRunActive: boolean
  liveWorkTimeStartedAt?: number
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onInputToolResult: InputToolResultHandler
  parentRunId?: string
  thoughtDurationsMs?: number[]
  workTimeMs?: number
}) => {
  const { t } = useI18n()
  // A gated tool part (parent) OR a delegated child awaiting approval both pin
  // the header to "Waiting for approval…". The child signal is global, so scope
  // it to the live turn — a settled message must not react to a later run's child.
  const hasSubagentApproval = useHasSubagentApprovalPending()
  const status = getWorkSectionStatus({
    exitReason,
    hasApprovalPending:
      hasPendingApproval(entries) || (isRunActive && hasSubagentApproval),
    isRunActive
  })
  const forcedExpanded = isWorkSectionForcedExpanded(status)
  const [isExpanded, setIsExpanded] = useState(() =>
    getWorkSectionInitialExpanded(status)
  )
  const wasForcedRef = useRef(forcedExpanded)
  const previousStatusRef = useRef(status)

  useEffect(() => {
    if (forcedExpanded) {
      wasForcedRef.current = true
      return
    }

    // On the running → settled edge, a normal completion collapses; an
    // interrupted/failed run stays open. Afterwards, user toggles win.
    if (wasForcedRef.current) {
      wasForcedRef.current = false
      setIsExpanded(!isWorkSectionSelfCollapsing(status))
    }
  }, [forcedExpanded, status])

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = status

    if (shouldReopenWorkSection(previousStatus, status)) {
      setIsExpanded(true)
    }
  }, [status])

  // A resumed run (an answered card, an approval) continues a message that
  // already carries the previous request's `workTimeMs`; while it runs, the
  // live clock is the truth, not that stale figure.
  const elapsedMs = useWorkElapsedMs({
    liveStartedAt: isRunActive ? liveWorkTimeStartedAt : undefined,
    workTimeMs: isRunActive && liveWorkTimeStartedAt ? undefined : workTimeMs
  })
  // Rows already present when the section mounted are history — only the ones
  // the run appends afterwards get to enter.
  const isEntryEntering = useEntranceGuard({
    ids: entries.map((entry) => entry.key)
  })
  const hasStatusChanged = useHasChangedSinceMount(status)
  const durationText =
    elapsedMs === undefined ? "" : formatElapsedDuration(elapsedMs)
  const isLive = status === "working" || status === "waiting"

  if (entries.length === 0) {
    return null
  }

  return (
    <ChainOfThought
      className={cn(
        "rounded-xl",
        isLive ? "border-0 bg-transparent" : "bg-background/60"
      )}
      isExpanded={forcedExpanded || isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <ChainOfThought.Trigger
        className={cn(
          isLive
            ? "h-auto min-h-0 cursor-default gap-2 px-0 py-0 hover:bg-transparent data-[hovered=true]:bg-transparent disabled:cursor-default disabled:opacity-100 [&_[data-slot=disclosure-indicator]]:hidden"
            : "px-3"
        )}
        isDisabled={isLive}
      >
        <span className="flex min-w-0 items-center gap-2">
          {/* Keyed on the status so Working → Worked swaps the label with a
              cross-fade; a settled message mounts on its final label instead. */}
          <motion.span
            animate={MOTION_FADE_IN_FAST.animate}
            className={cn(
              "truncate",
              isLive && "shimmer [--shimmer-color:var(--primary)]"
            )}
            initial={hasStatusChanged ? MOTION_FADE_IN_FAST.initial : false}
            key={status}
            transition={MOTION_FADE_IN_FAST.transition}
          >
            {getWorkSectionLabelText(t, status, durationText)}
          </motion.span>
          {isLive && durationText ? (
            <span className="shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">
              {durationText}
            </span>
          ) : null}
        </span>
      </ChainOfThought.Trigger>
      {/* HeroUI's Disclosure already transitions height + opacity; this only
          retunes it from its 200ms default to the `gentle` token. */}
      <ChainOfThought.Content
        className={cn(
          MOTION_TRANSITION_GENTLE_CLASS,
          isLive ? "p-0" : "px-2 pb-2"
        )}
      >
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <motion.div
              animate={MOTION_ROW_RISE_IN.animate}
              initial={
                isEntryEntering(entry.key) ? MOTION_ROW_RISE_IN.initial : false
              }
              key={entry.key}
              transition={MOTION_ROW_RISE_IN.transition}
            >
              <AssistantWorkEntry
                entry={entry}
                isApprovalActionDisabled={isApprovalActionDisabled}
                isLive={isLive}
                isRunActive={isRunActive}
                onApprovalResponse={onApprovalResponse}
                onInputToolResult={onInputToolResult}
                parentRunId={parentRunId}
                thoughtDurationsMs={thoughtDurationsMs}
              />
            </motion.div>
          ))}
        </div>
      </ChainOfThought.Content>
    </ChainOfThought>
  )
}

const AssistantArtifactCard = ({
  onOpenArtifact,
  part
}: {
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const publishedArtifact = getPublishedArtifactRef(part)
  const isFailed =
    part.state === "output-error" || part.state === "output-denied"
  const pendingTitle =
    typeof (part.input as { title?: unknown } | undefined)?.title === "string"
      ? (part.input as { title: string }).title
      : null

  if (isFailed) {
    return (
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-danger"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-danger">
            {t("chat.artifact.publishFailed")}
          </span>
        </span>
      </div>
    )
  }

  if (!publishedArtifact) {
    return (
      <div className="inline-flex max-w-full animate-pulse items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-muted-foreground">
            {t("chat.artifact.publishing")}
          </span>
        </span>
      </div>
    )
  }

  return (
    <button
      aria-label={t("chat.artifact.open", { title: publishedArtifact.title })}
      className="group inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => onOpenArtifact?.(publishedArtifact)}
      type="button"
    >
      <HugeiconsIcon
        className="shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        icon={BrowserIcon}
        size={18}
        strokeWidth={2}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium text-foreground">
          {publishedArtifact.title}
        </span>
        <span className="truncate text-muted-foreground">
          {t("chat.artifact.badge")} · {publishedArtifact.path}
        </span>
      </span>
    </button>
  )
}

const AssistantFilePartTimeline = ({ part }: { part: FileChatPart }) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="font-medium text-foreground">File</span>
    <span className="truncate text-muted-foreground">{part.mediaType}</span>
  </div>
)

const AssistantSourceDocumentPartTimeline = ({
  part
}: {
  part: SourceDocumentChatPart
}) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="truncate font-medium text-foreground">{part.title}</span>
    <span className="truncate text-muted-foreground">
      {part.filename ?? part.mediaType}
    </span>
  </div>
)

const AssistantSourceUrlPartTimeline = ({
  part
}: {
  part: SourceUrlChatPart
}) => {
  const host = getUrlHost(part.url)

  return (
    <button
      className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => {
        openExternalUrl(part.url)
      }}
      type="button"
    >
      <span className="truncate font-medium text-foreground">
        {part.title ?? host}
      </span>
      <span className="truncate text-muted-foreground">{host}</span>
    </button>
  )
}

const AssistantReferencePart = ({
  part
}: {
  part: ChatUiMessage["parts"][number]
}) => {
  if (part.type === "file") {
    return <AssistantFilePartTimeline part={part as FileChatPart} />
  }

  if (part.type === "source-document") {
    return (
      <AssistantSourceDocumentPartTimeline
        part={part as SourceDocumentChatPart}
      />
    )
  }

  if (part.type === "source-url") {
    return <AssistantSourceUrlPartTimeline part={part as SourceUrlChatPart} />
  }

  return null
}

export const AssistantMessageTimeline = ({
  className,
  isStreamdownAnimating,
  isApprovalActionDisabled,
  isRunActive,
  liveWorkTimeStartedAt,
  message,
  onApprovalResponse,
  onInputToolResult,
  onOpenArtifact,
  sessionId,
  streamdownAnimation
}: {
  className?: string
  isStreamdownAnimating: boolean
  isApprovalActionDisabled: boolean
  isRunActive: boolean
  liveWorkTimeStartedAt?: number
  message: ChatUiMessage
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onInputToolResult: InputToolResultHandler
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  sessionId: string
  streamdownAnimation: StreamdownAnimation
}) => {
  const { t } = useI18n()
  const metadata = parseChatMessageMetadata(message.metadata)
  const chainEntries = groupChainEntries(buildAssistantChainEntries(message))
  const bodyText = getAssistantBodyText(message)
  const runLimit = getRunLimitData(message)
  const artifactParts = message.parts.filter((part) =>
    isArtifactToolPart(part)
  ) as ChatToolPart[]
  const imagenParts = message.parts.filter((part) =>
    isImagenToolPart(part)
  ) as ChatToolPart[]
  const videogenParts = message.parts.filter((part) =>
    isVideogenToolPart(part)
  ) as ChatToolPart[]
  const storyboardKeyframeParts = message.parts.filter((part) =>
    isStoryboardKeyframesPart(part)
  ) as ChatToolPart[]
  const storyboardReelParts = message.parts.filter((part) =>
    isStoryboardReelPart(part)
  ) as ChatToolPart[]
  // Screenshots stay in the work section as a normal (approval-gated) trace row
  // AND render here, so the captured page survives the section collapsing.
  const browserScreenshotParts = message.parts.filter(
    (part) => getBrowserScreenshotView(part as ChatToolPart) !== null
  ) as ChatToolPart[]
  const referenceParts = message.parts
    .map((part, index) => ({ index, part }))
    .filter(({ part }) => isReferencePart(part))

  return (
    <div className={cn("space-y-2", className)}>
      {chainEntries.length > 0 ? (
        <AssistantWorkSection
          entries={chainEntries}
          exitReason={metadata?.exitReason}
          isApprovalActionDisabled={isApprovalActionDisabled}
          isRunActive={isRunActive}
          liveWorkTimeStartedAt={liveWorkTimeStartedAt}
          onApprovalResponse={onApprovalResponse}
          onInputToolResult={onInputToolResult}
          parentRunId={metadata?.agentProjection?.runId}
          thoughtDurationsMs={metadata?.thoughtDurationsMs}
          workTimeMs={metadata?.workTimeMs}
        />
      ) : null}
      <AssistantMarkdownContent
        isAnimating={isStreamdownAnimating}
        streamdownAnimation={streamdownAnimation}
        text={bodyText}
      />
      {runLimit ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("chat.runLimit.notice", { maxSteps: runLimit.maxSteps })}
        </p>
      ) : null}
      {artifactParts.map((part) => (
        <AssistantArtifactCard
          key={`${message.id}-artifact-${part.toolCallId}`}
          onOpenArtifact={onOpenArtifact}
          part={part}
        />
      ))}
      {imagenParts.map((part) => (
        <ImagenMessageImage
          key={`${message.id}-imagen-${part.toolCallId}`}
          part={part}
          sessionId={sessionId}
        />
      ))}
      {storyboardKeyframeParts.map((part) => (
        <StoryboardKeyframesLine
          key={`${message.id}-keyframes-${part.toolCallId}`}
          part={part}
        />
      ))}
      {videogenParts.map((part) => (
        <VideogenMessageVideo
          key={`${message.id}-videogen-${part.toolCallId}`}
          part={part}
          sessionId={sessionId}
        />
      ))}
      {storyboardReelParts.map((part) => (
        <StoryboardReelCard
          key={`${message.id}-reel-${part.toolCallId}`}
          part={part}
          sessionId={sessionId}
        />
      ))}
      {browserScreenshotParts.map((part) => (
        <BrowserScreenshotImage
          key={`${message.id}-screenshot-${part.toolCallId}`}
          part={part}
        />
      ))}
      {referenceParts.map(({ index, part }) => (
        <AssistantReferencePart
          key={`${message.id}-reference-${index}`}
          part={part}
        />
      ))}
    </div>
  )
}
