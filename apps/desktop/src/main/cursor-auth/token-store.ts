import { app, safeStorage } from "electron"
import ElectronStore from "electron-store"

import { getAppConfigDir } from "@/main/app-paths"

import { refreshCursorToken } from "./auth"
import type { CursorTokens } from "./types"

const CURSOR_AUTH_STORE_NAME = "cursor-auth"
const SETTINGS_DIR = getAppConfigDir(app.getPath("home"))

interface StoredCursorTokens {
  encrypted: boolean
  value: string
}

const store = new ElectronStore<{ tokens?: StoredCursorTokens }>({
  cwd: SETTINGS_DIR,
  name: CURSOR_AUTH_STORE_NAME
})

let cachedTokens: CursorTokens | null | undefined
let refreshPromise: Promise<CursorTokens> | null = null

const isStoredCursorTokens = (value: unknown): value is StoredCursorTokens =>
  typeof value === "object" &&
  value !== null &&
  "encrypted" in value &&
  "value" in value &&
  typeof value.encrypted === "boolean" &&
  typeof value.value === "string"

const isCursorTokens = (value: unknown): value is CursorTokens =>
  typeof value === "object" &&
  value !== null &&
  "accessToken" in value &&
  "expiresAt" in value &&
  "refreshToken" in value &&
  typeof value.accessToken === "string" &&
  typeof value.expiresAt === "number" &&
  typeof value.refreshToken === "string"

const decodeStoredTokens = (storedTokens: StoredCursorTokens): CursorTokens => {
  const serializedTokens = storedTokens.encrypted
    ? safeStorage.decryptString(Buffer.from(storedTokens.value, "base64"))
    : storedTokens.value
  const tokens = JSON.parse(serializedTokens) as unknown

  if (!isCursorTokens(tokens)) {
    throw new Error("Stored Cursor tokens are invalid.")
  }

  return tokens
}

const encodeStoredTokens = (tokens: CursorTokens): StoredCursorTokens => {
  const serializedTokens = JSON.stringify(tokens)

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: false,
      value: serializedTokens
    }
  }

  return {
    encrypted: true,
    value: safeStorage.encryptString(serializedTokens).toString("base64")
  }
}

export const clearCursorTokens = (): void => {
  cachedTokens = null
  refreshPromise = null
  store.delete("tokens")
}

export const getCursorTokens = (): CursorTokens | null => {
  if (cachedTokens !== undefined) {
    return cachedTokens
  }

  const storedTokens = store.get("tokens")

  if (!isStoredCursorTokens(storedTokens)) {
    cachedTokens = null
    return cachedTokens
  }

  try {
    cachedTokens = decodeStoredTokens(storedTokens)
  } catch {
    clearCursorTokens()
  }

  return cachedTokens ?? null
}

export const saveCursorTokens = (tokens: CursorTokens): void => {
  cachedTokens = tokens
  store.set("tokens", encodeStoredTokens(tokens))
}

export const getValidCursorAccessToken = async (): Promise<string> => {
  const tokens = getCursorTokens()

  if (!tokens?.refreshToken) {
    throw new Error("Cursor is not authenticated.")
  }

  if (Date.now() < tokens.expiresAt) {
    return tokens.accessToken
  }

  if (refreshPromise) {
    const refreshedTokens = await refreshPromise

    return refreshedTokens.accessToken
  }

  refreshPromise = refreshCursorToken(tokens.refreshToken)

  try {
    const refreshedTokens = await refreshPromise

    saveCursorTokens(refreshedTokens)

    return refreshedTokens.accessToken
  } catch (error) {
    clearCursorTokens()
    throw new Error("Cursor token refresh failed. Please login again.", {
      cause: error
    })
  } finally {
    refreshPromise = null
  }
}

export const isCursorTokenStorageEncryptionAvailable = (): boolean =>
  safeStorage.isEncryptionAvailable()
