import type { TranslationKey } from "@etyon/i18n"
import type { StoredProviderModel } from "@etyon/rpc"

import { formatContextWindowCompact } from "@/shared/providers/context-window"
import { resolveFunctionCallingSupport } from "@/shared/providers/function-calling"
import { isImageOutputModel } from "@/shared/providers/image-output"

export type ModelCapabilityBadgeKind =
  | "functionCalling"
  | "imageOutput"
  | "reasoning"
  | "vision"
  | "xmlFunctionCalling"

export interface ModelCapabilityBadge {
  kind: ModelCapabilityBadgeKind
  labelKey: TranslationKey
}

export interface ModelContextBadge {
  /** Compact magnitude for the chip label, e.g. "1M" or "203K". */
  compact: string
  /** Full token count for the tooltip, e.g. "1,000,000". */
  tokens: string
}

/**
 * Ordered capability badges for a stored model. Order is deliberate:
 * vision → function calling (native or XML middleware) → reasoning → image
 * output. JSON mode and streaming are intentionally excluded (low signal). The
 * XML-middleware badge and the middleware activation share
 * `resolveFunctionCallingSupport`, so the badge can never drift from behavior.
 * Image output uses `isImageOutputModel` (flag OR id heuristic), not the raw
 * capability flag, since provider seeds leave the flag unset.
 */
export const buildModelCapabilityBadges = (
  model: StoredProviderModel
): ModelCapabilityBadge[] => {
  const badges: ModelCapabilityBadge[] = []

  if (model.capabilities?.vision) {
    badges.push({
      kind: "vision",
      labelKey: "settings.providers.models.capabilities.vision"
    })
  }

  const functionCallingSupport = resolveFunctionCallingSupport(model)

  if (functionCallingSupport === "native") {
    badges.push({
      kind: "functionCalling",
      labelKey: "settings.providers.models.capabilities.functionCalling"
    })
  } else if (functionCallingSupport === "xml-middleware") {
    badges.push({
      kind: "xmlFunctionCalling",
      labelKey: "settings.providers.models.capabilities.xmlFunctionCalling"
    })
  }

  if (model.capabilities?.reasoning) {
    badges.push({
      kind: "reasoning",
      labelKey: "settings.providers.models.capabilities.reasoning"
    })
  }

  if (isImageOutputModel(model)) {
    badges.push({
      kind: "imageOutput",
      labelKey: "settings.providers.models.capabilities.imageOutput"
    })
  }

  return badges
}

export const buildModelContextBadge = (
  model: StoredProviderModel
): ModelContextBadge | null => {
  const contextWindow = model.capabilities?.contextWindow

  if (!contextWindow) {
    return null
  }

  const compact = formatContextWindowCompact(contextWindow)

  if (!compact) {
    return null
  }

  return {
    compact,
    tokens: contextWindow.toLocaleString("en-US")
  }
}
