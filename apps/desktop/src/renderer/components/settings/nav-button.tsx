import { cn } from "@etyon/ui/lib/utils"
import type { Settings02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export const NavButton = ({
  icon,
  isActive,
  label,
  onSelect
}: {
  icon: typeof Settings02Icon
  isActive: boolean
  label: string
  onSelect: () => void
}) => (
  <button
    className={cn(
      "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
      isActive
        ? "bg-primary/10 text-primary font-medium"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    )}
    onClick={onSelect}
    type="button"
  >
    <HugeiconsIcon icon={icon} size={16} />
    {label}
  </button>
)
