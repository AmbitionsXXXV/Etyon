import { STREAMDOWN_ANIMATION_DEFAULT } from "@etyon/rpc"
import type { ChatSettings, StreamdownAnimation } from "@etyon/rpc"
import type { AnimateOptions } from "streamdown"

interface StreamdownAnimationOption {
  descriptionKey: string
  labelKey: string
  value: StreamdownAnimation
}

export const STREAMDOWN_ANIMATION_OPTIONS = [
  {
    descriptionKey:
      "settings.chat.streamdown.animation.option.fadeIn.description",
    labelKey: "settings.chat.streamdown.animation.option.fadeIn.label",
    value: "fade-in"
  },
  {
    descriptionKey:
      "settings.chat.streamdown.animation.option.blurIn.description",
    labelKey: "settings.chat.streamdown.animation.option.blurIn.label",
    value: "blur-in"
  },
  {
    descriptionKey:
      "settings.chat.streamdown.animation.option.slideUp.description",
    labelKey: "settings.chat.streamdown.animation.option.slideUp.label",
    value: "slide-up"
  },
  {
    descriptionKey:
      "settings.chat.streamdown.animation.option.typewriter.description",
    labelKey: "settings.chat.streamdown.animation.option.typewriter.label",
    value: "typewriter"
  },
  {
    descriptionKey:
      "settings.chat.streamdown.animation.option.none.description",
    labelKey: "settings.chat.streamdown.animation.option.none.label",
    value: "none"
  }
] as const satisfies readonly StreamdownAnimationOption[]

export const getChatStreamdownAnimation = (
  chat?: ChatSettings
): StreamdownAnimation =>
  chat?.streamdown.animation ?? STREAMDOWN_ANIMATION_DEFAULT

export const getStreamdownAnimateOptions = (
  animation: StreamdownAnimation
): false | AnimateOptions => {
  switch (animation) {
    case "blur-in": {
      return {
        animation: "blurIn",
        duration: 250,
        easing: "ease-out"
      }
    }
    case "fade-in": {
      return {
        animation: "fadeIn"
      }
    }
    case "slide-up": {
      return {
        animation: "slideUp",
        duration: 180,
        easing: "ease-out"
      }
    }
    case "typewriter": {
      // Per-flush char cascade (stagger × chars-per-flush) must fit within the
      // useChat throttle window (~50ms), or the next flush snaps in-flight
      // chars and the typewriter stutters.
      return {
        animation: "fadeIn",
        duration: 80,
        easing: "ease-out",
        sep: "char",
        stagger: 15
      }
    }
    case "none": {
      return false
    }
    default: {
      return false
    }
  }
}

export const getStreamdownAnimationValue = (
  value: string
): StreamdownAnimation | null => {
  const option = STREAMDOWN_ANIMATION_OPTIONS.find(
    (candidate) => candidate.value === value
  )

  return option?.value ?? null
}
