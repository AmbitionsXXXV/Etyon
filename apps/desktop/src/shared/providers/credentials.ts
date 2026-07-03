import type { AiProviderConfig } from "@etyon/rpc"

import type { getProviderCatalogEntry } from "./provider-catalog"

type ProviderCatalogEntry = ReturnType<typeof getProviderCatalogEntry>

export const hasProviderCredential = (
  catalogEntry: ProviderCatalogEntry,
  providerConfig: Pick<AiProviderConfig, "apiKey">,
  ctx?: { cursorAuthenticated?: boolean }
): boolean =>
  catalogEntry.credential === "oauth"
    ? Boolean(ctx?.cursorAuthenticated)
    : Boolean(providerConfig.apiKey.trim())
