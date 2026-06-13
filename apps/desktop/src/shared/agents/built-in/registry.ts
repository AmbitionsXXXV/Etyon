import type { AgentProfile } from "@etyon/rpc"

import { coderProfile } from "./coder"
import { exploreProfile } from "./explore"
import { generalPurposeProfile } from "./general-purpose"
import { harnessOperatorProfile } from "./harness-operator"
import { planProfile } from "./plan"
import { reviewProfile } from "./review"

/**
 * Stable built-in profile roster. Order drives the settings list and the
 * fallback pick (first available) in `resolveActiveProfile`. Each profile lives
 * in its own `built-in/<id>.ts` file; this registry is the only aggregator.
 */
export const BUILT_IN_PROFILES: readonly AgentProfile[] = [
  generalPurposeProfile,
  exploreProfile,
  coderProfile,
  planProfile,
  reviewProfile,
  harnessOperatorProfile
]

/** Maps a built-in profile id to its settings-UI i18n key. */
export const BUILT_IN_PROFILE_I18N_KEY: Record<string, string> = {
  coder: "coder",
  explore: "explore",
  "general-purpose": "generalPurpose",
  "harness-operator": "harnessOperator",
  plan: "plan",
  review: "review"
}
