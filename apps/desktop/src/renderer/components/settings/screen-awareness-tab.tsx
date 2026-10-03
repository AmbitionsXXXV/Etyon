import { useI18n } from "@etyon/i18n/react"
import { Button, Card, Chip, Switch } from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

export const ScreenAwarenessTab = ({ active }: { active: boolean }) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const isMacOS = window.electron.process.platform === "darwin"
  const settings = useQuery({
    ...orpc.settings.get.queryOptions({}),
    enabled: active
  })
  const status = useQuery({
    enabled: active && isMacOS,
    queryFn: async (): Promise<{
      accessibility: string
      screenRecording: string
    }> => {
      const result: unknown = await window.electron.ipcRenderer.invoke(
        "screen-awareness:get-permission-status"
      )
      if (
        !result ||
        typeof result !== "object" ||
        !("accessibility" in result) ||
        !("screenRecording" in result)
      ) {
        throw new Error("Invalid permission status")
      }
      return {
        accessibility: String(result.accessibility),
        screenRecording: String(result.screenRecording)
      }
    },
    queryKey: ["screen-awareness-status"],
    refetchInterval: 1000
  })
  const update = useMutation({
    mutationFn: async (enabled: boolean) =>
      await rpcClient.settings.update({ screenAwareness: { enabled } }),
    onError: () => toast.error(t("settings.screenAwareness.failed")),
    onSuccess: (value) =>
      queryClient.setQueryData(
        orpc.settings.get.queryOptions({}).queryKey,
        value
      )
  })
  const permission = useMutation({
    mutationFn: async () =>
      await window.electron.ipcRenderer.invoke(
        "screen-awareness:open-onboarding"
      ),
    onError: () => toast.error(t("settings.screenAwareness.failed")),
    onSuccess: (started) => {
      if (!started) {
        toast.error(t("settings.screenAwareness.failed"))
      }
    }
  })
  const clear = useMutation({
    mutationFn: async () => {
      await window.electron.clearScreenAwarenessCaptures()
    },
    onError: () => toast.error(t("settings.screenAwareness.failed")),
    onSuccess: () => toast.success(t("settings.screenAwareness.cleared"))
  })
  if (!active) {
    return null
  }
  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>{t("settings.screenAwareness.title")}</Card.Title>
          <Card.Description>
            {t("settings.screenAwareness.description")}
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          {isMacOS ? (
            <>
              <Switch
                isDisabled={update.isPending || !settings.data}
                isSelected={settings.data?.screenAwareness.enabled ?? false}
                onChange={(enabled) => update.mutate(enabled)}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  {t("settings.screenAwareness.enabled")}
                </Switch.Content>
              </Switch>
              <div className="flex flex-wrap gap-3">
                {["accessibility", "screenRecording"].map((key) => (
                  <div className="flex items-center gap-2" key={key}>
                    <span>
                      {key === "accessibility"
                        ? t("settings.screenAwareness.accessibility")
                        : t("settings.screenAwareness.screenRecording")}
                    </span>
                    <Chip
                      color={
                        status.data?.[key as "accessibility"] === "granted"
                          ? "success"
                          : "warning"
                      }
                      size="sm"
                    >
                      {status.data?.[key as "accessibility"] === "granted"
                        ? t("settings.screenAwareness.granted")
                        : t("settings.screenAwareness.missing")}
                    </Chip>
                  </div>
                ))}
              </div>
              <Button
                isDisabled={permission.isPending}
                onPress={() => permission.mutate()}
                variant="secondary"
              >
                {t("settings.screenAwareness.permissions")}
              </Button>
            </>
          ) : (
            <p>{t("settings.screenAwareness.unsupported")}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {t("settings.screenAwareness.privacy")}
          </p>
          <Button
            isDisabled={clear.isPending}
            onPress={() => clear.mutate()}
            variant="ghost"
          >
            {t("settings.screenAwareness.clear")}
          </Button>
        </Card.Content>
      </Card>
    </div>
  )
}
