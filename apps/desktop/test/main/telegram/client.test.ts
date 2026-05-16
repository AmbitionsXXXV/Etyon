import { describe, expect, it, vi } from "vite-plus/test"

import { getTelegramBot, toTelegramErrorMessage } from "@/main/telegram/client"

const createTelegramFetch = (payload: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(Response.json(payload, { status })))

describe("telegram client", () => {
  it("normalizes getMe responses into a safe bot connection shape", async () => {
    const fetchFn = createTelegramFetch({
      ok: true,
      result: {
        first_name: "Etyon",
        id: 123,
        is_bot: true,
        username: "etyon_bot"
      }
    })

    await expect(getTelegramBot("123:abc", { fetchFn })).resolves.toEqual({
      firstName: "Etyon",
      id: 123,
      username: "etyon_bot"
    })
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:abc/getMe",
      expect.objectContaining({
        method: "POST"
      })
    )
  })

  it("uses Telegram descriptions as user-facing errors", async () => {
    const fetchFn = createTelegramFetch(
      {
        description: "Unauthorized",
        error_code: 401,
        ok: false
      },
      401
    )

    await expect(getTelegramBot("bad-token", { fetchFn })).rejects.toThrow(
      "Unauthorized"
    )
  })

  it("formats unknown errors without leaking implementation details", () => {
    expect(toTelegramErrorMessage("failed")).toBe("Telegram request failed.")
  })
})
