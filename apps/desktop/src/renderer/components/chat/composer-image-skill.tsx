import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Dropdown, Header } from "@heroui/react"
import type { Key } from "@heroui/react"
import {
  Attachment01Icon,
  Cancel01Icon,
  ComputerIcon,
  Image01Icon,
  PlusSignIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { ProviderIcon } from "@/renderer/components/providers/provider-icon"
import { resolveImageModeForModelChange } from "@/renderer/lib/chat/image-mode"
import {
  getImageSkillModelOptions,
  resolveImageSkillModel
} from "@/renderer/lib/chat/image-skill"
import type {
  ChatModelGroup,
  ChatModelOption
} from "@/renderer/lib/chat/model-options"
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_TRANSITION_FAST_CLASS
} from "@/renderer/lib/motion"

/** What the composer needs to offer, show, and leave the Image skill. */
export interface ComposerImageSkill {
  isActive: boolean
  /** False while no image-output model is configured or a turn is running. */
  isAvailable: boolean
  labels: {
    menuDescription: string
    menuLabel: string
    remove: string
    suggestion: string
    suggestionDismiss: string
  }
  onActivate: () => void
  onDeactivate: () => void
}

const SKILL_ENTER_MOTION = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 4 },
  transition: { duration: MOTION_DURATION.base, ease: MOTION_EASE }
}

const MENU_ITEM_ICON_CLASS_NAME = "size-4 shrink-0 text-muted-foreground"

/**
 * The `+` menu at the start of the composer row: attachments, window capture,
 * and skills, so none of them needs its own slot on the one-line toolbar.
 */
