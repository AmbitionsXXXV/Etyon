import { useI18n } from "@etyon/i18n/react"
import { useEffect } from "react"
import { toast } from "sonner"

import {
  clearScreenAwarenessCaptures,
  consumeScreenAwarenessCapture,
  expireScreenAwarenessCaptures,
  isFreshScreenAwarenessCapture,
  stageScreenAwarenessCapture
} from "@/renderer/lib/chat/screen-awareness-capture-store"
import { getScreenAwarenessErrorKey } from "@/renderer/lib/chat/screen-awareness-copy"
import { selectScreenAwarenessSession } from "@/renderer/lib/chat/screen-awareness-routing"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { queryClient } from "@/renderer/query-client"
import { router } from "@/renderer/router"
import type { ScreenAwarenessCapturePayload } from "@/shared/screen-awareness"

export const useScreenAwareness = (enabled: boolean): void => {
  const { t } = useI18n()
  useEffect(() => {
    if (!enabled) {
      clearScreenAwarenessCaptures()
      return
    }
    const expiryTimer = setInterval(expireScreenAwarenessCaptures, 30_000)
    let disposed = false
    let queue = Promise.resolve()
    const deliver = async (
      capture: ScreenAwarenessCapturePayload,
      recovered = false
    ): Promise<void> => {
      if (disposed || !isFreshScreenAwarenessCapture(capture)) {
        return
      }
      const sessions = await rpcClient.chatSessions.list()
      if (disposed || !isFreshScreenAwarenessCapture(capture)) {
        return
      }
      const destination = selectScreenAwarenessSession({
        assignedSessionId: capture.sessionId,
        now: Date.now(),
        pathname: router.state.location.pathname,
        sessions
      })
      if (destination.discard) {
        await window.electron.dismissScreenAwarenessCapture(capture.id)
        if (disposed) {
          return
        }
        consumeScreenAwarenessCapture(capture.id)
        return
      }
      let { sessionId } = destination
      if (!sessionId) {
        const session = await rpcClient.chatSessions.create({
          projectPath: destination.projectPath
        })
        if (disposed || !isFreshScreenAwarenessCapture(capture)) {
          return
        }
        sessionId = session.id
      }
      const canonical = await window.electron.assignScreenAwarenessCapture(
        capture.id,
        sessionId
      )
      if (
        disposed ||
        !isFreshScreenAwarenessCapture(capture) ||
        !isFreshScreenAwarenessCapture(canonical)
      ) {
        return
      }
      stageScreenAwarenessCapture(canonical)
      await queryClient.invalidateQueries({
        queryKey: orpc.chatSessions.list.queryOptions({}).queryKey
      })
      if (disposed || !isFreshScreenAwarenessCapture(capture)) {
        return
      }
      if (!recovered || !capture.sessionId) {
        await router.navigate({ params: { sessionId }, to: "/chat/$sessionId" })
      }
    }
    const enqueue = (
      capture: ScreenAwarenessCapturePayload,
      recovered = false
    ): void => {
      const previous = queue
      queue = (async () => {
        await previous
        if (disposed) {
          return
        }
        try {
          await deliver(capture, recovered)
        } catch {
          if (!disposed) {
            toast.error(t("chat.screenAwareness.errors.routing-failed"))
          }
        }
      })()
    }
    const removeDismissListener = window.electron.ipcRenderer.on(
      "screen-awareness:capture-dismissed",
      (_event, id: unknown) => {
        if (typeof id === "string") {
          consumeScreenAwarenessCapture(id)
        }
      }
    )
    const removeCaptureListener =
      window.electron.onScreenAwarenessCapture(enqueue)
    const removeErrorListener = window.electron.onScreenAwarenessError(
      (error) => {
        toast.error(t("chat.screenAwareness.failed"), {
          description: t(getScreenAwarenessErrorKey(error.code))
        })
      }
    )
    void (async () => {
      try {
        const captures = await window.electron.listScreenAwarenessCaptures()
        if (disposed) {
          return
        }
        for (const capture of captures) {
          enqueue(capture, true)
        }
      } catch {
        if (!disposed) {
          toast.error(t("chat.screenAwareness.errors.routing-failed"))
        }
      }
    })()
    return () => {
      clearInterval(expiryTimer)
      disposed = true
      removeDismissListener()
      removeCaptureListener()
      removeErrorListener()
    }
  }, [enabled, t])
}
