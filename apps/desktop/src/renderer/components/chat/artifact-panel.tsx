import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type { ArtifactReadErrorReason } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Spinner } from "@heroui/react"
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  BrowserIcon,
  Cancel01Icon,
  EyeIcon,
  SourceCodeIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, useSyncExternalStore } from "react"
import { Streamdown } from "streamdown"

import { ProjectFileCodeViewer } from "@/renderer/components/chat/project-file-code-viewer"
import {
  ARTIFACT_IFRAME_SANDBOX,
  buildArtifactSrcDoc,
  deriveArtifactPanelView,
  getRootArtifactTheme,
  subscribeToRootThemeChange
} from "@/renderer/lib/chat/artifact-panel"
import type {
  ArtifactPanelNotice,
  ChatArtifactRef
} from "@/renderer/lib/chat/artifact-panel"
import { orpc } from "@/renderer/lib/rpc"

type ArtifactViewMode = "code" | "preview"

const ARTIFACT_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-sm leading-6 text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_li]:my-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
)

const ArtifactViewModeButton = ({
  icon,
  isSelected,
  label,
  onPress
}: {
  icon: typeof EyeIcon
  isSelected: boolean
  label: string
  onPress: () => void
}) => (
  <Button
    aria-label={label}
    aria-pressed={isSelected}
    isIconOnly
    onPress={onPress}
    size="sm"
    type="button"
    variant={isSelected ? "secondary" : "ghost"}
  >
    <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
  </Button>
)

const ARTIFACT_NOTICE_LABEL_KEY: Record<ArtifactPanelNotice, TranslationKey> = {
  "restored-from-snapshot": "chat.artifact.restoredNotice",
  "workspace-recreated": "chat.artifact.recreatedWorkspaceNotice"
}

const ARTIFACT_ERROR_LABEL_KEY: Record<
  "transport" | ArtifactReadErrorReason,
  TranslationKey
> = {
  "binary-file": "chat.artifact.readError",
  "file-missing": "chat.artifact.missingError",
  "io-error": "chat.artifact.readError",
  "not-file": "chat.artifact.readError",
  "outside-project": "chat.artifact.outsideProjectError",
  "too-large": "chat.artifact.tooLargeError",
  transport: "chat.artifact.readError"
}

const ArtifactNotice = ({ notice }: { notice: ArtifactPanelNotice }) => {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
      <HugeiconsIcon className="shrink-0" icon={Alert02Icon} size={13} />
      <span className="min-w-0">{t(ARTIFACT_NOTICE_LABEL_KEY[notice])}</span>
    </div>
  )
}

const ArtifactErrorBody = ({
  onRetry,
  reason,
  workspaceRecreated
}: {
  onRetry: () => void
  reason: "transport" | ArtifactReadErrorReason
  workspaceRecreated: boolean
}) => {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-36 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="space-y-1">
        <p className="text-xs leading-5 text-danger">
          {t(ARTIFACT_ERROR_LABEL_KEY[reason])}
        </p>
        {reason === "file-missing" ? (
          <p className="text-[11px] leading-5 text-muted-foreground">
            {t("chat.artifact.missingErrorHint")}
          </p>
        ) : null}
        {reason === "file-missing" && workspaceRecreated ? (
          <p className="text-[11px] leading-5 text-muted-foreground">
            {t("chat.artifact.recreatedWorkspaceNotice")}
          </p>
        ) : null}
      </div>
      <Button onPress={onRetry} size="sm" type="button" variant="ghost">
        {t("chat.artifact.retry")}
      </Button>
    </div>
  )
}

export const ArtifactPanel = ({
  artifact,
  onClose,
  sessionId
}: {
  artifact: ChatArtifactRef
  onClose: () => void
  sessionId: string
}) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ArtifactViewMode>("preview")
  const theme = useSyncExternalStore(
    subscribeToRootThemeChange,
    getRootArtifactTheme
  )
  const fileQueryOptions = useMemo(
    () =>
      orpc.artifacts.read.queryOptions({
        input: {
          filePath: artifact.path,
          sessionId,
          ...(artifact.toolCallId ? { toolCallId: artifact.toolCallId } : {})
        }
      }),
    [artifact.path, artifact.toolCallId, sessionId]
  )
  // The agent republishes to the same path, so the panel is remounted per
  // publish (keyed by toolCallId) and always refetches the current file. The
  // endpoint runs its whole recovery ladder on every fetch, so a rebuilt
  // workspace or snapshot-restored file arrives for free in the response.
  const fileQuery = useQuery({ ...fileQueryOptions, refetchOnMount: "always" })
  const view = deriveArtifactPanelView({
    data: fileQuery.data,
    isError: fileQuery.isError,
    isLoading: fileQuery.isLoading
  })
  const readyContent = view.kind === "ready" ? view.content : null
  const invalidateFileQuery = () => {
    void queryClient.invalidateQueries({ queryKey: fileQueryOptions.queryKey })
  }
  const srcDoc = useMemo(
    () =>
      artifact.kind === "html" && readyContent !== null
        ? buildArtifactSrcDoc({ html: readyContent, theme })
        : null,
    [artifact.kind, readyContent, theme]
  )

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-contain border border-border bg-card shadow-sm">
      <div className="title-bar-drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={BrowserIcon}
          size={16}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {artifact.title}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {artifact.path}
          </p>
        </div>
        <div className="title-bar-no-drag flex shrink-0 items-center gap-1">
          <ArtifactViewModeButton
            icon={EyeIcon}
            isSelected={viewMode === "preview"}
            label={t("chat.artifact.previewView")}
            onPress={() => setViewMode("preview")}
          />
          <ArtifactViewModeButton
            icon={SourceCodeIcon}
            isSelected={viewMode === "code"}
            label={t("chat.artifact.codeView")}
            onPress={() => setViewMode("code")}
          />
          <Button
            aria-label={t("chat.artifact.refresh")}
            isIconOnly
            onPress={invalidateFileQuery}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              size={15}
              strokeWidth={2}
            />
          </Button>
          <Button
            aria-label={t("chat.artifact.close")}
            isIconOnly
            onPress={onClose}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view.kind === "loading" ? (
          <div className="flex h-full min-h-36 items-center justify-center">
            <Spinner size="sm" />
          </div>
        ) : null}
        {view.kind === "error" ? (
          <ArtifactErrorBody
            onRetry={invalidateFileQuery}
            reason={view.reason}
            workspaceRecreated={view.workspaceRecreated}
          />
        ) : null}
        {view.kind === "ready" ? (
          <div className="flex h-full min-h-0 flex-col">
            {view.notice ? <ArtifactNotice notice={view.notice} /> : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              {viewMode === "code" ? (
                <ProjectFileCodeViewer
                  content={view.content}
                  language={view.language}
                  relativePath={artifact.path}
                />
              ) : null}
              {viewMode === "preview" && srcDoc ? (
                <iframe
                  className="h-full w-full border-0"
                  sandbox={ARTIFACT_IFRAME_SANDBOX}
                  srcDoc={srcDoc}
                  title={artifact.title}
                />
              ) : null}
              {viewMode === "preview" && !srcDoc ? (
                <div className="h-full min-h-0 overflow-y-auto overscroll-contain p-4">
                  <Streamdown className={ARTIFACT_MARKDOWN_CLASS_NAME} skipHtml>
                    {view.content}
                  </Streamdown>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
