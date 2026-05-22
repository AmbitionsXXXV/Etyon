import { useI18n } from "@etyon/i18n/react"
import type {
  AutoCompactSettings,
  ChatSettings,
  StreamdownSettings
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  Label,
  ListBox,
  NumberField,
  Select,
  Slider,
  Switch
} from "@heroui/react"
import type { Key } from "@heroui/react"
import { motion } from "motion/react"
import { useCallback } from "react"

import {
  AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX,
  AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN,
  AUTO_COMPACT_THRESHOLD_MAX,
  AUTO_COMPACT_THRESHOLD_MIN,
  clampAutoCompactKeepRecentMessages,
  clampAutoCompactThreshold
} from "@/renderer/lib/chat/auto-compact-settings"
import {
  STREAMDOWN_ANIMATION_OPTIONS,
  getStreamdownAnimationValue
} from "@/renderer/lib/chat/streamdown-settings"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface ChatTabProps {
  chat: ChatSettings
  onChange: (chat: ChatSettings) => void
}

interface ChatSwitchRowProps {
  checked: boolean
  description: string
  isDisabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

const ChatSwitch = ({
  checked,
  isDisabled = false,
  label,
  onChange
}: {
  checked: boolean
  isDisabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch
    aria-label={label}
    isDisabled={isDisabled}
    isSelected={checked}
    onChange={onChange}
  >
    <Switch.Control>
      <Switch.Thumb />
    </Switch.Control>
  </Switch>
)

const ChatSwitchRow = ({
  checked,
  description,
  isDisabled = false,
  label,
  onChange
}: ChatSwitchRowProps) => (
  <div
    className={cn(
      "flex items-start justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3",
      isDisabled && "opacity-60"
    )}
  >
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>

    <ChatSwitch
      checked={checked}
      isDisabled={isDisabled}
      label={label}
      onChange={onChange}
    />
  </div>
)

const CHAT_FIELD_CLASS_NAME =
  "border-border/80 bg-background/80 shadow-sm hover:bg-background focus-visible:border-primary/60"

export const ChatTab = ({ chat, onChange }: ChatTabProps) => {
  const { t } = useI18n()

  const updateAutoCompact = useCallback(
    (patch: Partial<AutoCompactSettings>) => {
      onChange({
        ...chat,
        autoCompact: {
          ...chat.autoCompact,
          ...patch
        }
      })
    },
    [chat, onChange]
  )

  const updateStreamdown = useCallback(
    (patch: Partial<StreamdownSettings>) => {
      onChange({
        ...chat,
        streamdown: {
          ...chat.streamdown,
          ...patch
        }
      })
    },
    [chat, onChange]
  )

  const handleAutoCompactEnabledChange = useCallback(
    (checked: boolean) => updateAutoCompact({ enabled: checked }),
    [updateAutoCompact]
  )

  const handleStreamdownAnimationChange = useCallback(
    (nextValue: Key | Key[] | null) => {
      if (Array.isArray(nextValue) || nextValue === null) {
        return
      }

      const animation = getStreamdownAnimationValue(String(nextValue))

      if (!animation) {
        return
      }

      updateStreamdown({ animation })
    },
    [updateStreamdown]
  )

  const handleKeepRecentMessagesChange = useCallback(
    (value: number) => {
      updateAutoCompact({
        keepRecentMessages: clampAutoCompactKeepRecentMessages(value)
      })
    },
    [updateAutoCompact]
  )

  const handleThresholdChange = useCallback(
    (value: number | number[]) => {
      if (Array.isArray(value)) {
        return
      }

      updateAutoCompact({
        threshold: clampAutoCompactThreshold(value)
      })
    },
    [updateAutoCompact]
  )

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("settings.chat.title")}</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.chat.description")}
          </p>
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.chat.streamdown.title")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.chat.streamdown.description")}
          </p>
        </div>

        <Select
          className="mx-0.5 max-w-xl"
          fullWidth
          onChange={handleStreamdownAnimationChange}
          value={chat.streamdown.animation}
          variant="primary"
        >
          <Label className="text-xs font-medium text-muted-foreground">
            {t("settings.chat.streamdown.animation.label")}
          </Label>
          <Select.Trigger className={CHAT_FIELD_CLASS_NAME}>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="border border-border/80 bg-popover shadow-overlay">
            <ListBox>
              {STREAMDOWN_ANIMATION_OPTIONS.map((option) => (
                <ListBox.Item
                  id={option.value}
                  key={option.value}
                  textValue={t(option.labelKey)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {t(option.labelKey)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t(option.descriptionKey)}
                    </div>
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.chat.streamdown.animation.description")}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.35)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.chat.autoCompact.title")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.chat.autoCompact.description")}
          </p>
        </div>

        <ChatSwitchRow
          checked={chat.autoCompact.enabled}
          description={t("settings.chat.autoCompact.enabled.description")}
          label={t("settings.chat.autoCompact.enabled.label")}
          onChange={handleAutoCompactEnabledChange}
        />

        <Slider
          aria-label={t("settings.chat.autoCompact.threshold.label", {
            value: chat.autoCompact.threshold
          })}
          isDisabled={!chat.autoCompact.enabled}
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
            <Slider.Output className="text-xs font-medium text-muted-foreground" />
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
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.chat.autoCompact.threshold.description")}
        </p>

        <NumberField
          isDisabled={!chat.autoCompact.enabled}
          maxValue={AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX}
          minValue={AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN}
          onChange={handleKeepRecentMessagesChange}
          value={chat.autoCompact.keepRecentMessages}
        >
          <Label className="text-sm font-medium">
            {t("settings.chat.autoCompact.keepRecentMessages.label")}
          </Label>
          <NumberField.Group className="w-full max-w-40">
            <NumberField.DecrementButton />
            <NumberField.Input className="text-center tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.chat.autoCompact.keepRecentMessages.description")}
        </p>
      </motion.section>
    </div>
  )
}
