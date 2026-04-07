import { Button } from "@etyon/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"

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
  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button
          disabled={disabled}
          onClick={onOpenSettings}
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
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger
        className="w-[13rem] max-w-full rounded-xl px-3"
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        className="w-[22rem] max-w-[calc(100vw-2rem)]"
      >
        {groups.map((group) => (
          <SelectGroup key={group.providerId}>
            <SelectLabel>{group.providerName}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="min-w-0 flex-1 pr-5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {option.label}
                    </span>
                    {option.summary && (
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {option.summary}
                      </span>
                    )}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
