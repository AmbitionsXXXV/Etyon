import { useI18n } from "@etyon/i18n/react"
import type { WebToolsSettings } from "@etyon/rpc"
import {
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextField
} from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { updateWebToolsCredentials } from "@/renderer/lib/web-tools/settings"

type FetchResult = Awaited<ReturnType<typeof rpcClient.webTools.fetch>>
type SearchResult = Awaited<ReturnType<typeof rpcClient.webTools.search>>

const SourceButton = ({
  label,
  onError,
  url
}: {
  label: string
  onError: (error: string) => void
  url: string
}) => {
  const { t } = useI18n()
  const open = async (): Promise<void> => {
    try {
      await window.electron.ipcRenderer.invoke("open-external-url", url)
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : t("settings.webTools.openFailed")
      )
    }
  }
  return (
    <Button
      className="h-auto max-w-full justify-start text-left break-all whitespace-normal"
      onPress={open}
      size="sm"
      variant="ghost"
    >
      {label}
    </Button>
  )
}

const WebCredentialsCard = ({
  apiKey,
  busy,
  current,
  error,
  onApiKeyChange,
  onClear,
  onEnabledChange,
  onProviderChange,
  onSave,
  provider
}: {
  apiKey: string
  busy: boolean
  current: WebToolsSettings | undefined
  error: string | undefined | null
  onApiKeyChange: (value: string) => void
  onClear: () => void
  onEnabledChange: (enabled: boolean) => void
  onProviderChange: (provider: WebToolsSettings["searchProvider"]) => void
  onSave: () => void
  provider: WebToolsSettings["searchProvider"]
}) => {
  const { t } = useI18n()
  const hasKey = Boolean(current?.encryptedApiKey || current?.searchApiKey)
  const disabled = !current || busy
  const isChanged =
    provider !== current?.searchProvider || apiKey.trim().length > 0
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("settings.webTools.title")}</Card.Title>
        <Card.Description>
          {t("settings.webTools.description")}
        </Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4">
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Switch
          isDisabled={disabled}
          isSelected={current?.enabled ?? false}
          onChange={onEnabledChange}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label>{t("settings.webTools.enabled")}</Label>
          </Switch.Content>
        </Switch>
        <Select
          isDisabled={disabled}
          onChange={(value) => {
            if (value === "brave" || value === "tavily") {
              onProviderChange(value)
            }
          }}
          value={provider}
        >
          <Label>{t("settings.webTools.provider")}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="brave" textValue="Brave Search">
                Brave Search
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="tavily" textValue="Tavily">
                Tavily
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField
          isDisabled={disabled}
          onChange={onApiKeyChange}
          value={apiKey}
        >
          <Label>{t("settings.webTools.apiKey")}</Label>
          <Input
            autoComplete="off"
            placeholder={
              hasKey
                ? t("settings.webTools.keySaved")
                : t("settings.webTools.keyPlaceholder")
            }
            type="password"
          />
        </TextField>
        <p className="text-xs text-muted-foreground">
          {t("settings.webTools.credentials")}
        </p>
        {provider !== current?.searchProvider && hasKey ? (
          <p className="text-xs text-warning">
            {t("settings.webTools.providerChanged")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            isDisabled={disabled || !isChanged}
            onPress={onSave}
            size="sm"
          >
            {t("settings.common.save")}
          </Button>
          <Button
            isDisabled={disabled || !hasKey}
            onPress={onClear}
            size="sm"
            variant="ghost"
          >
            {t("settings.webTools.clearKey")}
          </Button>
        </div>
      </Card.Content>
    </Card>
  )
}

const WebFetchTestCard = ({
  disabled,
  onError,
  onFetch,
  onUrlChange,
  pending,
  result,
  url
}: {
  disabled: boolean
  onError: (error: string) => void
  onFetch: () => void
  onUrlChange: (url: string) => void
  pending: boolean
  result: FetchResult | undefined
  url: string
}) => {
  const { t } = useI18n()
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("settings.webTools.testFetch")}</Card.Title>
      </Card.Header>
      <Card.Content className="space-y-3">
        <TextField onChange={onUrlChange} value={url}>
          <Label>{t("settings.webTools.url")}</Label>
          <Input type="url" />
        </TextField>
        <Button
          isDisabled={disabled || !url.trim()}
          onPress={onFetch}
          size="sm"
          variant="secondary"
        >
          {pending
            ? t("settings.webTools.testing")
            : t("settings.webTools.testFetch")}
        </Button>
        {result ? (
          <div
            className="space-y-2 rounded-lg bg-surface-secondary p-3"
            aria-live="polite"
          >
            <strong className="text-sm">
              {result.title || t("settings.webTools.source")}
            </strong>
            <SourceButton
              label={result.url}
              onError={onError}
              url={result.url}
            />
            <p className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">
              {result.text.slice(0, 1200)}
            </p>
            {result.truncated ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.webTools.truncated")}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card.Content>
    </Card>
  )
}

const WebSearchTestCard = ({
  disabled,
  onError,
  onQueryChange,
  onSearch,
  pending,
  query,
  result
}: {
  disabled: boolean
  onError: (error: string) => void
  onQueryChange: (query: string) => void
  onSearch: () => void
  pending: boolean
  query: string
  result: SearchResult | undefined
}) => {
  const { t } = useI18n()
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("settings.webTools.testSearch")}</Card.Title>
      </Card.Header>
      <Card.Content className="space-y-3">
        <TextField onChange={onQueryChange} value={query}>
          <Label>{t("settings.webTools.query")}</Label>
          <Input maxLength={600} />
        </TextField>
        <Button
          isDisabled={disabled || !query.trim()}
          onPress={onSearch}
          size="sm"
          variant="secondary"
        >
          {pending
            ? t("settings.webTools.testing")
            : t("settings.webTools.testSearch")}
        </Button>
        {result ? (
          <ul className="max-h-64 space-y-3 overflow-auto" aria-live="polite">
            {result.results.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                {t("settings.webTools.noResults")}
              </li>
            ) : null}
            {result.results.map((source) => (
              <li className="space-y-1 text-xs" key={source.url}>
                <SourceButton
                  label={source.title || source.url}
                  onError={onError}
                  url={source.url}
                />
                <p className="break-all text-muted-foreground">{source.url}</p>
                <p>{source.snippet}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card.Content>
    </Card>
  )
}

export const WebToolsTab = ({ active }: { active: boolean }) => {
  const queryClient = useQueryClient()
  const settings = useQuery({
    ...orpc.settings.get.queryOptions({}),
    enabled: active
  })
  const [apiKey, setApiKey] = useState("")
  const [providerDraft, setProviderDraft] = useState<
    WebToolsSettings["searchProvider"] | null
  >(null)
  const [url, setUrl] = useState("https://example.com")
  const [query, setQuery] = useState("MCP specification")
  const [error, setError] = useState<string | null>(null)
  const current = settings.data?.webTools
  const provider = providerDraft ?? current?.searchProvider ?? "brave"
  const hasKey = Boolean(current?.encryptedApiKey || current?.searchApiKey)
  const save = useMutation({
    mutationFn: async (webTools: WebToolsSettings) =>
      await rpcClient.settings.update({ webTools }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null),
    onSuccess: (value) => {
      queryClient.setQueryData(
        orpc.settings.get.queryOptions({}).queryKey,
        value
      )
      setApiKey("")
      setProviderDraft(null)
    }
  })
  const fetchTest = useMutation({
    mutationFn: async () => await rpcClient.webTools.fetch({ url }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null)
  })
  const searchTest = useMutation({
    mutationFn: async () => await rpcClient.webTools.search({ query }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null)
  })
  const persist = (): void => {
    if (current) {
      save.mutate(updateWebToolsCredentials(current, provider, apiKey))
    }
  }
  const clearKey = (): void => {
    if (!current) {
      return
    }
    const { encryptedApiKey: _key, ...configuration } = current
    save.mutate({ ...configuration, searchApiKey: "" })
  }
  const updateEnabled = (enabled: boolean): void => {
    if (current) {
      save.mutate({ ...current, enabled })
    }
  }
  if (!active) {
    return null
  }
  const isBusy = save.isPending || fetchTest.isPending || searchTest.isPending
  const testDisabled = !current?.enabled || isBusy
  return (
    <div className="space-y-4">
      <WebCredentialsCard
        apiKey={apiKey}
        busy={isBusy}
        current={current}
        error={error ?? settings.error?.message}
        onApiKeyChange={setApiKey}
        onClear={clearKey}
        onEnabledChange={updateEnabled}
        onProviderChange={setProviderDraft}
        onSave={persist}
        provider={provider}
      />
      <WebFetchTestCard
        disabled={testDisabled}
        onError={setError}
        onFetch={() => fetchTest.mutate()}
        onUrlChange={setUrl}
        pending={fetchTest.isPending}
        result={fetchTest.data}
        url={url}
      />
      <WebSearchTestCard
        disabled={
          testDisabled ||
          !hasKey ||
          provider !== current?.searchProvider ||
          apiKey.trim().length > 0
        }
        onError={setError}
        onQueryChange={setQuery}
        onSearch={() => searchTest.mutate()}
        pending={searchTest.isPending}
        query={query}
        result={searchTest.data}
      />
    </div>
  )
}
