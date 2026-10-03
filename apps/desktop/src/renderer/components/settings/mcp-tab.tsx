import { useI18n } from "@etyon/i18n/react"
import type { McpServerConfig } from "@etyon/rpc"
import {
  Button,
  Card,
  Chip,
  Label,
  Switch,
  TextArea,
  TextField
} from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  removeMcpCredentials,
  updateMcpServerFromEditor
} from "@/renderer/lib/mcp/settings"
import { orpc, rpcClient } from "@/renderer/lib/rpc"

interface ServerStatus {
  catalogTruncated: boolean
  descriptionBytes: number
  error: string | null
  state: "connected" | "connecting" | "disconnected" | "error"
  toolCount: number
  tools: { description: string; name: string }[]
}
const STATUS_COLORS = {
  connected: "success",
  connecting: "warning",
  disconnected: "default",
  error: "danger"
} as const

const McpServerCard = ({
  busy,
  configuring,
  onClearCredentials,
  onConnect,
  onDisconnect,
  onEdit,
  onEnabledChange,
  onRemove,
  server,
  status
}: {
  busy: boolean
  configuring: boolean
  onClearCredentials: () => void
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
  onEnabledChange: (enabled: boolean) => void
  onRemove: () => void
  server: McpServerConfig
  status: ServerStatus | undefined
}) => {
  const { t } = useI18n()
  const state = status?.state ?? "disconnected"
  const disabled = busy || configuring
  const canDisconnect =
    server.enabled && !busy && (state === "connected" || state === "connecting")
  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between">
        <Card.Title>{server.name}</Card.Title>
        <Chip color={STATUS_COLORS[state]} size="sm">
          {t(`settings.mcp.status.${state}`)}
        </Chip>
      </Card.Header>
      <Card.Content className="space-y-3">
        <Switch
          isDisabled={disabled}
          isSelected={server.enabled}
          onChange={onEnabledChange}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label>{t("settings.mcp.enabled")}</Label>
          </Switch.Content>
        </Switch>
        <p className="text-xs break-all text-muted-foreground">
          {server.transport === "stdio" ? server.command : server.url}
        </p>
        {status?.error ? (
          <p className="text-xs text-danger" role="alert">
            {status.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            isDisabled={!server.enabled || disabled}
            onPress={onConnect}
            size="sm"
            variant="secondary"
          >
            {t("settings.mcp.connect")}
          </Button>
          <Button
            isDisabled={!canDisconnect}
            onPress={onDisconnect}
            size="sm"
            variant="secondary"
          >
            {t("settings.mcp.disconnect")}
          </Button>
          <Button
            isDisabled={disabled}
            onPress={onEdit}
            size="sm"
            variant="ghost"
          >
            {t("settings.mcp.edit")}
          </Button>
          <Button
            isDisabled={disabled}
            onPress={onRemove}
            size="sm"
            variant="ghost"
          >
            {t("settings.mcp.remove")}
          </Button>
          {server.encryptedCredentials ? (
            <Button
              isDisabled={disabled}
              onPress={onClearCredentials}
              size="sm"
              variant="ghost"
            >
              {t("settings.mcp.clearCredentials")}
            </Button>
          ) : null}
        </div>
        {(status?.descriptionBytes ?? 0) > 8192 ? (
          <p className="text-xs text-warning">
            {t("settings.mcp.largeCatalog")}
          </p>
        ) : null}
        {status?.catalogTruncated ? (
          <p className="text-xs text-warning">
            {t("settings.mcp.catalogTruncated", { count: status.toolCount })}
          </p>
        ) : null}
        <details>
          <summary className="cursor-pointer text-sm">
            {t("settings.mcp.tools", { count: status?.tools.length ?? 0 })}
          </summary>
          <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
            {status?.tools.map((entry) => (
              <li className="text-xs" key={entry.name}>
                <strong>{entry.name}</strong>
                <p className="text-muted-foreground">{entry.description}</p>
              </li>
            ))}
          </ul>
        </details>
      </Card.Content>
    </Card>
  )
}

const McpEditor = ({
  disabled,
  onCancel,
  onChange,
  onSave,
  value
}: {
  disabled: boolean
  onCancel: () => void
  onChange: (value: string) => void
  onSave: () => void
  value: string
}) => {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <TextField isDisabled={disabled} onChange={onChange} value={value}>
        <Label>{t("settings.mcp.configuration")}</Label>
        <TextArea className="min-h-60 font-mono text-xs" />
      </TextField>
      <div className="flex gap-2">
        <Button isDisabled={disabled} onPress={onSave} size="sm">
          {t("settings.common.save")}
        </Button>
        <Button
          isDisabled={disabled}
          onPress={onCancel}
          size="sm"
          variant="ghost"
        >
          {t("settings.common.cancel")}
        </Button>
      </div>
    </div>
  )
}

export const McpTab = ({ active }: { active: boolean }) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const settings = useQuery({
    ...orpc.settings.get.queryOptions({}),
    enabled: active
  })
  const statuses = useQuery({
    ...orpc.mcp.statuses.queryOptions({}),
    enabled: active,
    refetchInterval: active ? 2000 : false
  })
  const [editor, setEditor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshStatuses = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: orpc.mcp.statuses.key() })
  }
  const save = useMutation({
    mutationFn: async (servers: McpServerConfig[]) =>
      await rpcClient.settings.update({ mcp: { servers } }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null),
    onSuccess: async (value) => {
      queryClient.setQueryData(
        orpc.settings.get.queryOptions({}).queryKey,
        value
      )
      setEditor(null)
      setEditingId(null)
      await refreshStatuses()
    }
  })
  const connect = useMutation({
    mutationFn: async (serverId: string) =>
      await rpcClient.mcp.connect({ serverId }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null),
    onSuccess: refreshStatuses
  })
  const disconnect = useMutation({
    mutationFn: async (serverId: string) =>
      await rpcClient.mcp.disconnect({ serverId }),
    onError: (cause) => setError(cause.message),
    onMutate: () => setError(null),
    onSuccess: refreshStatuses
  })
  const create = (transport: "http" | "stdio"): void => {
    const common = {
      enabled: false,
      id: crypto.randomUUID(),
      name: t("settings.mcp.newServer"),
      protocol: "legacy",
      transport
    }
    setEditor(
      JSON.stringify(
        transport === "stdio"
          ? { ...common, args: [], command: "", env: {} }
          : { ...common, headers: {}, url: "https://" },
        null,
        2
      )
    )
    setEditingId(null)
    setError(null)
  }
  const servers = settings.data?.mcp.servers ?? []
  const persistEditor = (): void => {
    try {
      save.mutate(updateMcpServerFromEditor(editor ?? "", servers, editingId))
    } catch {
      setError(t("settings.mcp.invalid"))
    }
  }
  const edit = (server: McpServerConfig): void => {
    const { encryptedCredentials: _credentials, ...editable } = server
    setEditor(JSON.stringify(editable, null, 2))
    setEditingId(server.id)
    setError(null)
  }
  if (!active) {
    return null
  }
  const busy = save.isPending || disconnect.isPending
  const configuring = editor !== null || connect.isPending
  const canAdd =
    Boolean(settings.data) && !busy && !connect.isPending && servers.length < 8
  const message = error ?? settings.error?.message ?? statuses.error?.message
  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>{t("settings.mcp.title")}</Card.Title>
          <Card.Description>{t("settings.mcp.description")}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-3">
          <div className="flex gap-2">
            <Button
              isDisabled={!canAdd}
              onPress={() => create("stdio")}
              size="sm"
              variant="secondary"
            >
              {t("settings.mcp.addStdio")}
            </Button>
            <Button
              isDisabled={!canAdd}
              onPress={() => create("http")}
              size="sm"
              variant="secondary"
            >
              {t("settings.mcp.addHttp")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.mcp.credentials")}
          </p>
          {message ? (
            <p className="text-sm text-danger" role="alert">
              {message}
            </p>
          ) : null}
          {settings.isPending ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.mcp.loading")}
            </p>
          ) : null}
          {servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.mcp.empty")}
            </p>
          ) : null}
          {editor === null ? null : (
            <McpEditor
              disabled={busy || connect.isPending}
              onCancel={() => setEditor(null)}
              onChange={setEditor}
              onSave={persistEditor}
              value={editor}
            />
          )}
        </Card.Content>
      </Card>
      {servers.map((server) => (
        <McpServerCard
          busy={busy}
          configuring={configuring}
          key={server.id}
          onClearCredentials={() =>
            save.mutate(
              servers.map((entry) =>
                entry.id === server.id ? removeMcpCredentials(entry) : entry
              )
            )
          }
          onConnect={() => connect.mutate(server.id)}
          onDisconnect={() => disconnect.mutate(server.id)}
          onEdit={() => edit(server)}
          onEnabledChange={(enabled) =>
            save.mutate(
              servers.map((entry) =>
                entry.id === server.id ? { ...entry, enabled } : entry
              )
            )
          }
          onRemove={() =>
            save.mutate(servers.filter((entry) => entry.id !== server.id))
          }
          server={server}
          status={statuses.data?.statuses.find(
            (entry) => entry.serverId === server.id
          )}
        />
      ))}
    </div>
  )
}
