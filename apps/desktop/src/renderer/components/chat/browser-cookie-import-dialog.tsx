import { useI18n } from "@etyon/i18n/react"
import type { BrowserCookieSource } from "@etyon/rpc"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import {
  Button,
  Description,
  Input,
  Label,
  Radio,
  RadioGroup,
  Spinner,
  TextField
} from "@heroui/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { resolveCookieImportErrorMessageKey } from "@/renderer/lib/chat/cookie-import"
import { orpc, rpcClient } from "@/renderer/lib/rpc"

const CookieSourceOption = ({ source }: { source: BrowserCookieSource }) => {
  const { t } = useI18n()

  return (
    <Radio value={source.id}>
      <Radio.Control>
        <Radio.Indicator />
      </Radio.Control>
      <Radio.Content>
        <Label>{`${source.browser} · ${source.profileName}`}</Label>
        <Description>
          {source.cookieCount === null
            ? t("chat.projectPanel.cookieImportCountUnknown")
            : t("chat.projectPanel.cookieImportCount", {
                count: source.cookieCount
              })}
        </Description>
      </Radio.Content>
    </Radio>
  )
}

/**
 * Imports an existing sign-in state from a local Chromium profile into this
 * session's embedded browser. Listing profiles is free (it never touches the
 * Keychain); the import itself raises the system authorization prompt the first
 * time a given browser is read, which is why both consequences are stated in the
 * body rather than hidden behind a disclosure.
 *
 * The panel hides the native browser view while this is open — a
 * `WebContentsView` paints above the DOM and would otherwise cover the dialog.
 */
export const BrowserCookieImportDialog = ({
  onOpenChange,
  sessionId
}: {
  onOpenChange: (open: boolean) => void
  sessionId: string
}) => {
  const { t } = useI18n()
  const [selectedSourceId, setSelectedSourceId] = useState("")
  const [domainFilter, setDomainFilter] = useState("")
  // Re-enumerated on every open (profiles and counts move under us), and never
  // retried: the failures here are permanent ones like an unsupported platform.
  const sourcesQuery = useQuery(
    orpc.browser.listCookieSources.queryOptions({
      input: { sessionId },
      retry: false,
      staleTime: 0
    })
  )
  const sources = sourcesQuery.data?.sources ?? []
  // The first profile is the default selection until the user picks another, so
  // no effect has to reconcile the list with the selection.
  const activeSourceId =
    selectedSourceId === "" ? (sources.at(0)?.id ?? "") : selectedSourceId
  const importMutation = useMutation({
    mutationFn: () => {
      const trimmedFilter = domainFilter.trim()

      return rpcClient.browser.importCookies({
        ...(trimmedFilter === "" ? {} : { domainFilter: trimmedFilter }),
        sessionId,
        sourceId: activeSourceId
      })
    }
  })
  const result = importMutation.isSuccess ? importMutation.data : null

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("chat.projectPanel.cookieImportTitle")}</DialogTitle>
          <DialogDescription>
            {t("chat.projectPanel.cookieImportDescription")}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-emerald-600 dark:text-emerald-400">
              {t("chat.projectPanel.cookieImportResult", {
                imported: result.imported,
                total: result.total
              })}
            </p>
            {result.failed > 0 ? (
              <p className="text-amber-600 dark:text-amber-400">
                {t("chat.projectPanel.cookieImportResultFailed", {
                  failed: result.failed
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {sourcesQuery.isPending ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : null}

            {sourcesQuery.isError ? (
              <p className="text-xs text-destructive">
                {t(resolveCookieImportErrorMessageKey(sourcesQuery.error))}
              </p>
            ) : null}

            {sourcesQuery.isSuccess && sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("chat.projectPanel.cookieImportEmpty")}
              </p>
            ) : null}

            {sources.length > 0 ? (
              <div className="max-h-52 overflow-y-auto rounded-md border border-border/60 bg-background/50 p-2">
                <RadioGroup
                  aria-label={t("chat.projectPanel.cookieImportSourcesLabel")}
                  onChange={setSelectedSourceId}
                  value={activeSourceId}
                >
                  {sources.map((source) => (
                    <CookieSourceOption key={source.id} source={source} />
                  ))}
                </RadioGroup>
              </div>
            ) : null}

            {sources.length > 0 ? (
              <TextField
                aria-label={t("chat.projectPanel.cookieImportDomainLabel")}
                onChange={setDomainFilter}
                value={domainFilter}
              >
                <Input
                  placeholder={t(
                    "chat.projectPanel.cookieImportDomainPlaceholder"
                  )}
                  variant="secondary"
                />
              </TextField>
            ) : null}

            {importMutation.isError ? (
              <p className="text-xs text-destructive">
                {t(resolveCookieImportErrorMessageKey(importMutation.error))}
              </p>
            ) : null}
          </div>
        )}

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("chat.projectPanel.cookieImportNoteAgent")}</p>
          <p>{t("chat.projectPanel.cookieImportNoteKeychain")}</p>
        </div>

        <DialogFooter>
          <Button
            isDisabled={importMutation.isPending}
            onPress={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t(
              result
                ? "chat.projectPanel.cookieImportClose"
                : "chat.projectPanel.cookieImportCancel"
            )}
          </Button>
          {result ? null : (
            <Button
              isDisabled={activeSourceId === "" || importMutation.isPending}
              isPending={importMutation.isPending}
              onPress={() => importMutation.mutate()}
              type="button"
              variant="primary"
            >
              {t(
                importMutation.isPending
                  ? "chat.projectPanel.cookieImportPending"
                  : "chat.projectPanel.cookieImportConfirm"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
