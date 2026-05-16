import { useI18n } from "@etyon/i18n/react"
import type { MemoryEntry, MemorySettings } from "@etyon/rpc"
import { Input } from "@etyon/ui/components/input"
import { Switch } from "@etyon/ui/components/switch"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback } from "react"

import { orpc } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface MemoryTabProps {
  memory: MemorySettings
  onChange: (memory: MemorySettings) => void
}

interface MemorySwitchRowProps {
  checked: boolean
  description: string
  label: string
  onChange: (checked: boolean) => void
}

const MEMORY_CONTEXT_ENTRIES_MAX = 20
const MEMORY_CONTEXT_ENTRIES_MIN = 1

const clampMemoryContextEntries = (value: number): number =>
  Math.min(
    MEMORY_CONTEXT_ENTRIES_MAX,
    Math.max(MEMORY_CONTEXT_ENTRIES_MIN, value)
  )

const formatMemoryDate = (value: string | null): string => {
  if (!value) {
    return "-"
  }

  return new Date(value).toLocaleString()
}

const getMemoryEntryTitle = (entry: MemoryEntry): string =>
  entry.projectPath ?? entry.sourceId

const MemorySwitchRow = ({
  checked,
  description,
  label,
  onChange
}: MemorySwitchRowProps) => (
  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3">
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>

    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
)

const MemoryEntryPreview = ({ entry }: { entry: MemoryEntry }) => (
  <div className="space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2">
    <div className="flex items-center justify-between gap-3 text-[0.6875rem] text-muted-foreground">
      <span className="min-w-0 truncate">{getMemoryEntryTitle(entry)}</span>
      <span className="shrink-0">{entry.updatedAt.slice(0, 10)}</span>
    </div>
    <p className="line-clamp-2 text-xs leading-5">{entry.content}</p>
  </div>
)

export const MemoryTab = ({ memory, onChange }: MemoryTabProps) => {
  const { t } = useI18n()
  const statsQuery = useQuery(orpc.memory.stats.queryOptions({}))
  const entriesQuery = useQuery(
    orpc.memory.list.queryOptions({
      input: {
        limit: 5
      }
    })
  )

  const updateMemory = useCallback(
    (patch: Partial<MemorySettings>) => {
      onChange({ ...memory, ...patch })
    },
    [memory, onChange]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateMemory({ enabled: checked }),
    [updateMemory]
  )

  const handleIncludeChatbotChange = useCallback(
    (checked: boolean) => updateMemory({ includeChatbot: checked }),
    [updateMemory]
  )

  const handleMaxContextEntriesChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(
    (event) => {
      const parsed = Number.parseInt(event.target.value, 10)

      if (!Number.isNaN(parsed)) {
        updateMemory({
          maxContextEntries: clampMemoryContextEntries(parsed)
        })
      }
    },
    [updateMemory]
  )

  const handleShareAcrossProjectsChange = useCallback(
    (checked: boolean) => updateMemory({ shareAcrossProjects: checked }),
    [updateMemory]
  )

  const latestEntries = entriesQuery.data?.entries ?? []
  const totalEntries = statsQuery.data?.totalEntries ?? 0

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.memory.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.memory.description")}
            </p>
          </div>

          <Switch
            checked={memory.enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>

        <div className="grid gap-3">
          <MemorySwitchRow
            checked={memory.shareAcrossProjects}
            description={t("settings.memory.shareAcrossProjects.description")}
            label={t("settings.memory.shareAcrossProjects.label")}
            onChange={handleShareAcrossProjectsChange}
          />
          <MemorySwitchRow
            checked={memory.includeChatbot}
            description={t("settings.memory.includeChatbot.description")}
            label={t("settings.memory.includeChatbot.label")}
            onChange={handleIncludeChatbotChange}
          />
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.memory.retrieval.title")}
        </h2>

        <div className="max-w-40 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.memory.retrieval.maxContextEntries.label")}
          </label>
          <Input
            max={MEMORY_CONTEXT_ENTRIES_MAX}
            min={MEMORY_CONTEXT_ENTRIES_MIN}
            onChange={handleMaxContextEntriesChange}
            type="number"
            value={String(memory.maxContextEntries)}
          />
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.memory.retrieval.maxContextEntries.description")}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.35)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.memory.status.title")}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.memory.status.totalEntries")}
            </div>
            <div className="mt-1 text-lg font-semibold">{totalEntries}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="text-[0.6875rem] text-muted-foreground">
              {t("settings.memory.status.lastUpdated")}
            </div>
            <div className="mt-1 truncate text-sm font-medium">
              {formatMemoryDate(statsQuery.data?.lastUpdatedAt ?? null)}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("settings.memory.status.recent")}
          </h3>
          {latestEntries.length > 0 ? (
            <div className="space-y-2">
              {latestEntries.map((entry) => (
                <MemoryEntryPreview entry={entry} key={entry.id} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {t("settings.memory.status.empty")}
            </p>
          )}
        </div>
      </motion.section>
    </div>
  )
}
