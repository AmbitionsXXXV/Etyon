import { useI18n } from "@etyon/i18n/react"
import type { MemoryEntry } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  AlertDialog,
  Button,
  Input,
  Modal,
  Pagination,
  Spinner
} from "@heroui/react"
import { Delete02Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useDebouncedValue } from "@tanstack/react-pacer"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query"
import type { ChangeEventHandler } from "react"
import { useCallback, useEffect, useState } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

interface MemoryManagerModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

const MEMORY_MANAGER_PAGE_SIZE = 8
const MEMORY_SEARCH_DEBOUNCE_WAIT_MS = 200
const EMPTY_ENTRIES: MemoryEntry[] = []

const formatMemoryEntryDate = (value: string): string =>
  new Date(value).toLocaleString()

const getMemoryEntryTitle = (entry: MemoryEntry): string =>
  entry.projectPath ?? entry.sourceId

const MemoryMetaChip = ({ label, value }: { label: string; value: string }) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
    <span className="font-medium text-foreground/70">{label}</span>
    <span>{value}</span>
  </span>
)

const MemoryManagerRow = ({
  entry,
  isExpanded,
  onRequestDelete,
  onToggle
}: {
  entry: MemoryEntry
  isExpanded: boolean
  onRequestDelete: (entry: MemoryEntry) => void
  onToggle: (id: string) => void
}) => {
  const { t } = useI18n()

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <button
          className="min-w-0 flex-1 space-y-1 text-left"
          onClick={() => onToggle(entry.id)}
          type="button"
        >
          <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
            <span className="min-w-0 truncate">
              {getMemoryEntryTitle(entry)}
            </span>
            <span className="shrink-0">
              {t("settings.memory.manager.updatedAt", {
                date: formatMemoryEntryDate(entry.updatedAt)
              })}
            </span>
          </div>
          <p
            className={cn(
              "text-xs leading-5",
              isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
            )}
          >
            {entry.content}
          </p>
        </button>
        <Button
          aria-label={t("settings.memory.manager.delete.trigger")}
          onPress={() => onRequestDelete(entry)}
          size="sm"
          variant="tertiary"
        >
          <HugeiconsIcon
            aria-hidden
            icon={Delete02Icon}
            size={15}
            strokeWidth={2}
          />
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-wrap gap-1.5">
          <MemoryMetaChip
            label={t("settings.memory.manager.meta.kind")}
            value={entry.kind}
          />
          <MemoryMetaChip
            label={t("settings.memory.manager.meta.scope")}
            value={entry.scope}
          />
          <MemoryMetaChip
            label={t("settings.memory.manager.meta.source")}
            value={entry.source}
          />
        </div>
      )}
    </div>
  )
}

const MemoryManagerList = ({
  entries,
  expandedEntryId,
  isLoading,
  isSearching,
  onRequestDelete,
  onToggleExpand
}: {
  entries: MemoryEntry[]
  expandedEntryId: null | string
  isLoading: boolean
  isSearching: boolean
  onRequestDelete: (entry: MemoryEntry) => void
  onToggleExpand: (id: string) => void
}) => {
  const { t } = useI18n()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
        {isSearching
          ? t("settings.memory.manager.emptySearch")
          : t("settings.memory.manager.empty")}
      </p>
    )
  }

  return (
    <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
      {entries.map((entry) => (
        <MemoryManagerRow
          entry={entry}
          isExpanded={expandedEntryId === entry.id}
          key={entry.id}
          onRequestDelete={onRequestDelete}
          onToggle={onToggleExpand}
        />
      ))}
    </div>
  )
}

