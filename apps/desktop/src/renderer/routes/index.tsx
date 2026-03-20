import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import { createFileRoute } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

import trayImage from "../../../resources/tray.png"
import { SETTINGS_PAGE_EASE_CURVE } from "../lib/settings-page/constants"

const HOME_NOTICE_RESET_DELAY = 2400

type HomeNoticeState = "hint" | "mocked"

const handleOpenSettingsWindow = () => {
  window.electron.ipcRenderer.send("open-settings")
}

const HomePage = () => {
  const { t } = useI18n()
  const [noticeState, setNoticeState] = useState<HomeNoticeState>("hint")
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNoticeTimeout = useCallback(() => {
    if (noticeTimeoutRef.current === null) {
      return
    }

    clearTimeout(noticeTimeoutRef.current)
    noticeTimeoutRef.current = null
  }, [])

  const handleNewChatClick = useCallback(() => {
    clearNoticeTimeout()
    setNoticeState("mocked")

    noticeTimeoutRef.current = setTimeout(() => {
      noticeTimeoutRef.current = null
      setNoticeState("hint")
    }, HOME_NOTICE_RESET_DELAY)
  }, [clearNoticeTimeout])

  useEffect(() => clearNoticeTimeout, [clearNoticeTimeout])

  return (
    <section className="flex h-full min-h-0 items-center justify-center px-6 py-10 sm:px-8">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="flex w-full max-w-96 flex-col items-center text-center"
        initial={{ opacity: 0, y: 14 }}
        transition={{
          duration: 0.32,
          ease: SETTINGS_PAGE_EASE_CURVE
        }}
      >
        <img
          alt={t("home.logoAlt")}
          className="size-20 object-contain"
          src={trayImage}
        />

        <h1
          className="mt-6 text-5xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl"
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif'
          }}
        >
          Etyon
        </h1>

        <p className="mt-5 max-w-96 text-base/7 text-muted-foreground">
          {t("home.description")}
        </p>

        <div className="mt-10 w-full max-w-136 space-y-3">
          <Button
            className="h-13 w-full rounded-2xl text-sm font-semibold"
            onClick={handleNewChatClick}
            size="lg"
          >
            {t("home.actions.newChat")}
          </Button>

          <Button
            className="h-12 w-full rounded-2xl text-sm font-semibold"
            onClick={handleOpenSettingsWindow}
            size="lg"
            variant="outline"
          >
            {t("home.actions.settings")}
          </Button>
        </div>

        <AnimatePresence initial={false} mode="wait">
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 max-w-lg text-sm/6 text-muted-foreground"
            initial={{ opacity: 0, y: 6 }}
            key={noticeState}
            transition={{
              duration: 0.2,
              ease: SETTINGS_PAGE_EASE_CURVE
            }}
          >
            {noticeState === "hint" ? t("home.hint") : t("home.mockedNotice")}
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </section>
  )
}

export const Route = createFileRoute("/")({
  component: HomePage
})
