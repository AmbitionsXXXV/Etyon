import { useI18n } from "@etyon/i18n/react"
import type {
  AutoCompactSettings,
  ChatMessageActions,
  ChatMessageStyle,
  ChatSettings,
  StreamdownAnimation
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Label, NumberField, Slider, Switch } from "@heroui/react"
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useCallback } from "react"

import {
  AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX,
  AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN,
  AUTO_COMPACT_THRESHOLD_MAX,
  AUTO_COMPACT_THRESHOLD_MIN,
  clampAutoCompactKeepRecentMessages,
  clampAutoCompactThreshold,
  getRecommendedAutoCompact
} from "@/renderer/lib/chat/auto-compact-settings"
import { STREAMDOWN_ANIMATION_OPTIONS } from "@/renderer/lib/chat/streamdown-settings"
import { MOTION_TRANSITION_FAST_CLASS } from "@/renderer/lib/motion"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import { formatContextWindowCompact } from "@/shared/providers/context-window"

export interface ChatTabDefaultModel {
  contextWindow?: number
  label: string
}

interface ChatTabProps {
  chat: ChatSettings
  /** The model new chats start with; drives the compaction recommendation. */
  defaultModel: ChatTabDefaultModel | null
  onChange: (chat: ChatSettings) => void
}

const SECTION_CLASS_NAME =
  "space-y-4 rounded-2xl border border-border bg-card p-5"

const MESSAGE_STYLE_OPTIONS = [
  {
    descriptionKey: "settings.chat.messageStyle.option.soft.description",
    labelKey: "settings.chat.messageStyle.option.soft.label",
    value: "soft"
  },
  {
    descriptionKey: "settings.chat.messageStyle.option.bubble.description",
    labelKey: "settings.chat.messageStyle.option.bubble.label",
    value: "bubble"
  },
  {
    descriptionKey: "settings.chat.messageStyle.option.document.description",
    labelKey: "settings.chat.messageStyle.option.document.label",
    value: "document"
  }
] as const satisfies readonly {
  descriptionKey: string
  labelKey: string
  value: ChatMessageStyle
}[]

const MESSAGE_ACTIONS_OPTIONS = [
  { labelKey: "settings.chat.messageActions.option.hover", value: "hover" },
  { labelKey: "settings.chat.messageActions.option.always", value: "always" }
] as const satisfies readonly { labelKey: string; value: ChatMessageActions }[]

const THRESHOLD_PRESETS = [
  { labelKey: "settings.chat.autoCompact.preset.early", offset: -15 },
  { labelKey: "settings.chat.autoCompact.preset.recommended", offset: 0 },
  { labelKey: "settings.chat.autoCompact.preset.late", offset: 10 }
] as const

const optionCardClassName = (isActive: boolean): string =>
  cn(
    "flex flex-col gap-2.5 rounded-2xl border p-2.5 text-left",
    MOTION_TRANSITION_FAST_CLASS,
    isActive
      ? "border-primary bg-primary/8"
      : "border-border hover:border-muted-foreground/30 hover:bg-default/40"
  )

