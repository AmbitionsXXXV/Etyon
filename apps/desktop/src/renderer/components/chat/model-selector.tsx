import { Button, Header, ListBox, Select } from "@heroui/react"
import type { Key } from "@heroui/react"

import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"

export const ModelSelector = ({
  disabled = false,
  emptyActionLabel,
  emptyLabel,
  groups,
  onOpenSettings,
  onValueChange,
  value
}: {
  disabled?: boolean
  emptyActionLabel: string
  emptyLabel: string
  groups: ChatModelGroup[]
  onOpenSettings: () => void
  onValueChange: (value: string | null) => void
  value: string
}) => {
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

  return (
    <Select
      aria-label="Model"
      className="w-56 max-w-full"
      isDisabled={disabled}
      onChange={handleChange}
      value={value || null}
      variant="secondary"
    >
      <Select.Trigger className="min-h-10 rounded-xl border-foreground/15 bg-popover/90 px-3 py-2 shadow-sm hover:bg-accent/10 dark:bg-popover/80 dark:hover:bg-accent/15">
        <Select.Value className="min-w-0 flex-1">
          {({ defaultChildren, isPlaceholder }) => {
            if (isPlaceholder || !selectedOption) {
              return defaultChildren
            }

            return (
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium">
                  {selectedOption.label}
                </span>
                {selectedOption.summary ? (
                  <span className="block truncate text-[0.6875rem] leading-4 text-muted-foreground">
                    {selectedOption.summary}
                  </span>
                ) : null}
              </span>
            )
          }}
        </Select.Value>
        <Select.Indicator className="size-3.5 shrink-0" />
      </Select.Trigger>
      <Select.Popover className="w-88 max-w-[calc(100vw-2rem)] border border-border/80 bg-popover shadow-overlay">
        <ListBox>
          {groups.map((group) => (
            <ListBox.Section key={group.providerId}>
              <Header className="px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground uppercase">
                {group.providerName}
              </Header>
              {group.options.map((option) => (
                <ListBox.Item
                  id={option.value}
                  key={option.value}
                  textValue={option.label}
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
      </Select.Popover>
    </Select>
  )
}
