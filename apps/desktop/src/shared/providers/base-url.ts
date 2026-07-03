export type BaseURLValidationError = "empty" | "invalid" | "unsupportedProtocol"

export const validateBaseURL = (
  baseURL: string
): BaseURLValidationError | null => {
  const trimmedBaseURL = baseURL.trim()

  if (!trimmedBaseURL) {
    return "empty"
  }

  let parsedBaseURL: URL

  try {
    parsedBaseURL = new URL(trimmedBaseURL)
  } catch {
    return "invalid"
  }

  if (
    parsedBaseURL.protocol !== "http:" &&
    parsedBaseURL.protocol !== "https:"
  ) {
    return "unsupportedProtocol"
  }

  return null
}
