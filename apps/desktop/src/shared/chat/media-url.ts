/**
 * Generated videos play from the session's project through
 * `etyon-media://session/<sessionId>/<project-relative path>`: a streaming
 * protocol (the `data:` URI route images take caps at 16MB and cannot seek).
 * The main process looks the project up by session id and serves only files
 * under generated-videos/.
 *
 * Pure (no electron, no fs) so both processes and node tests share it.
 */

export const MEDIA_PROTOCOL_SCHEME = "etyon-media"

const MEDIA_URL_HOST = "session"
const MEDIA_URL_PREFIX = `${MEDIA_PROTOCOL_SCHEME}://${MEDIA_URL_HOST}/`

export const buildMediaUrl = ({
  path,
  sessionId
}: {
  path: string
  sessionId: string
}): string =>
  `${MEDIA_URL_PREFIX}${encodeURIComponent(sessionId)}/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`

export const parseMediaUrl = (
  url: string
): { relativePath: string; sessionId: string } | null => {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (
    parsed.protocol !== `${MEDIA_PROTOCOL_SCHEME}:` ||
    parsed.hostname !== MEDIA_URL_HOST
  ) {
    return null
  }

  const [encodedSessionId, ...segments] = parsed.pathname
    .replace(/^\/+/u, "")
    .split("/")

  if (!encodedSessionId || segments.length === 0) {
    return null
  }

  try {
    return {
      relativePath: segments
        .map((segment) => decodeURIComponent(segment))
        .join("/"),
      sessionId: decodeURIComponent(encodedSessionId)
    }
  } catch {
    return null
  }
}
