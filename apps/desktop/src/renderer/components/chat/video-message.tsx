import { useI18n } from "@etyon/i18n/react"
import { Button } from "@heroui/react"
import {
  ArrowRightDoubleIcon,
  Film01Icon,
  MagicWand01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useRef, useState } from "react"

import { DotMatrixPlaceholder } from "@/renderer/components/chat/dot-matrix-placeholder"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { requestPanelSurface } from "@/renderer/lib/chat/panel-open-request"
import { requestVideoEdit } from "@/renderer/lib/chat/video-edit-request"
import {
  getVideoAspectRatio,
  getVideogenPartState
} from "@/renderer/lib/chat/video-message"
import { addClipToEditor } from "@/renderer/lib/video-editor/editor-store"
import { buildMediaUrl } from "@/shared/chat/media-url"
import type { VideoEditRequest } from "@/shared/chat/video-tools"

const MS_PER_SECOND = 1000

/** Renders a Video skill clip inline in the assistant message. */
export const VideogenMessageVideo = ({
  part,
  sessionId
}: {
  part: ChatToolPart
  sessionId: string
}) => {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [editMode, setEditMode] = useState<VideoEditRequest["mode"] | null>(
    null
  )
  const [instruction, setInstruction] = useState("")
  const [extendSeconds, setExtendSeconds] = useState<4 | 5 | 10>(4)
  const state = getVideogenPartState(part)

  if (!state) {
    return null
  }

  const aspectRatio = getVideoAspectRatio(state.ratio)

  if (state.phase === "error") {
    return (
      <div className="inline-flex max-w-full flex-col gap-0.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <span className="font-medium text-danger">
          {t("chat.videogen.failed")}
        </span>
        {state.errorMessage ? (
          <span className="break-all text-muted-foreground">
            {state.errorMessage}
          </span>
        ) : null}
      </div>
    )
  }

  if (state.phase === "generating") {
    return (
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border/70 bg-muted/40"
        style={{ aspectRatio }}
      >
        <DotMatrixPlaceholder />
        <span className="absolute inset-x-0 bottom-2 text-center font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {t("chat.videogen.generating")}
        </span>
      </div>
    )
  }

  return (
    <figure className="m-0 flex w-full max-w-md flex-col gap-1.5">
      <video
        ref={videoRef}
        aria-label={state.title || t("chat.videogen.label")}
        className="max-h-96 w-full rounded-xl border border-border/70 bg-black"
        controls
        preload="metadata"
        src={buildMediaUrl({ path: state.path, sessionId })}
        style={{ aspectRatio }}
      >
        <track kind="captions" />
      </video>
      <figcaption className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{state.title}</span>
          {state.cost ? (
            <span className="shrink-0 tabular-nums">
              {t("chat.videogen.cost", { cost: state.cost })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            className="h-7 px-2 text-xs"
            onPress={() => setEditMode(editMode === "edit" ? null : "edit")}
            size="sm"
            variant={editMode === "edit" ? "secondary" : "ghost"}
          >
            <HugeiconsIcon icon={MagicWand01Icon} size={14} />
            {t("chat.videogen.edit")}
          </Button>
          <Button
            className="h-7 px-2 text-xs"
            onPress={() => setEditMode(editMode === "extend" ? null : "extend")}
            size="sm"
            variant={editMode === "extend" ? "secondary" : "ghost"}
          >
            <HugeiconsIcon icon={ArrowRightDoubleIcon} size={14} />
            {t("chat.videogen.extend")}
          </Button>
          <Button
            className="ml-auto h-7 px-2 text-xs"
            onPress={() => {
              const seconds = videoRef.current?.duration
              const durationMs =
                seconds && Number.isFinite(seconds)
                  ? Math.round(seconds * MS_PER_SECOND)
                  : undefined

              addClipToEditor(sessionId, {
                ...(durationMs ? { durationMs } : {}),
                path: state.path,
                title: state.title || t("chat.videogen.label")
              })
              requestPanelSurface({ kind: "videoEditor", sessionId })
            }}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={Film01Icon} size={14} />
            {t("chat.videogen.openInEditor")}
          </Button>
        </div>
        {editMode ? (
          <form
            className="flex flex-col gap-2 rounded-xl border border-border/70 p-2.5"
            onSubmit={(event) => {
              event.preventDefault()

              const prompt = instruction.trim()

              if (!prompt) {
                return
              }

              requestVideoEdit({
                edit: {
                  ...(editMode === "extend" ? { duration: extendSeconds } : {}),
                  mode: editMode,
                  sourceTitle: state.title,
                  sourceToolCallId: part.toolCallId
                },
                prompt,
                sessionId
              })
              setInstruction("")
              setEditMode(null)
            }}
          >
            <label className="flex flex-col gap-1 text-[0.6875rem] font-medium">
              {editMode === "edit"
                ? t("chat.videogen.editLabel")
                : t("chat.videogen.extendLabel")}
              <textarea
                className="w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onChange={(event) => setInstruction(event.currentTarget.value)}
                placeholder={
                  editMode === "edit"
                    ? t("chat.videogen.editPlaceholder")
                    : t("chat.videogen.extendPlaceholder")
                }
                rows={2}
                value={instruction}
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {editMode === "extend"
                ? ([4, 5, 10] as const).map((seconds) => (
                    <Button
                      aria-pressed={extendSeconds === seconds}
                      className="h-7 min-w-0 px-2.5 text-xs"
                      key={seconds}
                      onPress={() => setExtendSeconds(seconds)}
                      size="sm"
                      variant={
                        extendSeconds === seconds ? "secondary" : "outline"
                      }
                    >
                      {t("chat.videogen.seconds", { count: seconds })}
                    </Button>
                  ))
                : null}
              <span className="text-[0.6875rem]">
                {t("chat.videogen.editModel")}
              </span>
              <Button
                className="ml-auto"
                isDisabled={!instruction.trim()}
                size="sm"
                type="submit"
                variant="primary"
              >
                {t("chat.videogen.render")}
              </Button>
            </div>
          </form>
        ) : null}
      </figcaption>
    </figure>
  )
}
