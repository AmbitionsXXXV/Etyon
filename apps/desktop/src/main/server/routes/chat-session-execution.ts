// A session's parent read view survives approval continuations. Only one root
// request may use it at a time, including final transcript persistence.
const activeSessions = new Set<string>()

export const runWithChatSessionMutation = async <T>(
  sessionId: string,
  execute: () => Promise<T>
): Promise<{ acquired: false } | { acquired: true; value: T }> => {
  if (activeSessions.has(sessionId)) {
    return { acquired: false }
  }
  activeSessions.add(sessionId)
  try {
    return { acquired: true, value: await execute() }
  } finally {
    activeSessions.delete(sessionId)
  }
}

export const runWithChatSessionExecution = async (
  sessionId: string,
  execute: () => Promise<Response>
): Promise<Response | null> => {
  if (activeSessions.has(sessionId)) {
    return null
  }
  activeSessions.add(sessionId)
  let released = false
  const release = () => {
    if (!released) {
      released = true
      activeSessions.delete(sessionId)
    }
  }
  try {
    const response = await execute()
    if (!response.ok || !response.body) {
      release()
      return response
    }
    const reader = response.body.getReader()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      async cancel() {
        cancelled = true
        // UI stream persistence continues after the client disconnects. Drain
        // it rather than releasing the lease while that root run is still live.
        try {
          while (true) {
            const { done } = await reader.read()
            if (done) {
              break
            }
          }
        } finally {
          release()
        }
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            release()
            if (!cancelled) {
              controller.close()
            }
          } else if (!cancelled) {
            controller.enqueue(value)
          }
        } catch (error) {
          release()
          if (!cancelled) {
            controller.error(error)
          }
        }
      }
    })
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    })
  } catch (error) {
    release()
    throw error
  }
}

export const isChatSessionExecuting = (sessionId: string): boolean =>
  activeSessions.has(sessionId)
