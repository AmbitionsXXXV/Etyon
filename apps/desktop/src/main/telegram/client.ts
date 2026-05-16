const TELEGRAM_API_BASE_URL = "https://api.telegram.org"

export interface TelegramBotConnection {
  firstName: string
  id: number
  username?: string
}

interface TelegramApiResponse<T> {
  description?: string
  error_code?: number
  ok: boolean
  result?: T
}

interface TelegramApiUser {
  first_name: string
  id: number
  is_bot: boolean
  username?: string
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

interface TelegramRequestOptions {
  body?: Record<string, unknown>
  botToken: string
  fetchFn?: FetchLike
  method: string
  signal?: AbortSignal
}

const parseTelegramResponse = <T>(payload: unknown): TelegramApiResponse<T> => {
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error("Telegram returned an invalid response.")
  }

  return payload as TelegramApiResponse<T>
}

const buildTelegramMethodUrl = (botToken: string, method: string): string =>
  `${TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`

const requestTelegram = async <T>({
  body,
  botToken,
  fetchFn = fetch,
  method,
  signal
}: TelegramRequestOptions): Promise<T> => {
  const trimmedToken = botToken.trim()

  if (!trimmedToken) {
    throw new Error("Telegram bot token is required.")
  }

  const response = await fetchFn(buildTelegramMethodUrl(trimmedToken, method), {
    body: JSON.stringify(body ?? {}),
    headers: {
      "content-type": "application/json"
    },
    method: "POST",
    signal
  })
  const payload = parseTelegramResponse<T>(await response.json())

  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description || `Telegram request failed: ${method}`)
  }

  return payload.result
}

export const getTelegramBot = async (
  botToken: string,
  options: {
    fetchFn?: FetchLike
    signal?: AbortSignal
  } = {}
): Promise<TelegramBotConnection> => {
  const user = await requestTelegram<TelegramApiUser>({
    botToken,
    fetchFn: options.fetchFn,
    method: "getMe",
    signal: options.signal
  })

  return {
    firstName: user.first_name,
    id: user.id,
    username: user.username
  }
}

export const toTelegramErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Telegram request failed."
