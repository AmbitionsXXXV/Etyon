import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  PauseIcon,
  PlayIcon,
  ScissorIcon,
  Video01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"

import {
  formatEditTime,
  getCutLengthMs,
  getCutStartMs,
  getTotalLengthMs,
  locateTimelineMs,
  moveClip,
  removeClip,
  splitClip,
  trimClip
} from "@/renderer/lib/video-editor/edit-list"
import type { EditClip } from "@/renderer/lib/video-editor/edit-list"
import {
  updateEditList,
  useEditList
} from "@/renderer/lib/video-editor/editor-store"
import { buildMediaUrl } from "@/shared/chat/media-url"

const MS_PER_SECOND = 1000
// How close to a cut's end playback hops to the next cut; timeupdate only
// fires every ~250 ms, so waiting for the exact end would overshoot the cut.
const CUT_END_TOLERANCE_MS = 40

// Reads a clip's length from its file once, for clips added before their
// metadata was known.
const ClipDurationProbe = ({
  clip,
  sessionId
}: {
  clip: EditClip
  sessionId: string
}) => (
  <video
    aria-hidden="true"
    className="hidden"
    muted
    onLoadedMetadata={(event) => {
      const durationMs = Math.round(
        event.currentTarget.duration * MS_PER_SECOND
      )

      updateEditList(sessionId, (list) =>
        list.map((candidate) =>
          candidate.id === clip.id
            ? { ...candidate, durationMs, outMs: candidate.outMs || durationMs }
            : candidate
        )
      )
    }}
    preload="metadata"
    src={buildMediaUrl({ path: clip.path, sessionId })}
  />
)

const SecondsField = ({
  label,
  onChange,
  valueMs
}: {
  label: string
  onChange: (ms: number) => void
  valueMs: number
}) => (
  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
    {label}
    <input
      className="h-8 rounded-lg border border-border/70 bg-background px-2 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      min={0}
      onChange={(event) => {
        const seconds = Number(event.currentTarget.value)

        if (Number.isFinite(seconds)) {
          onChange(Math.round(seconds * MS_PER_SECOND))
        }
      }}
      step={0.1}
      type="number"
      value={(valueMs / MS_PER_SECOND).toFixed(1)}
    />
  </label>
)

/**
 * The project panel's video editor: the session's cuts as a timeline, played
 * back to back in one video element, with trim, split, reorder, and remove.
 * Edits only change the list of cuts; the original files are never touched.
 */