export const ComposerAddMenu = ({
  attachDisabledLabel,
  attachLabel,
  captureLabel,
  disabled,
  imageSkill,
  isAttachDisabled,
  onAttach,
  onCapture,
  skillsLabel,
  triggerLabel
}: {
  attachDisabledLabel: string
  attachLabel: string
  /** Omitted when window capture is unavailable on this platform. */
  captureLabel?: string
  disabled: boolean
  imageSkill?: ComposerImageSkill
  isAttachDisabled: boolean
  onAttach: () => void
  onCapture?: () => void
  skillsLabel: string
  triggerLabel: string
}) => {
  const handleAction = useCallback(
    (key: Key) => {
      if (key === "attach") {
        onAttach()
      } else if (key === "capture") {
        onCapture?.()
      } else if (key === "image") {
        imageSkill?.onActivate()
      }
    },
    [imageSkill, onAttach, onCapture]
  )
  const disabledKeys = [
    ...(isAttachDisabled ? ["attach"] : []),
    ...(imageSkill && (!imageSkill.isAvailable || imageSkill.isActive)
      ? ["image"]
      : [])
  ]

  return (
    <Dropdown>
      <Button
        aria-label={triggerLabel}
        className={cn(
          "size-8 min-w-8 shrink-0 rounded-full bg-foreground/8 hover:bg-foreground/12",
          MOTION_TRANSITION_FAST_CLASS
        )}
        isDisabled={disabled}
        isIconOnly
        size="sm"
        variant="secondary"
      >
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
      </Button>
      <Dropdown.Popover
        className="min-w-64 border border-border/80 bg-popover shadow-overlay"
        placement="top start"
      >
        <Dropdown.Menu disabledKeys={disabledKeys} onAction={handleAction}>
          <Dropdown.Item
            id="attach"
            textValue={isAttachDisabled ? attachDisabledLabel : attachLabel}
          >
            <HugeiconsIcon
              className={MENU_ITEM_ICON_CLASS_NAME}
              icon={Attachment01Icon}
              strokeWidth={2}
            />
            <span className="min-w-0 truncate">
              {isAttachDisabled ? attachDisabledLabel : attachLabel}
            </span>
          </Dropdown.Item>
          {captureLabel && onCapture ? (
            <Dropdown.Item id="capture" textValue={captureLabel}>
              <HugeiconsIcon
                className={MENU_ITEM_ICON_CLASS_NAME}
                icon={ComputerIcon}
                strokeWidth={2}
              />
              <span>{captureLabel}</span>
            </Dropdown.Item>
          ) : null}
          {imageSkill ? (
            <Dropdown.Section>
              <Header className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                {skillsLabel}
              </Header>
              <Dropdown.Item id="image" textValue={imageSkill.labels.menuLabel}>
                <HugeiconsIcon
                  className="size-4 shrink-0 text-warning"
                  icon={Image01Icon}
                  strokeWidth={2}
                />
                <span className="flex-1">{imageSkill.labels.menuLabel}</span>
                <span className="text-xs text-muted-foreground">
                  {imageSkill.labels.menuDescription}
                </span>
              </Dropdown.Item>
            </Dropdown.Section>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

/** The active-skill chip that takes the agent-mode pill's place. */
export const ComposerImageSkillChip = ({
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
    className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-warning-soft pr-1 pl-2.5 text-xs font-medium text-warning-soft-foreground"
    initial={SKILL_ENTER_MOTION.initial}
    transition={SKILL_ENTER_MOTION.transition}
  >
    <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={2} />
    <span>{label}</span>
    <button
      aria-label={removeLabel}
      className={cn(
        "flex size-6 items-center justify-center rounded-full hover:bg-warning/15 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
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

/** Ghost suggestion under the editor when the draft reads like an image request. */
export const ComposerImageSkillSuggestion = ({
  dismissLabel,
  label,
  onAccept
}: {
  dismissLabel: string
  label: string
  onAccept: () => void
}) => (
  <motion.button
    animate={SKILL_ENTER_MOTION.animate}
    className={cn(
      "mt-2 flex h-7 w-fit items-center gap-2 rounded-lg border border-dashed border-warning/45 bg-warning-soft/50 pr-1.5 pl-2.5 text-xs text-warning-soft-foreground hover:bg-warning-soft",
      MOTION_TRANSITION_FAST_CLASS
    )}
    initial={SKILL_ENTER_MOTION.initial}
    onClick={onAccept}
    onMouseDown={(event) => event.preventDefault()}
    transition={SKILL_ENTER_MOTION.transition}
    type="button"
  >
    <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={2} />
    <span>{label}</span>
    <kbd className="rounded-md border border-b-2 border-border px-1.5 font-mono text-[0.6875rem] leading-4 text-foreground">
      Tab
    </kbd>
    <span className="text-[0.6875rem] text-muted-foreground">
      {dismissLabel}
    </span>
  </motion.button>
)

/** Single-line picker for the skill's image model, shown in place of the chat model. */
export const ComposerImageModelPicker = ({
  disabled,
  label,
  onChange,
  options,
  value
}: {
  disabled: boolean
  label: string
  onChange: (value: string) => void
  options: readonly ChatModelOption[]
  value: string
}) => {
  const selected = options.find((option) => option.value === value)

  return (
    <Dropdown>
      <Button
        aria-label={label}
        className="h-8 max-w-56 min-w-0 shrink gap-1.5 rounded-full bg-foreground/8 px-3 text-xs hover:bg-foreground/12"
        isDisabled={disabled}
        size="sm"
        variant="secondary"
      >
        {selected ? (
          <ProviderIcon
            className="size-3.5 shrink-0"
            providerId={selected.providerId}
          />
        ) : null}
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
      </Button>
      <Dropdown.Popover
        className="min-w-56 border border-border/80 bg-popover shadow-overlay"
        placement="top start"
      >
        <Dropdown.Menu
          aria-label={label}
          onAction={(key) => onChange(String(key))}
          selectedKeys={[value]}
          selectionMode="single"
        >
          {options.map((option) => (
            <Dropdown.Item
              id={option.value}
              key={option.value}
              textValue={option.label}
            >
              <ProviderIcon
                className="size-4 shrink-0"
                providerId={option.providerId}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="truncate text-xs text-muted-foreground">
                {option.providerName}
              </span>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

/**
 * Owns the Image skill's state for one composer: whether it is on, which image
 * model it targets (separate from the chat model), and the model slot that
 * swaps the chat model picker for the image model picker while it is on.
 */
export const useComposerImageSkill = ({
  isSelectedModelImageCapable,
  modelGroups,
  selectedModelValue
}: {
  isSelectedModelImageCapable: boolean
  modelGroups: ChatModelGroup[]
  selectedModelValue: string
}) => {
  const { t } = useI18n()
  const [isSkillOn, setIsSkillOn] = useState(isSelectedModelImageCapable)
  const [preferredModelValue, setPreferredModelValue] = useState<string | null>(
    null
  )
  const previousImageCapableRef = useRef(isSelectedModelImageCapable)
  const modelOptions = useMemo(
    () => getImageSkillModelOptions(modelGroups),
    [modelGroups]
  )
  const imageModelValue = resolveImageSkillModel({
    options: modelOptions,
    preferredValue: preferredModelValue,
    selectedChatModelValue: selectedModelValue
  })
  const isImageMode = isSkillOn && imageModelValue !== null

  // A pure image chat model cannot chat, so selecting one turns the skill on;
  // moving off it turns the skill off; otherwise the user's choice stands.
  useEffect(() => {
    setIsSkillOn((previous) =>
      resolveImageModeForModelChange({
        isCapable: isSelectedModelImageCapable,
        previous,
        wasCapable: previousImageCapableRef.current
      })
    )
    previousImageCapableRef.current = isSelectedModelImageCapable
  }, [isSelectedModelImageCapable])

  const hasImageModels = modelOptions.length > 0
  const skill = useMemo<ComposerImageSkill>(
    () => ({
      isActive: isImageMode,
      isAvailable: hasImageModels,
      labels: {
        menuDescription: t("chat.imageSkill.menuDescription"),
        menuLabel: t("chat.imageSkill.label"),
        remove: t("chat.imageSkill.remove"),
        suggestion: t("chat.imageSkill.suggestion"),
        suggestionDismiss: t("chat.imageSkill.suggestionDismiss")
      },
      onActivate: () => setIsSkillOn(hasImageModels),
      onDeactivate: () => setIsSkillOn(false)
    }),
    [hasImageModels, isImageMode, t]
  )

  const renderModelSlot = (
    chatModelSelector: ReactNode,
    isDisabled: boolean
  ): ReactNode =>
    isImageMode && imageModelValue ? (
      <ComposerImageModelPicker
        disabled={isDisabled}
        label={t("chat.imageSkill.modelLabel")}
        onChange={setPreferredModelValue}
        options={modelOptions}
        value={imageModelValue}
      />
    ) : (
      chatModelSelector
    )

  return {
    imageModelValue: isImageMode ? (imageModelValue ?? undefined) : undefined,
    isImageMode,
    renderModelSlot,
    skill
  }
}
