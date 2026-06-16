import { useI18n } from "@etyon/i18n/react"
import type {
  MemoryEmbeddingModel,
  MemoryEntry,
  MemorySettings
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  Button,
  Header,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Slider,
  Switch
} from "@heroui/react"
import type { Key } from "@heroui/react"
import { Download01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback, useMemo, useState } from "react"

import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_EMBEDDING_MODEL_LABEL
} from "@/renderer/lib/memory/embedding-model-catalog"
import {
  MEMORY_MAX_RETRIEVED_MEMORIES_MAX,
  MEMORY_MAX_RETRIEVED_MEMORIES_MIN,
  clampMaxRetrievedMemories,
  formatSimilarityThreshold,
  percentToSimilarityThreshold,
  similarityThresholdToPercent
} from "@/renderer/lib/memory/memory-settings"
import {
  MEMORY_TOOL_MODEL_AUTO_VALUE,
  getMemoryToolModelSelectedValue,
  normalizeMemoryToolModelValue
} from "@/renderer/lib/memory/memory-tool-model-options"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface MemoryTabProps {
  memory: MemorySettings
  modelGroups: ChatModelGroup[]
  onChange: (memory: MemorySettings) => void
}

interface MemorySwitchRowProps {
  checked: boolean
  description: string
  isDisabled?: boolean
  isIndented?: boolean
  label: string
  onChange: (checked: boolean) => void
}

const EMBEDDING_DEFAULT_OPTION_KEY = "__default_embedding_model__"
const MEMORY_FIELD_CLASS_NAME =
  "border-border/80 bg-background/80 shadow-sm hover:bg-background focus-visible:border-primary/60"
const EMPTY_EMBEDDING_MODELS: MemoryEmbeddingModel[] = []

const formatMemoryDate = (value: null | string): string => {
  if (!value) {
    return "-"
  }

  return new Date(value).toLocaleString()
}

const getMemoryEntryTitle = (entry: MemoryEntry): string =>
  entry.projectPath ?? entry.sourceId

const getEmbeddingModelLabel = (
  models: MemoryEmbeddingModel[],
  value: string
): string => {
  if (value === DEFAULT_EMBEDDING_MODEL_ID) {
    return DEFAULT_EMBEDDING_MODEL_LABEL
  }

  return models.find((option) => option.id === value)?.label ?? value
}

