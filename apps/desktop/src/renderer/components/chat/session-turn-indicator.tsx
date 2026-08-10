import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Tooltip } from "@heroui/react"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties, RefObject } from "react"

import {
  getCurrentSessionTurnIndex,
  getSessionTurnMarkerScale
} from "@/renderer/lib/chat/session-turn-indicator"
import type { ChatSessionTurn } from "@/renderer/lib/chat/session-turn-indicator"

const SESSION_TURN_READING_OFFSET_PX = 96
const SESSION_TURN_REF_RETRY_INTERVAL_MS = 50

interface ChatSessionTurnIndicatorProps {
  isVisible: boolean
  scrollContainerRef: RefObject<HTMLDivElement | null>
  turns: readonly ChatSessionTurn[]
}

export const ChatSessionTurnIndicator = ({
  isVisible,
  scrollContainerRef,
  turns
}: ChatSessionTurnIndicatorProps) => {
  const { t } = useI18n()
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number | null>(0)
  const [focusedTurnIndex, setFocusedTurnIndex] = useState<number | null>(null)
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const emphasizedTurnIndex =
    hoveredTurnIndex ?? focusedTurnIndex ?? currentTurnIndex

  useEffect(() => {
    let connectionFrameId: number | null = null
    let connectionIntervalId: number | null = null
    let animationFrameId: number | null = null
    let resizeObserver: ResizeObserver | null = null
    let scrollElement: HTMLDivElement | null = null

    const updateCurrentTurn = () => {
      animationFrameId = null
      const currentScrollElement = scrollElement

      if (!currentScrollElement) {
        return
      }

      const scrollBounds = currentScrollElement.getBoundingClientRect()
      const readingLine =
        scrollBounds.top +
        Math.min(SESSION_TURN_READING_OFFSET_PX, scrollBounds.height / 4)
      const turnTops = turns.map((turn) => {
        const selector = `[data-chat-message-id="${CSS.escape(
          turn.userMessageId
        )}"]`
        const messageElement = currentScrollElement.querySelector(selector)

        return (
          messageElement?.getBoundingClientRect().top ??
          Number.POSITIVE_INFINITY
        )
      })
      const nextTurnIndex = getCurrentSessionTurnIndex(turnTops, readingLine)

      setCurrentTurnIndex((currentIndex) =>
        currentIndex === nextTurnIndex ? currentIndex : nextTurnIndex
      )
    }

    const scheduleCurrentTurnUpdate = () => {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(updateCurrentTurn)
    }

    const connectToScrollElement = () => {
      if (scrollElement) {
        return
      }

      const nextScrollElement = scrollContainerRef.current

      if (!nextScrollElement) {
        return
      }

      scrollElement = nextScrollElement
      if (connectionIntervalId !== null) {
        window.clearInterval(connectionIntervalId)
        connectionIntervalId = null
      }
      resizeObserver = new ResizeObserver(scheduleCurrentTurnUpdate)
      scrollElement.addEventListener("scroll", scheduleCurrentTurnUpdate, {
        passive: true
      })
      resizeObserver.observe(scrollElement)
      const messageElements = scrollElement.querySelectorAll(
        "[data-chat-message-id]"
      )
      for (const messageElement of messageElements) {
        resizeObserver.observe(messageElement)
      }
      scheduleCurrentTurnUpdate()
    }

    connectionFrameId = window.requestAnimationFrame(connectToScrollElement)
    connectionIntervalId = window.setInterval(
      connectToScrollElement,
      SESSION_TURN_REF_RETRY_INTERVAL_MS
    )

    return () => {
      scrollElement?.removeEventListener("scroll", scheduleCurrentTurnUpdate)
      resizeObserver?.disconnect()

      if (connectionFrameId !== null) {
        window.cancelAnimationFrame(connectionFrameId)
      }

      if (connectionIntervalId !== null) {
        window.clearInterval(connectionIntervalId)
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [scrollContainerRef, turns])

  useEffect(() => {
    if (currentTurnIndex === null) {
      return
    }

    const listElement = listRef.current
    const markerElement = listElement?.querySelector<HTMLButtonElement>(
      `[data-chat-session-turn="${currentTurnIndex}"]`
    )

    if (!(listElement && markerElement)) {
      return
    }

    const markerTop = markerElement.offsetTop
    const markerBottom = markerTop + markerElement.offsetHeight

    if (markerTop < listElement.scrollTop) {
      listElement.scrollTo({ top: markerTop })
    } else if (
      markerBottom >
      listElement.scrollTop + listElement.clientHeight
    ) {
      listElement.scrollTo({
        top: markerBottom - listElement.clientHeight
      })
    }
  }, [currentTurnIndex, turns])

  const handleTurnPress = (turn: ChatSessionTurn) => {
    const scrollElement = scrollContainerRef.current
    const selector = `[data-chat-message-id="${CSS.escape(
      turn.userMessageId
    )}"]`
    const messageElement = scrollElement?.querySelector(selector)
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    messageElement?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    })
  }

  if (!isVisible || turns.length === 0) {
    return null
  }

  return (
    <nav
      aria-label={t("chat.sessionIndicator.label")}
      className="absolute inset-y-0 left-0 z-20 flex w-16 flex-col justify-center py-5"
      data-chat-session-indicator=""
    >
      <div
        className="flex max-h-[60%] flex-none [scrollbar-width:none] flex-col items-start overflow-y-auto [&::-webkit-scrollbar]:hidden"
        ref={listRef}
      >
        {turns.map((turn, turnIndex) => {
          const isEmphasized = turnIndex === emphasizedTurnIndex
          const markerStyle = {
            transform: `scaleX(${getSessionTurnMarkerScale(
              turnIndex,
              emphasizedTurnIndex
            )})`
          } satisfies CSSProperties
          const turnLabel = t("chat.sessionIndicator.turn", {
            number: turnIndex + 1
          })

          return (
            <Tooltip closeDelay={80} delay={120} key={turn.id}>
              <Tooltip.Trigger<"button">
                aria-label={t("chat.sessionIndicator.viewTurn", {
                  number: turnIndex + 1
                })}
                className="flex h-5 w-14 shrink-0 cursor-pointer items-center focus-visible:outline-none"
                data-active={isEmphasized || undefined}
                data-chat-session-turn={turnIndex}
                onBlur={() => setFocusedTurnIndex(null)}
                onClick={() => handleTurnPress(turn)}
                onFocus={() => setFocusedTurnIndex(turnIndex)}
                onPointerEnter={() => setHoveredTurnIndex(turnIndex)}
                onPointerLeave={() => setHoveredTurnIndex(null)}
                render={(triggerProps) => (
                  <button {...triggerProps} type="button" />
                )}
              >
                <span
                  className={cn(
                    "h-[3px] w-[3.25rem] origin-left rounded-[1px] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none",
                    isEmphasized ? "bg-foreground/65" : "bg-muted-foreground/25"
                  )}
                  style={markerStyle}
                />
              </Tooltip.Trigger>
              <Tooltip.Content
                className="w-80 rounded-2xl border border-border/70 bg-popover p-0 text-popover-foreground shadow-overlay"
                offset={14}
                placement="right"
              >
                <div className="px-4 py-3.5">
                  <p className="line-clamp-1 text-sm font-semibold">
                    {turn.userInputPreview || turnLabel}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {turn.modelResponsePreview ||
                      t("chat.sessionIndicator.waitingResponse")}
                  </p>
                </div>
              </Tooltip.Content>
            </Tooltip>
          )
        })}
      </div>
    </nav>
  )
}
