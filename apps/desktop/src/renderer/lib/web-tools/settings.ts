import type { WebToolsSettings } from "@etyon/rpc"

export const updateWebToolsCredentials = (
  current: WebToolsSettings,
  provider: WebToolsSettings["searchProvider"],
  apiKey: string
): WebToolsSettings => {
  const { encryptedApiKey: _key, ...configuration } = current
  const next = {
    ...configuration,
    searchApiKey: apiKey.trim(),
    searchProvider: provider
  }
  return !apiKey.trim() &&
    provider === current.searchProvider &&
    current.encryptedApiKey
    ? { ...next, encryptedApiKey: current.encryptedApiKey }
    : next
}
