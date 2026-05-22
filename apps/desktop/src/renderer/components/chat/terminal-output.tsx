import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import { Copy02Icon, CopyCheckIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import * as AnsiToReact from "ansi-to-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactElement, ReactNode } from "react"

const Ansi = AnsiToReact.default as (props: {
  children?: string
}) => ReactElement

interface TerminalOutputProps {
  autoScroll?: boolean
  className?: string
  command?: string
  contentClassName?: string
  header?: "hidden" | "visible"
  isStreaming?: boolean
  onClear?: () => void
  output: string
  prefix?: ReactNode
  title?: string
}

const TerminalStreamingCursor = () => (
  <span
    aria-hidden="true"
    className="ml-0.5 inline-block animate-pulse text-emerald-400"
  >
    ▋
  </span>
)

export const TerminalOutput = ({
  autoScroll = true,
  className,
  command,
  contentClassName,
  header = "visible",
  isStreaming = false,
  onClear,
  output,
  prefix,
  title
}: TerminalOutputProps) => {
  const { t } = useI18n()
  const [isCopied, setIsCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const hasOutput = output.length > 0
  const displayOutput = hasOutput ? output : t("chat.terminal.noOutput")

  useEffect(() => {
    if (!(autoScroll && contentRef.current)) {
      return
    }

    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [autoScroll, isStreaming, output])

  useEffect(() => {
    if (!isCopied) {
      return
    }

    const timeoutId = window.setTimeout(() => setIsCopied(false), 1200)

    return () => window.clearTimeout(timeoutId)
  }, [isCopied])

  const handleCopy = useCallback(async () => {
    if (!(hasOutput && navigator.clipboard)) {
      return
    }

    await navigator.clipboard.writeText(output)
    setIsCopied(true)
  }, [hasOutput, output])

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-inner",
        className
      )}
    >
      {header === "visible" ? (
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/90 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                isStreaming ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              )}
            />
            <div className="min-w-0">
              {title ? (
                <p className="truncate text-[0.6875rem] font-medium text-zinc-300">
                  {title}
                </p>
              ) : null}
              {command ? (
                <p className="truncate font-mono text-[0.6875rem] text-zinc-100">
                  <span className="text-zinc-500">$ </span>
                  {command}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onClear ? (
              <Button
                className="h-7 min-w-0 px-2 text-[0.6875rem] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                onPress={onClear}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("chat.terminal.clear")}
              </Button>
            ) : null}
            {hasOutput ? (
              <Button
                aria-label={t(
                  isCopied
                    ? "chat.toolTrace.copied"
                    : "chat.toolTrace.copyOutput"
                )}
                className="size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                isIconOnly
                onPress={handleCopy}
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon
                  icon={isCopied ? CopyCheckIcon : Copy02Icon}
                  size={14}
                />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "max-h-72 overflow-auto p-3 font-mono text-[0.6875rem] leading-5",
          contentClassName
        )}
        ref={contentRef}
      >
        {prefix}
        <div
          className={cn(
            "wrap-break-word whitespace-pre-wrap",
            hasOutput ? "text-zinc-100" : "text-zinc-500 italic"
          )}
        >
          {hasOutput ? <Ansi>{displayOutput}</Ansi> : displayOutput}
          {isStreaming ? <TerminalStreamingCursor /> : null}
        </div>
      </div>
    </div>
  )
}