export const MemoryManagerModal = ({
  isOpen,
  onOpenChange
}: MemoryManagerModalProps) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState("")
  const [page, setPage] = useState(0)
  const [expandedEntryId, setExpandedEntryId] = useState<null | string>(null)
  const [entryPendingDeletion, setEntryPendingDeletion] =
    useState<MemoryEntry | null>(null)

  const [debouncedSearch] = useDebouncedValue(searchInput, {
    key: "memory-manager-search",
    leading: false,
    trailing: true,
    wait: MEMORY_SEARCH_DEBOUNCE_WAIT_MS
  })
  const trimmedSearch = debouncedSearch.trim()

  const listQuery = useQuery(
    orpc.memory.list.queryOptions({
      enabled: isOpen,
      input: {
        limit: MEMORY_MANAGER_PAGE_SIZE,
        offset: page * MEMORY_MANAGER_PAGE_SIZE,
        query: trimmedSearch || undefined
      },
      placeholderData: keepPreviousData
    })
  )

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpcClient.memory.delete({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.memory.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.memory.stats.key() })
      setEntryPendingDeletion(null)
    }
  })

  const entries = listQuery.data?.entries ?? EMPTY_ENTRIES
  const total = listQuery.data?.total ?? 0

  useEffect(() => {
    if (isOpen) {
      setSearchInput("")
      setPage(0)
      setExpandedEntryId(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (listQuery.isSuccess && page > 0 && entries.length === 0) {
      setPage((prev) => Math.max(0, prev - 1))
    }
  }, [entries.length, listQuery.isSuccess, page])

  const handleSearchChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      setSearchInput(event.target.value)
      setPage(0)
    },
    []
  )

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedEntryId((prev) => (prev === id ? null : id))
  }, [])

  const handleRequestDelete = useCallback((entry: MemoryEntry) => {
    setEntryPendingDeletion(entry)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (entryPendingDeletion) {
      deleteMutation.mutate(entryPendingDeletion.id)
    }
  }, [deleteMutation, entryPendingDeletion])

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !deleteMutation.isPending) {
        setEntryPendingDeletion(null)
      }
    },
    [deleteMutation.isPending]
  )

  const handlePreviousPage = useCallback(
    () => setPage((prev) => Math.max(0, prev - 1)),
    []
  )
  const handleNextPage = useCallback(() => setPage((prev) => prev + 1), [])

  const startItem = total === 0 ? 0 : page * MEMORY_MANAGER_PAGE_SIZE + 1
  const endItem = Math.min((page + 1) * MEMORY_MANAGER_PAGE_SIZE, total)
  const hasPreviousPage = page > 0
  const hasNextPage = endItem < total

  return (
    <>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[720px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {t("settings.memory.manager.title")}
              </Modal.Heading>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("settings.memory.manager.description")}
              </p>
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <div className="relative max-w-full min-w-0">
                <HugeiconsIcon
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  icon={Search01Icon}
                  strokeWidth={2}
                />
                <Input
                  className="h-9 w-full min-w-0 rounded-lg pl-8"
                  onChange={handleSearchChange}
                  placeholder={t("settings.memory.manager.searchPlaceholder")}
                  value={searchInput}
                />
              </div>

              <MemoryManagerList
                entries={entries}
                expandedEntryId={expandedEntryId}
                isLoading={listQuery.isLoading}
                isSearching={trimmedSearch.length > 0}
                onRequestDelete={handleRequestDelete}
                onToggleExpand={handleToggleExpand}
              />

              {total > 0 && (
                <Pagination className="w-full">
                  <Pagination.Summary>
                    {t("settings.memory.manager.summary", {
                      end: endItem,
                      start: startItem,
                      total
                    })}
                  </Pagination.Summary>
                  <Pagination.Content>
                    <Pagination.Item>
                      <Pagination.Previous
                        isDisabled={!hasPreviousPage}
                        onPress={handlePreviousPage}
                      >
                        <Pagination.PreviousIcon />
                        <span>{t("settings.memory.manager.previous")}</span>
                      </Pagination.Previous>
                    </Pagination.Item>
                    <Pagination.Item>
                      <Pagination.Next
                        isDisabled={!hasNextPage}
                        onPress={handleNextPage}
                      >
                        <span>{t("settings.memory.manager.next")}</span>
                        <Pagination.NextIcon />
                      </Pagination.Next>
                    </Pagination.Item>
                  </Pagination.Content>
                </Pagination>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop
        isOpen={entryPendingDeletion !== null}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[460px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                {t("settings.memory.manager.delete.title")}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm leading-5 text-muted-foreground">
                {t("settings.memory.manager.delete.description")}
              </p>
              {entryPendingDeletion && (
                <div className="space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2">
                  <div className="text-[0.6875rem] font-medium text-muted-foreground">
                    {t("settings.memory.manager.delete.previewLabel")}
                  </div>
                  <p className="max-h-32 overflow-y-auto text-xs leading-5 whitespace-pre-wrap">
                    {entryPendingDeletion.content}
                  </p>
                </div>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={deleteMutation.isPending}
                slot="close"
                variant="tertiary"
              >
                {t("settings.memory.manager.cancel")}
              </Button>
              <Button
                isPending={deleteMutation.isPending}
                onPress={handleConfirmDelete}
                variant="danger"
              >
                {t("settings.memory.manager.delete.confirm")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