export const VideoEditorPanel = ({ sessionId }: { sessionId: string }) => {
  const { t } = useI18n()
  const list = useEditList(sessionId)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Where to seek once the active clip's file has loaded.
  const pendingSeekMsRef = useRef<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [timelineMs, setTimelineMs] = useState(0)
  const totalMs = getTotalLengthMs(list)
  const activeCut = list[activeIndex]
  const selectedCut =
    list.find((clip) => clip.id === selectedId) ?? activeCut ?? null
  const unresolved = list.filter((clip) => clip.durationMs === 0)

  // Keep the active index valid as cuts are removed or reordered.
  useEffect(() => {
    if (activeIndex > 0 && activeIndex >= list.length) {
      setActiveIndex(Math.max(0, list.length - 1))
    }
  }, [activeIndex, list.length])

  const seekTimeline = (nextTimelineMs: number, autoplay: boolean) => {
    const target = locateTimelineMs(list, nextTimelineMs)
    const video = videoRef.current

    if (!(target && video)) {
      return
    }

    setTimelineMs(nextTimelineMs)
    setIsPlaying(autoplay)

    if (target.clipIndex === activeIndex && video.readyState > 0) {
      video.currentTime = target.fileMs / MS_PER_SECOND

      if (autoplay) {
        void video.play()
      } else {
        video.pause()
      }

      return
    }

    pendingSeekMsRef.current = target.fileMs
    setActiveIndex(target.clipIndex)
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current

    if (!(video && activeCut)) {
      return
    }

    video.currentTime =
      (pendingSeekMsRef.current ?? activeCut.inMs) / MS_PER_SECOND
    pendingSeekMsRef.current = null

    if (isPlaying) {
      void video.play()
    }
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current

    if (!(video && activeCut)) {
      return
    }

    const fileMs = video.currentTime * MS_PER_SECOND
    const cutStartMs = getCutStartMs(list, activeIndex)

    if (fileMs < activeCut.outMs - CUT_END_TOLERANCE_MS) {
      setTimelineMs(cutStartMs + Math.max(0, fileMs - activeCut.inMs))
      return
    }

    const next = list[activeIndex + 1]

    if (next) {
      pendingSeekMsRef.current = next.inMs
      setActiveIndex(activeIndex + 1)
      setTimelineMs(cutStartMs + getCutLengthMs(activeCut))
      return
    }

    video.pause()
    setIsPlaying(false)
    setTimelineMs(totalMs)
  }

  const togglePlay = () => {
    const video = videoRef.current

    if (!video) {
      return
    }

    if (isPlaying) {
      video.pause()
      setIsPlaying(false)
      return
    }

    seekTimeline(timelineMs >= totalMs ? 0 : timelineMs, true)
  }

  const splitAtPlayhead = () => {
    const target = locateTimelineMs(list, timelineMs)
    const cut = target ? list[target.clipIndex] : undefined

    if (target && cut) {
      updateEditList(sessionId, (current) =>
        splitClip(current, cut.id, target.fileMs, crypto.randomUUID())
      )
    }
  }

  if (list.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <HugeiconsIcon
          className="text-muted-foreground"
          icon={Video01Icon}
          size={22}
        />
        <p className="text-sm font-medium text-foreground">
          {t("chat.videoEditor.emptyTitle")}
        </p>
        <p className="max-w-64 text-xs leading-5 text-muted-foreground">
          {t("chat.videoEditor.emptyHint")}
        </p>
      </div>
    )
  }

  const playheadPercent = totalMs > 0 ? (timelineMs / totalMs) * 100 : 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {unresolved.map((clip) => (
        <ClipDurationProbe clip={clip} key={clip.id} sessionId={sessionId} />
      ))}
      <video
        className="aspect-video w-full rounded-xl border border-border/70 bg-black"
        onLoadedMetadata={handleLoadedMetadata}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={handleTimeUpdate}
        ref={videoRef}
        src={
          activeCut
            ? buildMediaUrl({ path: activeCut.path, sessionId })
            : undefined
        }
      >
        <track kind="captions" />
      </video>
      <div className="flex items-center gap-2">
        <Button
          aria-label={
            isPlaying ? t("chat.videoEditor.pause") : t("chat.videoEditor.play")
          }
          isIconOnly
          onPress={togglePlay}
          size="sm"
          variant="secondary"
        >
          <HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} size={16} />
        </Button>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatEditTime(timelineMs)} / {formatEditTime(totalMs)}
        </span>
        <Button
          className="ml-auto"
          isDisabled={totalMs === 0}
          onPress={splitAtPlayhead}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={ScissorIcon} size={14} />
          {t("chat.videoEditor.split")}
        </Button>
      </div>
      <div className="relative">
        <fieldset className="m-0 flex h-12 min-w-0 gap-0.5 border-0 p-0">
          <legend className="sr-only">{t("chat.videoEditor.timeline")}</legend>
          {list.map((clip, index) => {
            const isSelected = clip.id === selectedCut?.id

            return (
              <button
                aria-label={`${clip.title} · ${formatEditTime(getCutLengthMs(clip))}`}
                aria-pressed={isSelected}
                className={cn(
                  "min-w-6 truncate rounded-md px-2 text-left text-[0.6875rem] font-medium",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
                key={clip.id}
                onClick={() => {
                  setSelectedId(clip.id)
                  seekTimeline(getCutStartMs(list, index), false)
                }}
                style={{ flex: `${Math.max(getCutLengthMs(clip), 1)} 1 0` }}
                type="button"
              >
                {clip.title}
              </button>
            )
          })}
        </fieldset>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 rounded-full bg-danger"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>
      {selectedCut ? (
        <section
          aria-label={selectedCut.title}
          className="flex flex-col gap-3 rounded-xl border border-border/70 p-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {selectedCut.title}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatEditTime(getCutLengthMs(selectedCut))}
            </span>
          </div>
          <div className="flex gap-2">
            <SecondsField
              label={t("chat.videoEditor.start")}
              onChange={(inMs) =>
                updateEditList(sessionId, (current) =>
                  trimClip(current, selectedCut.id, { inMs })
                )
              }
              valueMs={selectedCut.inMs}
            />
            <SecondsField
              label={t("chat.videoEditor.end")}
              onChange={(outMs) =>
                updateEditList(sessionId, (current) =>
                  trimClip(current, selectedCut.id, { outMs })
                )
              }
              valueMs={selectedCut.outMs}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              aria-label={t("chat.videoEditor.moveEarlier")}
              isIconOnly
              onPress={() =>
                updateEditList(sessionId, (current) =>
                  moveClip(current, selectedCut.id, -1)
                )
              }
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </Button>
            <Button
              aria-label={t("chat.videoEditor.moveLater")}
              isIconOnly
              onPress={() =>
                updateEditList(sessionId, (current) =>
                  moveClip(current, selectedCut.id, 1)
                )
              }
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </Button>
            <Button
              className="ml-auto text-danger"
              onPress={() => {
                updateEditList(sessionId, (current) =>
                  removeClip(current, selectedCut.id)
                )
                setSelectedId(null)
              }}
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              {t("chat.videoEditor.remove")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
