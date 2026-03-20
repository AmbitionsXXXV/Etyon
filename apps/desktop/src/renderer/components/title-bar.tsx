import { cn } from "@etyon/ui/lib/utils"

const TITLEBAR_HEIGHT = 40

interface TitleBarProps {
  variant?: "embedded" | "overlay"
}

export const TitleBar = ({ variant = "overlay" }: TitleBarProps) => (
  <header
    className={cn(
      "title-bar-drag flex select-none items-center justify-between px-4 text-[0.68rem] text-muted-foreground backdrop-blur-sm",
      {
        "shrink-0 bg-background": variant === "embedded",
        "fixed inset-x-0 top-0 z-50 bg-background/85": variant === "overlay"
      }
    )}
    style={{ height: TITLEBAR_HEIGHT }}
  >
    <div aria-hidden className="w-8" />
  </header>
)

export const TITLE_BAR_HEIGHT = TITLEBAR_HEIGHT
