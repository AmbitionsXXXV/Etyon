import { useI18n } from "@etyon/i18n/react"
import type { ProxySettings, ProxyType } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import { Checkbox } from "@etyon/ui/components/checkbox"
import { Input } from "@etyon/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"
import { cn } from "@etyon/ui/lib/utils"
import { motion } from "motion/react"
import { useCallback, useState } from "react"

import { rpcClient } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface TestResult {
  countryCode?: string
  countryFlag?: string
  error?: string
  ip?: string
  latencyMs?: number
  ok: boolean
}

const PROXY_TYPE_OPTIONS: { label: string; value: ProxyType }[] = [
  { label: "HTTP", value: "http" },
  { label: "HTTPS", value: "https" },
  { label: "SOCKS5", value: "socks5" }
]

export const NetworkTab = ({
  onChange,
  proxy
}: {
  onChange: (proxy: ProxySettings) => void
  proxy: ProxySettings
}) => {
  const { t } = useI18n()
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const updateProxy = useCallback(
    <K extends keyof ProxySettings>(field: K, value: ProxySettings[K]) => {
      onChange({ ...proxy, [field]: value })
    },
    [onChange, proxy]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateProxy("enabled", checked),
    [updateProxy]
  )

  const handleTypeChange = useCallback(
    (value: ProxyType | null) => {
      if (value) {
        updateProxy("type", value)
      }
    },
    [updateProxy]
  )

  const handleHostChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      updateProxy("host", event.target.value),
    [updateProxy]
  )

  const handlePortChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10)
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 65_535) {
        updateProxy("port", parsed)
      }
    },
    [updateProxy]
  )

  const handleUsernameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      updateProxy("username", event.target.value),
    [updateProxy]
  )

  const handlePasswordChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      updateProxy("password", event.target.value),
    [updateProxy]
  )

  const handleTestProxy = useCallback(async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      const result = await rpcClient.proxy.test({
        proxy,
        timeoutMs: 10_000,
        url: "https://api.openai.com"
      })
      setTestResult({
        countryCode: result.countryCode,
        countryFlag: result.countryFlag,
        error: result.error,
        ip: result.ip,
        latencyMs: result.latencyMs,
        ok: result.ok
      })
    } catch {
      setTestResult({ ok: false })
    } finally {
      setIsTesting(false)
    }
  }, [proxy])

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold">
          {t("settings.network.proxy.title")}
        </h2>

        <label className="flex cursor-pointer items-center gap-2.5">
          <Checkbox
            checked={proxy.enabled}
            className="size-4 cursor-pointer rounded border-border accent-primary"
            onCheckedChange={handleEnabledChange}
          />
          <span className="text-sm">{t("settings.network.proxy.enable")}</span>
        </label>

        <div
          className={cn(
            "space-y-4 overflow-hidden transition-all duration-200",
            proxy.enabled ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="space-y-2 border-l-2 border-border pl-4">
            <h3 className="text-xs font-medium text-muted-foreground">
              {t("settings.network.proxy.type")}
            </h3>
            <Select onValueChange={handleTypeChange} value={proxy.type}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(selectedValue) =>
                    PROXY_TYPE_OPTIONS.find(
                      (option) => option.value === selectedValue
                    )?.label ?? selectedValue
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PROXY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("settings.network.proxy.server")}
              </h3>
              <Input
                onChange={handleHostChange}
                placeholder={t("settings.network.proxy.serverPlaceholder")}
                value={proxy.host}
              />
            </div>

            <div className="w-28 space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("settings.network.proxy.port")}
              </h3>
              <Input
                onChange={handlePortChange}
                placeholder="8080"
                type="number"
                value={String(proxy.port)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("settings.network.proxy.username")}
              </h3>
              <Input
                onChange={handleUsernameChange}
                placeholder={t("settings.network.proxy.usernamePlaceholder")}
                value={proxy.username}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("settings.network.proxy.password")}
              </h3>
              <Input
                onChange={handlePasswordChange}
                placeholder={t("settings.network.proxy.passwordPlaceholder")}
                type="password"
                value={proxy.password}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              disabled={!proxy.host || isTesting}
              onClick={handleTestProxy}
              variant="outline"
            >
              {isTesting
                ? t("settings.network.proxy.testing")
                : t("settings.network.proxy.test")}
            </Button>

            {testResult && (
              <span
                className={cn(
                  "text-xs font-medium",
                  testResult.ok ? "text-green-500" : "text-destructive"
                )}
              >
                {testResult.ok
                  ? [
                      "Proxy OK",
                      testResult.latencyMs !== undefined &&
                        `${testResult.latencyMs} ms`,
                      testResult.ip,
                      testResult.countryFlag &&
                        testResult.countryCode &&
                        `${testResult.countryFlag} ${testResult.countryCode}`
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : (testResult.error ??
                    t("settings.network.proxy.testFailed"))}
              </span>
            )}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
