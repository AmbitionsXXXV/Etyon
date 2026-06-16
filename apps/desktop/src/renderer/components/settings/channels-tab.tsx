import { useI18n } from "@etyon/i18n/react"
import type { TelegramSettings, TelegramTestConnectionOutput } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  Button,
  Header,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextArea
} from "@heroui/react"
import type { Key } from "@heroui/react"
import { useMutation } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback, useMemo, useState } from "react"

import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import { rpcClient } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import {
  formatTelegramBotMention,
  normalizeTelegramSettingsDraft
} from "@/renderer/lib/settings-page/telegram-settings"

const BOT_FATHER_LINK_PLACEHOLDER = "{{LINK}}"
const BOT_FATHER_URL = "https://t.me/BotFather"
const TELEGRAM_DEFAULT_MODEL_INHERIT_VALUE = "__global_default_model__"
const TELEGRAM_FIELD_CLASS_NAME =
  "border-border/80 bg-background/80 shadow-sm hover:bg-background focus-visible:border-primary/60"
const TELEGRAM_TEXTAREA_CLASS_NAME = cn(
  "mx-0.5 min-h-24 resize-none",
  TELEGRAM_FIELD_CLASS_NAME
)

const openExternalUrl = (url: string): void => {
  window.electron.ipcRenderer.invoke("open-external-url", url)
}

const BotFatherHint = () => {
  const { t } = useI18n()
  const raw = t("settings.telegram.botFatherHint", {
    link: BOT_FATHER_LINK_PLACEHOLDER
  })
  const [before = "", after = ""] = raw.split(BOT_FATHER_LINK_PLACEHOLDER)

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      openExternalUrl(BOT_FATHER_URL)
    },
    []
  )

  return (
    <p className="text-xs leading-5 text-muted-foreground">
      {before}
      <a
        className="cursor-pointer text-primary underline underline-offset-2"
        href={BOT_FATHER_URL}
        onClick={handleClick}
        rel="noopener noreferrer"
      >
        @BotFather
      </a>
      {after}
    </p>
  )
}

interface ChannelsTabProps {
  modelGroups: ChatModelGroup[]
  onChange: (telegram: TelegramSettings) => void
  telegram: Partial<TelegramSettings>
}

const getTelegramBotLabel = (result: TelegramTestConnectionOutput): string => {
  if (!result.bot) {
    return ""
  }

  if (result.bot.username) {
    return `@${result.bot.username}`
  }

  return result.bot.firstName
}

const TelegramStatusPanel = ({
  result
}: {
  result: TelegramTestConnectionOutput | null
}) => {
  const { t } = useI18n()

  if (!result) {
    return null
  }

  const botLabel = getTelegramBotLabel(result)

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-xs",
        result.ok
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      {result.ok && result.bot
        ? t("settings.telegram.status.connected", {
            bot: botLabel,
            id: result.bot.id
          })
        : (result.error ?? t("settings.telegram.status.failed"))}
    </div>
  )
}