const MemorySwitch = ({
  checked,
  isDisabled = false,
  label,
  onChange
}: {
  checked: boolean
  isDisabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch
    aria-label={label}
    isDisabled={isDisabled}
    isSelected={checked}
    onChange={onChange}
  >
    <Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Content>
  </Switch>
)

const MemorySwitchRow = ({
  checked,
  description,
  isDisabled = false,
  isIndented = false,
  label,
  onChange
}: MemorySwitchRowProps) => (
  <div
    className={cn(
      "flex items-start justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3",
      isDisabled && "opacity-60",
      isIndented && "ml-8"
    )}
  >
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>

    <MemorySwitch
      checked={checked}
      isDisabled={isDisabled}
      label={label}
      onChange={onChange}
    />
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

const MemoryToolModelSelect = ({
  isDisabled,
  modelGroups,
  onChange,
  value
}: {
  isDisabled: boolean
  modelGroups: ChatModelGroup[]
  onChange: (value: string) => void
  value: string
}) => {
  const { t } = useI18n()
  const allOptions = useMemo(
    () => modelGroups.flatMap((group) => group.options),
    [modelGroups]
  )
  const selectedValue = getMemoryToolModelSelectedValue(value)
  const isConcreteModel = Boolean(
    value && value !== MEMORY_TOOL_MODEL_AUTO_VALUE
  )
  const selectedOption = allOptions.find((option) => option.value === value)
  const shouldShowUnavailableModel = isConcreteModel && !selectedOption

  const handleChange = useCallback(
    (nextValue: Key | Key[] | null) => {
      if (Array.isArray(nextValue)) {
        return
      }

      onChange(normalizeMemoryToolModelValue(nextValue))
    },
    [onChange]
  )

  return (
    <Select
      className="mx-0.5 max-w-xl"
      fullWidth
      isDisabled={isDisabled}
      onChange={handleChange}
      value={selectedValue}
      variant="primary"
    >
      <Label className="text-xs font-medium text-muted-foreground">
        {t("settings.memory.toolModel.label")}
      </Label>
      <Select.Trigger className={MEMORY_FIELD_CLASS_NAME}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="border border-border/80 bg-popover shadow-overlay">
        <ListBox>
          <ListBox.Item
            id={MEMORY_TOOL_MODEL_AUTO_VALUE}
            textValue={t("settings.memory.toolModel.auto")}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {t("settings.memory.toolModel.auto")}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {t("settings.memory.toolModel.autoDescription")}
              </div>
            </div>
            <ListBox.ItemIndicator />
          </ListBox.Item>

          {shouldShowUnavailableModel && (
            <ListBox.Item id={value} textValue={value}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{value}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t("settings.memory.toolModel.unavailable")}
                </div>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}

          {modelGroups.map((group) => (
            <ListBox.Section key={group.providerId}>
              <Header>{group.providerName}</Header>
              {group.options.map((option) => (
                <ListBox.Item
                  id={option.value}
                  key={option.value}
                  textValue={option.label}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {option.label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {option.summary || option.id}
                    </div>
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox.Section>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

const EmbeddingSearchInput = ({
  onChange,
  placeholder,
  value
}: {
  onChange: ChangeEventHandler<HTMLInputElement>
  placeholder: string
  value: string
}) => (
  <div className="relative max-w-full min-w-0">
    <HugeiconsIcon
      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      icon={Search01Icon}
      strokeWidth={2}
    />
    <Input
      className="h-9 w-full min-w-0 rounded-lg pl-8"
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
  </div>
)

const EmbeddingModelPicker = ({
  isDisabled,
  onChange,
  value
}: {
  isDisabled: boolean
  onChange: (value: string) => void
  value: string
}) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const embeddingModelsQueryOptions =
    orpc.memory.embeddingModels.list.queryOptions({})
  const embeddingModelsQuery = useQuery(embeddingModelsQueryOptions)
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const embeddingModels =
    embeddingModelsQuery.data?.models ?? EMPTY_EMBEDDING_MODELS
  const localEmbeddingModels = useMemo(
    () => embeddingModels.filter((model) => model.source === "local"),
    [embeddingModels]
  )

  const filteredLocalModels = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()

    if (!normalizedSearchTerm) {
      return localEmbeddingModels
    }

    return localEmbeddingModels.filter((option) =>
      option.label.toLowerCase().includes(normalizedSearchTerm)
    )
  }, [localEmbeddingModels, searchTerm])

  const selectedKey = value || EMBEDDING_DEFAULT_OPTION_KEY
  const selectedLabel = getEmbeddingModelLabel(embeddingModels, value)
  const selectedModel = embeddingModels.find((model) => model.id === value)
  const installMutation = useMutation({
    mutationFn: (modelId: string) =>
      rpcClient.memory.embeddingModels.install({ modelId }),
    onSuccess: (data, modelId) => {
      queryClient.setQueryData(embeddingModelsQueryOptions.queryKey, data)
      onChange(modelId)
      setIsOpen(false)
    }
  })
  const installingModelId = installMutation.variables

  const handleSearchChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      setSearchTerm(event.target.value)
    },
    []
  )

  const handleModelAction = useCallback(
    (key: Key) => {
      const modelId = String(key)

      const nextValue =
        key === EMBEDDING_DEFAULT_OPTION_KEY
          ? DEFAULT_EMBEDDING_MODEL_ID
          : modelId

      if (key !== EMBEDDING_DEFAULT_OPTION_KEY) {
        const model = embeddingModels.find((item) => item.id === modelId)

        if (model?.source === "local" && model.status === "missing") {
          if (!installMutation.isPending) {
            installMutation.mutate(model.id)
          }
          return
        }

        if (model?.source === "local" && model.status === "downloading") {
          return
        }
      }

      onChange(nextValue)
      setIsOpen(false)
    },
    [embeddingModels, installMutation, onChange]
  )

  const handleOpen = useCallback(() => setIsOpen(true), [])
  const handleInstallModel = useCallback(
    (modelId: string) => {
      if (installMutation.isPending) {
        return
      }

      installMutation.mutate(modelId)
    },
    [installMutation]
  )
  const getLocalModelStatusLabel = useCallback(
    (model: MemoryEmbeddingModel): string => {
      if (model.status === "available") {
        return t("settings.memory.embedding.installed")
      }

      if (model.status === "downloading" || installingModelId === model.id) {
        return t("settings.memory.embedding.installing")
      }

      return t("settings.memory.embedding.missing")
    },
    [installingModelId, t]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-sm font-medium">{selectedLabel}</div>
          <p className="text-xs leading-5 text-muted-foreground">
            {selectedModel?.source === "local"
              ? t("settings.memory.embedding.localDescription")
              : t("settings.memory.embedding.defaultDescription")}
          </p>
        </div>
        <Button
          isDisabled={isDisabled}
          onPress={handleOpen}
          size="sm"
          variant="secondary"
        >
          {t("settings.memory.embedding.change")}
        </Button>
      </div>

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[560px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {t("settings.memory.embedding.title")}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <EmbeddingSearchInput
                onChange={handleSearchChange}
                placeholder={t("settings.memory.embedding.searchPlaceholder")}
                value={searchTerm}
              />

              <ListBox
                aria-label={t("settings.memory.embedding.title")}
                className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background/60 p-1"
                onAction={handleModelAction}
                selectedKeys={new Set([selectedKey])}
                selectionMode="single"
              >
                <ListBox.Item
                  id={EMBEDDING_DEFAULT_OPTION_KEY}
                  textValue={DEFAULT_EMBEDDING_MODEL_LABEL}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {DEFAULT_EMBEDDING_MODEL_LABEL}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t("settings.memory.embedding.defaultLabel")}
                    </div>
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>

                <ListBox.Section>
                  <Header className="text-foreground">
                    {t("settings.memory.embedding.localModels")}
                  </Header>
                  {filteredLocalModels.map((option) => (
                    <ListBox.Item
                      id={option.id}
                      key={option.id}
                      textValue={option.label}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {option.label}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {getLocalModelStatusLabel(option)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <span>{option.downloadSize}</span>
                          {option.status === "missing" && (
                            <Button
                              isDisabled={installMutation.isPending}
                              isPending={installingModelId === option.id}
                              onPress={() => handleInstallModel(option.id)}
                              size="sm"
                              variant="secondary"
                            >
                              <HugeiconsIcon
                                aria-hidden
                                icon={Download01Icon}
                                size={14}
                                strokeWidth={2}
                              />
                              {t("settings.memory.embedding.install")}
                            </Button>
                          )}
                        </div>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox.Section>
              </ListBox>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  )
}

export const MemoryTab = ({
  memory,
  modelGroups,
  onChange
}: MemoryTabProps) => {
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

  const handleAutoRetrieveChange = useCallback(
    (checked: boolean) => updateMemory({ autoRetrieve: checked }),
    [updateMemory]
  )

  const handleAutoSummarizeChange = useCallback(
    (checked: boolean) => updateMemory({ autoSummarize: checked }),
    [updateMemory]
  )

  const handleEmbeddingModelChange = useCallback(
    (embeddingModel: string) => updateMemory({ embeddingModel }),
    [updateMemory]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateMemory({ enabled: checked }),
    [updateMemory]
  )

  const handleIncludeChatbotChange = useCallback(
    (checked: boolean) => updateMemory({ includeChatbot: checked }),
    [updateMemory]
  )

  const handleMaxRetrievedMemoriesChange = useCallback(
    (value: number | number[]) => {
      if (Array.isArray(value)) {
        return
      }

      const nextValue = clampMaxRetrievedMemories(value)

      updateMemory({
        maxContextEntries: nextValue,
        maxRetrievedMemories: nextValue
      })
    },
    [updateMemory]
  )

  const handleMemoryToolModelChange = useCallback(
    (memoryToolModel: string) => updateMemory({ memoryToolModel }),
    [updateMemory]
  )

  const handleQueryRewritingChange = useCallback(
    (checked: boolean) => updateMemory({ queryRewriting: checked }),
    [updateMemory]
  )

  const handleShareAcrossProjectsChange = useCallback(
    (checked: boolean) => updateMemory({ shareAcrossProjects: checked }),
    [updateMemory]
  )

  const handleSimilarityThresholdChange = useCallback(
    (value: number | number[]) => {
      if (Array.isArray(value)) {
        return
      }

      updateMemory({
        similarityThreshold: percentToSimilarityThreshold(value)
      })
    },
    [updateMemory]
  )

  const latestEntries = entriesQuery.data?.entries ?? []
  const similarityThresholdPercent = similarityThresholdToPercent(
    memory.similarityThreshold
  )
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

          <MemorySwitch
            checked={memory.enabled}
            label={t("settings.memory.title")}
            onChange={handleEnabledChange}
          />
        </div>

        <div className="grid gap-3">
          <MemorySwitchRow
            checked={memory.shareAcrossProjects}
            description={t("settings.memory.shareAcrossProjects.description")}
            isDisabled={!memory.enabled}
            label={t("settings.memory.shareAcrossProjects.label")}
            onChange={handleShareAcrossProjectsChange}
          />
          <MemorySwitchRow
            checked={memory.includeChatbot}
            description={t("settings.memory.includeChatbot.description")}
            isDisabled={!memory.enabled}
            label={t("settings.memory.includeChatbot.label")}
            onChange={handleIncludeChatbotChange}
          />
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.memory.summarization.title")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.memory.summarization.description")}
          </p>
        </div>

        <MemorySwitchRow
          checked={memory.autoSummarize}
          description={t(
            "settings.memory.summarization.autoSummarize.description"
          )}
          isDisabled={!memory.enabled}
          label={t("settings.memory.summarization.autoSummarize.label")}
          onChange={handleAutoSummarizeChange}
        />

        <MemoryToolModelSelect
          isDisabled={!memory.enabled}
          modelGroups={modelGroups}
          onChange={handleMemoryToolModelChange}
          value={memory.memoryToolModel}
        />

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.memory.toolModel.description")}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.35)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.memory.retrieval.title")}
        </h2>

        <div className="grid gap-3">
          <MemorySwitchRow
            checked={memory.autoRetrieve}
            description={t(
              "settings.memory.retrieval.autoRetrieve.description"
            )}
            isDisabled={!memory.enabled}
            label={t("settings.memory.retrieval.autoRetrieve.label")}
            onChange={handleAutoRetrieveChange}
          />
          <MemorySwitchRow
            checked={memory.queryRewriting}
            description={t(
              "settings.memory.retrieval.queryRewriting.description"
            )}
            isDisabled={!memory.enabled || !memory.autoRetrieve}
            isIndented
            label={t("settings.memory.retrieval.queryRewriting.label")}
            onChange={handleQueryRewritingChange}
          />
        </div>

        <Slider
          aria-label={t("settings.memory.retrieval.maxRetrievedMemories.label")}
          isDisabled={!memory.enabled || !memory.autoRetrieve}
          maxValue={MEMORY_MAX_RETRIEVED_MEMORIES_MAX}
          minValue={MEMORY_MAX_RETRIEVED_MEMORIES_MIN}
          onChange={handleMaxRetrievedMemoriesChange}
          value={memory.maxRetrievedMemories}
        >
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">
              {t("settings.memory.retrieval.maxRetrievedMemories.label", {
                count: memory.maxRetrievedMemories
              })}
            </Label>
            <Slider.Output className="text-xs font-medium text-muted-foreground" />
          </div>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.memory.retrieval.maxRetrievedMemories.description")}
        </p>

        <Slider
          aria-label={t("settings.memory.retrieval.similarityThreshold.label")}
          isDisabled={!memory.enabled || !memory.autoRetrieve}
          maxValue={100}
          minValue={0}
          onChange={handleSimilarityThresholdChange}
          value={similarityThresholdPercent}
        >
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">
              {t("settings.memory.retrieval.similarityThreshold.label", {
                value: formatSimilarityThreshold(memory.similarityThreshold)
              })}
            </Label>
            <Slider.Output className="text-xs font-medium text-muted-foreground" />
          </div>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {t("settings.memory.retrieval.similarityThreshold.loose")}
          </span>
          <span>
            {t("settings.memory.retrieval.similarityThreshold.strict")}
          </span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.memory.retrieval.similarityThreshold.description")}
        </p>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.45)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.memory.embedding.title")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.memory.embedding.description")}
          </p>
        </div>

        <EmbeddingModelPicker
          isDisabled={!memory.enabled}
          onChange={handleEmbeddingModelChange}
          value={memory.embeddingModel}
        />
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.55)}
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
