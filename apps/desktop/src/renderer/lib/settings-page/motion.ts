import { SETTINGS_PAGE_EASE_CURVE } from "./constants"

export const settingsPageSectionMotion = (delay: number) => ({
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 10 },
  transition: {
    delay,
    duration: 0.35,
    ease: SETTINGS_PAGE_EASE_CURVE
  }
})
