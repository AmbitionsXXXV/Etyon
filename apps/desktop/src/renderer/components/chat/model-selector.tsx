import type { ModelEffortSettings } from "@etyon/rpc"
import {
  Autocomplete,
  Button,
  Header,
  ListBox,
  SearchField,
  Separator,
  Slider,
  useFilter
} from "@heroui/react"
import type { Key } from "@heroui/react"

import { ProviderIcon } from "@/renderer/components/providers/provider-icon"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  getEffortLevels,
  getEffortProviderId
} from "@/shared/providers/model-effort"
import type {
  AnthropicEffortLevel,
  EffortProviderId,
  OpenAiEffortLevel
} from "@/shared/providers/model-effort"

const ModelEffortSlider = ({
  effortLabel,
  effortLevelLabels,
  effortProviderId,
  modelEffort,
  onEffortChange
}: {
  effortLabel: string
  effortLevelLabels: Record<string, string>
  effortProviderId: EffortProviderId
  modelEffort: ModelEffortSettings
  onEffortChange: (
    provider: EffortProviderId,
    level: AnthropicEffortLevel | OpenAiEffortLevel
  ) => void
}) => {
  const levels = getEffortLevels(effortProviderId)
  const levelIds = levels as readonly string[]
  const currentLevel = modelEffort[effortProviderId]
  const activeIndex = Math.max(0, levelIds.indexOf(currentLevel))
  const maxIndex = levels.length - 1

  const handleChange = (nextValue: number | number[]) => {
    const nextIndex = typeof nextValue === "number" ? nextValue : nextValue[0]

    onEffortChange(effortProviderId, levels[nextIndex ?? activeIndex])
  }

  return (
    <>
      <Separator className="my-1" />
      <div className="px-3 pt-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] font-medium text-muted-foreground uppercase">
            {effortLabel}
          </span>
          <span className="text-xs font-medium text-foreground">
            {effortLevelLabels[currentLevel]}
          </span>
        </div>
        <Slider
          aria-label={effortLabel}
          className="mt-2"
          maxValue={maxIndex}
          minValue={0}
          onChange={handleChange}
          step={1}
          value={activeIndex}
        >
          <Slider.Track className="relative">
            {levelIds.map((level, index) => (
              <span
                className="pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
                key={level}
                style={{ left: `${(index / maxIndex) * 100}%` }}
              />
            ))}
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>
    </>
  )
}

export const ModelSelector = ({
  disabled = false,
  effortLabel,
  effortLevelLabels,
  emptyActionLabel,
  emptyLabel,
  groups,
  modelEffort,
  onEffortChange,
  onOpenSettings,
  onValueChange,
  searchEmptyLabel,
  searchPlaceholder,
  value
}: {
  disabled?: boolean
  effortLabel: string
  effortLevelLabels: Record<string, string>
  emptyActionLabel: string
  emptyLabel: string
  groups: ChatModelGroup[]
  modelEffort: ModelEffortSettings
  onEffortChange: (
    provider: EffortProviderId,
    level: AnthropicEffortLevel | OpenAiEffortLevel
  ) => void
  onOpenSettings: () => void
  onValueChange: (value: string | null) => void
  searchEmptyLabel: string
  searchPlaceholder: string
  value: string
}) => {
  const { contains } = useFilter({ sensitivity: "base" })
  const selectedOption = groups
    .flatMap((group) => group.options)
    .find((option) => option.value === value)

  const handleChange = (nextValue: Key | Key[] | null) => {
    if (Array.isArray(nextValue)) {
      onValueChange(nextValue[0]?.toString() ?? null)
      return
    }

    onValueChange(nextValue?.toString() ?? null)
  }

  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button
          isDisabled={disabled}
          onPress={onOpenSettings}
          size="sm"
          type="button"
          variant="outline"
        >
          {emptyActionLabel}
        </Button>
        <span className="truncate text-xs text-muted-foreground">
          {emptyLabel}
        </span>
      </div>
    )
  }

  const effortProviderId = selectedOption
    ? getEffortProviderId({
        model: selectedOption,
        providerId: selectedOption.providerId
      })
    : null

  return (
    <Autocomplete
      aria-label="Model"
      className="w-56 max-w-full"
      isDisabled={disabled}
      onChange={handleChange}
      selectionMode="single"
      value={value || null}
      variant="secondary"
    >
      <Autocomplete.Trigger className="min-h-10 rounded-xl border-foreground/15 bg-popover/90 px-3 py-2 shadow-sm hover:bg-accent/10 dark:bg-popover/80 dark:hover:bg-accent/15">
        <Autocomplete.Value className="min-w-0 flex-1">
          {({ defaultChildren, isPlaceholder }) => {
            if (isPlaceholder || !selectedOption) {
              return defaultChildren
            }

            return (
              <span className="flex min-w-0 items-center gap-2 text-left">
                <ProviderIcon
                  className="size-4 text-foreground"
                  providerId={selectedOption.providerId}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {selectedOption.label}
                  </span>
                  {selectedOption.summary ? (
                    <span className="block truncate text-[0.6875rem] leading-4 text-muted-foreground">
                      {selectedOption.summary}
                    </span>
                  ) : null}
                </span>
              </span>
            )
          }}
        </Autocomplete.Value>
        <Autocomplete.Indicator className="size-3.5 shrink-0" />
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="w-88 max-w-[calc(100vw-2rem)] border border-border/80 bg-popover shadow-overlay">
        <Autocomplete.Filter filter={contains}>
          <SearchField
            aria-label={searchPlaceholder}
            autoFocus
            className="mb-1"
            variant="secondary"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={searchPlaceholder} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox
            className="max-h-64 overflow-y-auto"
            renderEmptyState={() => (
              <div className="p-3 text-xs text-muted-foreground">
                {searchEmptyLabel}
              </div>
            )}
          >
            {groups.map((group) => (
              <ListBox.Section key={group.providerId}>
                <Header className="flex items-center gap-1.5 px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground uppercase">
                  <ProviderIcon
                    className="size-3.5"
                    providerId={group.providerId}
                  />
                  {group.providerName}
                </Header>
                {group.options.map((option) => (
                  <ListBox.Item
                    id={option.value}
                    key={option.value}
                    textValue={`${option.label} ${group.providerName}`}
                  >
                    <span className="min-w-0 flex-1 pr-5">
                      <span className="block truncate text-sm font-medium">
                        {option.label}
                      </span>
                      {option.summary ? (
                        <span className="block truncate text-[0.6875rem] text-muted-foreground">
                          {option.summary}
                        </span>
                      ) : null}
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ))}
          </ListBox>
        </Autocomplete.Filter>
        {effortProviderId ? (
          <ModelEffortSlider
            effortLabel={effortLabel}
            effortLevelLabels={effortLevelLabels}
            effortProviderId={effortProviderId}
            modelEffort={modelEffort}
            onEffortChange={onEffortChange}
          />
        ) : null}
      </Autocomplete.Popover>
    </Autocomplete>
  )
}
