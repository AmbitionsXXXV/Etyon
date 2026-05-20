import { createHash, randomBytes, randomUUID } from "node:crypto"

import type { CursorTokens } from "./types"

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl"
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll"
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key"

interface CursorAuthPollPendingResult {
  status: "pending"
}

interface CursorAuthPollSuccessResult {
  status: "authenticated"
  tokens: CursorTokens
}

interface CursorAuthResponsePayload {
  accessToken: string
  refreshToken: string
}

export interface CursorAuthRequest {
  challenge: string
  loginUrl: string
  requestId: string
  verifier: string
}

export type CursorAuthPollResult =
  | CursorAuthPollPendingResult
  | CursorAuthPollSuccessResult

const createCodeVerifier = (): string => randomBytes(96).toString("base64url")

const createCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url")

const ensureAuthPayload = (payload: unknown): CursorAuthResponsePayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("accessToken" in payload) ||
    !("refreshToken" in payload) ||
    typeof payload.accessToken !== "string" ||
    typeof payload.refreshToken !== "string"
  ) {
    throw new Error("Cursor auth response is missing tokens.")
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken
  }
}

const readResponseError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "")

  return text
    ? `Request failed with status ${response.status}: ${text}`
    : `Request failed with status ${response.status}.`
}

export const generateCursorAuthRequest = (): CursorAuthRequest => {
  const verifier = createCodeVerifier()
  const challenge = createCodeChallenge(verifier)
  const requestId = randomUUID()
  const loginUrl = new URL(CURSOR_LOGIN_URL)

  loginUrl.searchParams.set("challenge", challenge)
  loginUrl.searchParams.set("mode", "login")
  loginUrl.searchParams.set("redirectTarget", "cli")
  loginUrl.searchParams.set("uuid", requestId)

  return {
    challenge,
    loginUrl: loginUrl.toString(),
    requestId,
    verifier
  }
}

export const getCursorTokenExpiry = (token: string): number => {
  try {
    const [, payload] = token.split(".")

    if (!payload) {
      return Date.now() + 3600 * 1000
    }

    const decodedPayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8")
    ) as unknown

    if (
      typeof decodedPayload === "object" &&
      decodedPayload !== null &&
      "exp" in decodedPayload &&
      typeof decodedPayload.exp === "number"
    ) {
      return decodedPayload.exp * 1000 - 5 * 60 * 1000
    }
  } catch {
    return Date.now() + 3600 * 1000
  }

  return Date.now() + 3600 * 1000
}

export const pollCursorAuthOnce = async ({
  requestId,
  verifier
}: {
  requestId: string
  verifier: string
}): Promise<CursorAuthPollResult> => {
  const pollUrl = new URL(CURSOR_POLL_URL)

  pollUrl.searchParams.set("uuid", requestId)
  pollUrl.searchParams.set("verifier", verifier)

  const response = await fetch(pollUrl, {
    headers: {
      Accept: "application/json"
    },
    method: "GET"
  })

  if (response.status === 404) {
    return { status: "pending" }
  }

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = ensureAuthPayload(await response.json())

  return {
    status: "authenticated",
    tokens: {
      accessToken: payload.accessToken,
      expiresAt: getCursorTokenExpiry(payload.accessToken),
      refreshToken: payload.refreshToken
    }
  }
}

export const refreshCursorToken = async (
  refreshToken: string
): Promise<CursorTokens> => {
  const response = await fetch(CURSOR_REFRESH_URL, {
    body: "{}",
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = ensureAuthPayload(await response.json())

  return {
    accessToken: payload.accessToken,
    expiresAt: getCursorTokenExpiry(payload.accessToken),
    refreshToken: payload.refreshToken || refreshToken
  }
}