const segmentClassName = (isActive: boolean): string =>
  cn(
    "h-8 rounded-lg px-3 text-sm",
    MOTION_TRANSITION_FAST_CLASS,
    isActive
      ? "bg-default font-medium text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  )

/** A tiny drawing of each style: the user line on top, two reply lines below. */
const MessageStylePreview = ({ style }: { style: ChatMessageStyle }) => (
  <div
    aria-hidden
    className="flex h-24 flex-col gap-2 rounded-xl bg-background p-3"
  >
    {style === "document" ? (
      <div className="h-5 w-full rounded-md border border-border bg-surface" />
    ) : (
      <div
        className={cn(
          "h-3.5 w-1/2 self-end rounded-full",
          style === "bubble" ? "rounded-br-sm bg-primary" : "bg-default"
        )}
      />
    )}
    <div className="h-2 w-11/12 rounded-full bg-surface-tertiary" />
    <div className="h-2 w-2/3 rounded-full bg-surface-tertiary" />
  </div>
)

const SegmentedControl = <TValue extends string>({
  label,
  onChange,
  options,
  value
}: {
  label: string
  onChange: (value: TValue) => void
  options: readonly { label: string; value: TValue }[]
  value: TValue
}) => (
  <fieldset className="inline-flex flex-wrap gap-0.5 rounded-xl border border-border bg-background p-1">
    <legend className="sr-only">{label}</legend>
    {options.map((option) => (
      <button
        aria-pressed={option.value === value}
        className={segmentClassName(option.value === value)}
        key={option.value}
        onClick={() => onChange(option.value)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </fieldset>
)

export const ChatTab = ({ chat, defaultModel, onChange }: ChatTabProps) => {
  const { t } = useI18n()
  const recommendation = getRecommendedAutoCompact(defaultModel?.contextWindow)
  const isRecommended =
    chat.autoCompact.threshold === recommendation.threshold &&
    chat.autoCompact.keepRecentMessages === recommendation.keepRecentMessages
  const contextWindowLabel = formatContextWindowCompact(
    defaultModel?.contextWindow
  )
  const thresholdTokenLabel = defaultModel?.contextWindow
    ? formatContextWindowCompact(
        Math.round(
          (defaultModel.contextWindow * chat.autoCompact.threshold) / 100
        )
      )
    : null

  const updateAutoCompact = useCallback(
    (patch: Partial<AutoCompactSettings>) => {
      onChange({ ...chat, autoCompact: { ...chat.autoCompact, ...patch } })
    },
    [chat, onChange]
  )

  const handleThresholdChange = useCallback(
    (value: number | number[]) => {
      if (Array.isArray(value)) {
        return
      }
      updateAutoCompact({ threshold: clampAutoCompactThreshold(value) })
    },
    [updateAutoCompact]
  )

  const handleUseRecommended = useCallback(() => {
    updateAutoCompact({
      keepRecentMessages: recommendation.keepRecentMessages,
      threshold: recommendation.threshold
    })
  }, [
    recommendation.keepRecentMessages,
    recommendation.threshold,
    updateAutoCompact
  ])

  return (
    <div className="space-y-6">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className={SECTION_CLASS_NAME}
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.chat.messageStyle.title")}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {t("settings.chat.messageStyle.description")}
          </p>
        </div>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="sr-only">
            {t("settings.chat.messageStyle.title")}
          </legend>
          {MESSAGE_STYLE_OPTIONS.map((option) => {
            const isActive = chat.messageStyle === option.value
            return (
              <button
                aria-pressed={isActive}
                className={optionCardClassName(isActive)}
                key={option.value}
                onClick={() =>
                  onChange({ ...chat, messageStyle: option.value })
                }
                type="button"
              >
                <MessageStylePreview style={option.value} />
                <span className="px-1 text-sm font-semibold text-foreground">
                  {t(option.labelKey)}
                </span>
                <span className="px-1 pb-1 text-xs leading-5 text-muted-foreground">
                  {t(option.descriptionKey)}
                </span>
              </button>
            )
          })}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">
              {t("settings.chat.messageActions.label")}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.chat.messageActions.description")}
            </p>
          </div>
          <SegmentedControl
            label={t("settings.chat.messageActions.label")}
            onChange={(messageActions) => onChange({ ...chat, messageActions })}
            options={MESSAGE_ACTIONS_OPTIONS.map((option) => ({
              label: t(option.labelKey),
              value: option.value
            }))}
            value={chat.messageActions}
          />
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className={SECTION_CLASS_NAME}
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.chat.streamdown.title")}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {t("settings.chat.streamdown.animation.description")}
          </p>
        </div>
        <SegmentedControl<StreamdownAnimation>
          label={t("settings.chat.streamdown.animation.label")}
          onChange={(animation) =>
            onChange({ ...chat, streamdown: { ...chat.streamdown, animation } })
          }
          options={STREAMDOWN_ANIMATION_OPTIONS.map((option) => ({
            label: t(option.labelKey),
            value: option.value
          }))}
          value={chat.streamdown.animation}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {t(
            STREAMDOWN_ANIMATION_OPTIONS.find(
              (option) => option.value === chat.streamdown.animation
            )?.descriptionKey ?? STREAMDOWN_ANIMATION_OPTIONS[0].descriptionKey
          )}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.35)}
        className={SECTION_CLASS_NAME}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.chat.autoCompact.title")}
            </h2>
            <p className="text-sm leading-5 text-muted-foreground">
              {t("settings.chat.autoCompact.enabled.description")}
            </p>
          </div>
          <Switch
            aria-label={t("settings.chat.autoCompact.enabled.label")}
            isSelected={chat.autoCompact.enabled}
            onChange={(enabled) => updateAutoCompact({ enabled })}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>

        {chat.autoCompact.enabled ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft px-3.5 py-3">
              <HugeiconsIcon
                className="shrink-0 text-accent-soft-foreground"
                icon={CheckmarkCircle02Icon}
                size={18}
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-sm font-medium text-foreground">
                  {defaultModel
                    ? t("settings.chat.autoCompact.recommendation.forModel", {
                        model: defaultModel.label,
                        window: contextWindowLabel ?? "?"
                      })
                    : t("settings.chat.autoCompact.recommendation.generic")}
                </div>
                <p className="text-xs leading-5 text-foreground/80">
                  {recommendation.reserveTokens === null
                    ? t(
                        "settings.chat.autoCompact.recommendation.summaryUnknown",
                        {
                          keep: recommendation.keepRecentMessages,
                          threshold: recommendation.threshold
                        }
                      )
                    : t("settings.chat.autoCompact.recommendation.summary", {
                        keep: recommendation.keepRecentMessages,
                        reserve:
                          formatContextWindowCompact(
                            recommendation.reserveTokens
                          ) ?? recommendation.reserveTokens,
                        threshold: recommendation.threshold
                      })}
                </p>
              </div>
              {isRecommended ? null : (
                <Button onPress={handleUseRecommended} size="sm">
                  {t("settings.chat.autoCompact.recommendation.apply")}
                </Button>
              )}
            </div>

            <div className="space-y-3">
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="sr-only">
                  {t("settings.chat.autoCompact.preset.label")}
                </legend>
                {THRESHOLD_PRESETS.map((preset) => {
                  const presetThreshold = clampAutoCompactThreshold(
                    recommendation.threshold + preset.offset
                  )
                  const isActive =
                    chat.autoCompact.threshold === presetThreshold
                  return (
                    <button
                      aria-pressed={isActive}
                      className={cn(
                        "h-8 rounded-full border px-3 text-xs",
                        MOTION_TRANSITION_FAST_CLASS,
                        isActive
                          ? "border-accent/50 bg-accent-soft text-accent-soft-foreground"
                          : "border-border text-foreground hover:bg-default/50"
                      )}
                      key={preset.labelKey}
                      onClick={() =>
                        updateAutoCompact({ threshold: presetThreshold })
                      }
                      type="button"
                    >
                      {t(preset.labelKey, { value: presetThreshold })}
                    </button>
                  )
                })}
              </fieldset>

              <Slider
                aria-label={t("settings.chat.autoCompact.threshold.label", {
                  value: chat.autoCompact.threshold
                })}
                maxValue={AUTO_COMPACT_THRESHOLD_MAX}
                minValue={AUTO_COMPACT_THRESHOLD_MIN}
                onChange={handleThresholdChange}
                value={chat.autoCompact.threshold}
              >
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-medium">
                    {t("settings.chat.autoCompact.threshold.label", {
                      value: chat.autoCompact.threshold
                    })}
                  </Label>
                  {thresholdTokenLabel ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {t("settings.chat.autoCompact.threshold.tokens", {
                        tokens: thresholdTokenLabel
                      })}
                    </span>
                  ) : null}
                </div>
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("settings.chat.autoCompact.threshold.early")}</span>
                <span>{t("settings.chat.autoCompact.threshold.late")}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {t("settings.chat.autoCompact.keepRecentMessages.label")}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(
                    "settings.chat.autoCompact.keepRecentMessages.description"
                  )}
                </p>
              </div>
              <NumberField
                aria-label={t(
                  "settings.chat.autoCompact.keepRecentMessages.label"
                )}
                maxValue={AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX}
                minValue={AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN}
                onChange={(value) =>
                  updateAutoCompact({
                    keepRecentMessages:
                      clampAutoCompactKeepRecentMessages(value)
                  })
                }
                value={chat.autoCompact.keepRecentMessages}
              >
                <NumberField.Group className="w-32">
                  <NumberField.DecrementButton />
                  <NumberField.Input className="text-center tabular-nums" />
                  <NumberField.IncrementButton />
                </NumberField.Group>
              </NumberField>
            </div>
          </div>
        ) : null}
      </motion.section>
    </div>
  )
}
