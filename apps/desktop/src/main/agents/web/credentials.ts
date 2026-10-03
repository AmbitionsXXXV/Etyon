import { platform } from "@electron-toolkit/utils"
import type { WebToolsSettings } from "@etyon/rpc"
import { safeStorage } from "electron"

export const protectWebToolsCredentials = (
  settings: WebToolsSettings
): WebToolsSettings => {
  if (!settings.searchApiKey) {
    return settings
  }
  if (
    !safeStorage.isEncryptionAvailable() ||
    (platform.isLinux &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "Secure credential storage is unavailable. Configure the system keyring before saving the search API key."
    )
  }
  return {
    ...settings,
    encryptedApiKey: safeStorage
      .encryptString(settings.searchApiKey)
      .toString("base64"),
    searchApiKey: ""
  }
}

export const readWebToolsApiKey = (settings: WebToolsSettings): string => {
  if (!settings.encryptedApiKey) {
    return settings.searchApiKey
  }
  try {
    return safeStorage.decryptString(
      Buffer.from(settings.encryptedApiKey, "base64")
    )
  } catch {
    throw new Error(
      "The search API key cannot be read. Save a new key in Settings."
    )
  }
}