const TelegramSwitch = ({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch aria-label={label} isSelected={checked} onChange={onChange}>
    <Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Content>
  </Switch>
)

const TelegramDefaultModelSelect = ({
  modelGroups,
  onChange,
  value
}: {
  modelGroups: ChatModelGroup[]
  onChange: (value: string) => void
  value: string
}) => {
  const { t } = useI18n()
  const allOptions = useMemo(
    () => modelGroups.flatMap((group) => group.options),
    [modelGroups]
  )
  const selectedOption = allOptions.find((option) => option.value === value)
  const shouldShowUnavailableModel = Boolean(value && !selectedOption)
  const selectedValue = value || TELEGRAM_DEFAULT_MODEL_INHERIT_VALUE

  const handleChange = useCallback(
    (nextValue: Key | Key[] | null) => {
      if (Array.isArray(nextValue)) {
        return
      }

      const normalizedValue =
        nextValue === TELEGRAM_DEFAULT_MODEL_INHERIT_VALUE || nextValue === null
          ? ""
          : String(nextValue)

      onChange(normalizedValue)
    },
    [onChange]
  )

  return (
    <div className="space-y-2">
      <Select
        className="mx-0.5"
        fullWidth
        onChange={handleChange}
        placeholder={t("settings.telegram.fields.defaultModel.placeholder")}
        value={selectedValue}
        variant="primary"
      >
        <Label className="text-xs font-medium">
          {t("settings.telegram.fields.defaultModel.label")}
        </Label>
        <Select.Trigger className={TELEGRAM_FIELD_CLASS_NAME}>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="border border-border/80 bg-popover shadow-overlay">
          <ListBox>
            <ListBox.Item
              id={TELEGRAM_DEFAULT_MODEL_INHERIT_VALUE}
              textValue={t("settings.telegram.fields.defaultModel.inherit")}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {t("settings.telegram.fields.defaultModel.inherit")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t("settings.telegram.fields.defaultModel.description")}
                </div>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>

            {shouldShowUnavailableModel && (
              <ListBox.Item id={value} textValue={value}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{value}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t("settings.telegram.fields.defaultModel.unavailable")}
                  </div>
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}

            {modelGroups.map((group) => (
              <ListBox.Section key={group.providerId}>
                <Header>{group.providerName}</Header>
                {group.options.map((option) => (
                  <ListBox.Item
                    id={option.value}
                    key={option.value}
                    textValue={option.label}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {option.label}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {option.summary || option.id}
                      </div>
                    </div>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  )
}

export const ChannelsTab = ({
  modelGroups,
  onChange,
  telegram
}: ChannelsTabProps) => {
  const { t } = useI18n()
  const normalizedTelegram = useMemo(
    () => normalizeTelegramSettingsDraft(telegram),
    [telegram]
  )
  const [isBotTokenVisible, setIsBotTokenVisible] = useState(false)
  const [testResult, setTestResult] =
    useState<TelegramTestConnectionOutput | null>(null)
  const botMention = formatTelegramBotMention(normalizedTelegram.botUsername)

  const updateTelegram = useCallback(
    (patch: Partial<TelegramSettings>) => {
      onChange({ ...normalizedTelegram, ...patch })
      setTestResult(null)
    },
    [normalizedTelegram, onChange]
  )

  const testConnectionMutation = useMutation({
    mutationFn: () =>
      rpcClient.telegram.testConnection({
        botToken: normalizedTelegram.botToken
      }),
    onSuccess: (result) => {
      setTestResult(result)

      if (result.ok && result.bot?.username) {
        onChange({
          ...normalizedTelegram,
          botUsername: result.bot.username
        })
      }
    }
  })

  const handleAllowedChatIdsChange = useCallback<
    ChangeEventHandler<HTMLTextAreaElement>
  >(
    (event) => updateTelegram({ allowedChatIds: event.target.value }),
    [updateTelegram]
  )

  const handleAllowedUserIdsChange = useCallback<
    ChangeEventHandler<HTMLTextAreaElement>
  >(
    (event) => updateTelegram({ allowedUserIds: event.target.value }),
    [updateTelegram]
  )

  const handleBotTokenChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(
    (event) =>
      updateTelegram({
        botToken: event.target.value,
        botUsername: ""
      }),
    [updateTelegram]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateTelegram({ enabled: checked }),
    [updateTelegram]
  )

  const handleDefaultModelChange = useCallback(
    (defaultModel: string) => updateTelegram({ defaultModel }),
    [updateTelegram]
  )

  const handleRequireMentionChange = useCallback(
    (checked: boolean) => updateTelegram({ requireMentionInGroups: checked }),
    [updateTelegram]
  )

  const handleTestConnection = useCallback(() => {
    testConnectionMutation.mutate()
  }, [testConnectionMutation])

  const handleToggleBotTokenVisibility = useCallback(() => {
    setIsBotTokenVisible((previous) => !previous)
  }, [])

  const botTokenVisibilityLabel = t(
    isBotTokenVisible
      ? "settings.telegram.actions.hideBotToken"
      : "settings.telegram.actions.showBotToken"
  )
  const testButtonLabel = testConnectionMutation.isPending
    ? t("settings.telegram.actions.testing")
    : t("settings.telegram.actions.test")
  const canTest = useMemo(
    () =>
      Boolean(normalizedTelegram.botToken.trim()) &&
      !testConnectionMutation.isPending,
    [normalizedTelegram.botToken, testConnectionMutation.isPending]
  )

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.telegram.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.telegram.description")}
            </p>
            <BotFatherHint />
          </div>

          <TelegramSwitch
            checked={normalizedTelegram.enabled}
            label={t("settings.telegram.title")}
            onChange={handleEnabledChange}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium">
              {t("settings.telegram.fields.botToken.label")}
            </label>
            <Button
              onPress={handleToggleBotTokenVisibility}
              size="sm"
              type="button"
              variant="ghost"
            >
              {botTokenVisibilityLabel}
            </Button>
          </div>
          <Input
            autoComplete="off"
            className={cn("mx-0.5 w-full", TELEGRAM_FIELD_CLASS_NAME)}
            onChange={handleBotTokenChange}
            placeholder={t("settings.telegram.fields.botToken.placeholder")}
            type={isBotTokenVisible ? "text" : "password"}
            variant="primary"
            value={normalizedTelegram.botToken}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium">
            {t("settings.telegram.fields.botUsername.label")}
          </label>
          <Input
            className={cn("mx-0.5", TELEGRAM_FIELD_CLASS_NAME)}
            placeholder={t("settings.telegram.fields.botUsername.placeholder")}
            readOnly
            variant="primary"
            value={botMention}
          />
          <p className="text-[0.6875rem] leading-5 text-muted-foreground">
            {t("settings.telegram.fields.botUsername.description", {
              bot: botMention || "@bot_username"
            })}
          </p>
        </div>

        <TelegramDefaultModelSelect
          modelGroups={modelGroups}
          onChange={handleDefaultModelChange}
          value={normalizedTelegram.defaultModel}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("settings.telegram.fields.allowedUserIds.label")}
            </label>
            <TextArea
              className={TELEGRAM_TEXTAREA_CLASS_NAME}
              onChange={handleAllowedUserIdsChange}
              placeholder={t(
                "settings.telegram.fields.allowedUserIds.placeholder"
              )}
              rows={4}
              value={normalizedTelegram.allowedUserIds}
            />
            <p className="text-[0.6875rem] leading-5 text-muted-foreground">
              {t("settings.telegram.fields.allowedUserIds.description")}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("settings.telegram.fields.allowedChatIds.label")}
            </label>
            <TextArea
              className={TELEGRAM_TEXTAREA_CLASS_NAME}
              onChange={handleAllowedChatIdsChange}
              placeholder={t(
                "settings.telegram.fields.allowedChatIds.placeholder"
              )}
              rows={4}
              value={normalizedTelegram.allowedChatIds}
            />
            <p className="text-[0.6875rem] leading-5 text-muted-foreground">
              {t("settings.telegram.fields.allowedChatIds.description")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/50 px-3 py-3">
          <div>
            <h3 className="text-xs font-medium">
              {t("settings.telegram.fields.requireMentionInGroups.label")}
            </h3>
            <p className="pt-1 text-[0.6875rem] leading-5 text-muted-foreground">
              {t("settings.telegram.fields.requireMentionInGroups.description")}
            </p>
          </div>

          <TelegramSwitch
            checked={normalizedTelegram.requireMentionInGroups}
            label={t("settings.telegram.fields.requireMentionInGroups.label")}
            onChange={handleRequireMentionChange}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            isDisabled={!canTest}
            onPress={handleTestConnection}
            type="button"
            variant="outline"
          >
            {testButtonLabel}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("settings.telegram.status.savedSettingsOnly")}
          </span>
        </div>

        <TelegramStatusPanel result={testResult} />
      </motion.section>
    </div>
  )
}
