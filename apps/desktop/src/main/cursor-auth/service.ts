import type {
  CursorAuthPollLoginInput,
  CursorAuthPollLoginOutput,
  CursorAuthStartLoginOutput,
  CursorAuthStatusOutput,
  CursorModelsOutput
} from "@etyon/rpc"
import { shell } from "electron"

import { isBuiltInPluginEnabled } from "@/main/plugins/plugin-store"

import { generateCursorAuthRequest, pollCursorAuthOnce } from "./auth"
import { fetchCursorUsableModels } from "./fetch-usable-models"
import { getCursorSeedModels } from "./models"
import {
  clearCursorTokens,
  getCursorTokens,
  getValidCursorAccessToken,
  isCursorTokenStorageEncryptionAvailable,
  saveCursorTokens
} from "./token-store"

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000

interface PendingCursorAuthRequest {
  createdAt: number
  verifier: string
}

const pendingAuthRequests = new Map<string, PendingCursorAuthRequest>()

const prunePendingAuthRequests = (): void => {
  const now = Date.now()

  for (const [requestId, request] of pendingAuthRequests) {
    if (now - request.createdAt > PENDING_AUTH_TTL_MS) {
      pendingAuthRequests.delete(requestId)
    }
  }
}

const toIsoString = (timestamp: number | undefined): string | null =>
  timestamp ? new Date(timestamp).toISOString() : null

const assertCursorAuthPluginEnabled = (): void => {
  if (!isBuiltInPluginEnabled("cursor-auth")) {
    throw new Error("Cursor Auth plugin is disabled.")
  }
}

export const fetchCursorModels = async (): Promise<CursorModelsOutput> => {
  assertCursorAuthPluginEnabled()
  const accessToken = await getValidCursorAccessToken()
  const discovered = await fetchCursorUsableModels(accessToken)

  return {
    models:
      discovered && discovered.length > 0 ? discovered : getCursorSeedModels()
  }
}

export const getCursorAuthStatus = (): CursorAuthStatusOutput => {
  const tokens = getCursorTokens()

  return {
    authenticated: Boolean(tokens?.refreshToken),
    expiresAt: toIsoString(tokens?.expiresAt),
    hasRefreshToken: Boolean(tokens?.refreshToken),
    storageEncryptionAvailable: isCursorTokenStorageEncryptionAvailable()
  }
}

export const logoutCursorAuth = (): CursorAuthStatusOutput => {
  clearCursorTokens()

  return getCursorAuthStatus()
}

export const pollCursorAuthLogin = async ({
  requestId
}: CursorAuthPollLoginInput): Promise<CursorAuthPollLoginOutput> => {
  prunePendingAuthRequests()

  const pendingAuthRequest = pendingAuthRequests.get(requestId)

  if (!pendingAuthRequest) {
    throw new Error("Cursor login request is missing or expired.")
  }

  const result = await pollCursorAuthOnce({
    requestId,
    verifier: pendingAuthRequest.verifier
  })

  if (result.status === "pending") {
    return {
      authenticated: false,
      expiresAt: null,
      status: "pending"
    }
  }

  saveCursorTokens(result.tokens)
  pendingAuthRequests.delete(requestId)

  return {
    authenticated: true,
    expiresAt: toIsoString(result.tokens.expiresAt),
    status: "authenticated"
  }
}

export const startCursorAuthLogin =
  async (): Promise<CursorAuthStartLoginOutput> => {
    assertCursorAuthPluginEnabled()
    prunePendingAuthRequests()

    const authRequest = generateCursorAuthRequest()

    pendingAuthRequests.set(authRequest.requestId, {
      createdAt: Date.now(),
      verifier: authRequest.verifier
    })

    await shell.openExternal(authRequest.loginUrl)

    return {
      loginUrl: authRequest.loginUrl,
      requestId: authRequest.requestId
    }
  }
