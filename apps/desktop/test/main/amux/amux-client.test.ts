import { describe, expect, it, vi } from "vite-plus/test"

import {
  AmuxApiError,
  buildSeedanceTaskBody,
  createAmuxClient,
  parseAmuxTask,
  resolveAmuxEndpoints,
  waitForAmuxTask
} from "@/main/amux/amux-client"
import type { AmuxTask } from "@/main/amux/amux-client"

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

const pendingTask = (status: AmuxTask["status"]): AmuxTask => ({
  id: "t-1",
  imageUrls: [],
  status,
  videoUrls: []
})

describe("resolveAmuxEndpoints", () => {
  it("keeps tasks under /v1 and Seedance under the origin's /api/v3", () => {
    const endpoints = resolveAmuxEndpoints("https://gateway.amux.ai/v1/")

    expect(endpoints.tasks).toBe("https://gateway.amux.ai/v1/tasks")
    expect(endpoints.task("t 1")).toBe("https://gateway.amux.ai/v1/tasks/t%201")
    expect(endpoints.seedanceTasks).toBe(
      "https://gateway.amux.ai/api/v3/contents/generations/tasks"
    )
  })
})

describe("buildSeedanceTaskBody", () => {
  const base = {
    duration: 5,
    generateAudio: true,
    model: "bytedance/seedance-2.0",
    prompt: "A paper boat",
    ratio: "16:9" as const,
    resolution: "720p" as const
  }

  it("gives every frame an explicit role and never sends a seed", () => {
    const body = buildSeedanceTaskBody({
      ...base,
      firstFrameUrl: "https://cdn.amux.ai/a.png",
      lastFrameUrl: "https://cdn.amux.ai/b.png"
    })

    expect(body).toEqual({
      content: [
        { text: "A paper boat", type: "text" },
        {
          image_url: { url: "https://cdn.amux.ai/a.png" },
          role: "first_frame",
          type: "image_url"
        },
        {
          image_url: { url: "https://cdn.amux.ai/b.png" },
          role: "last_frame",
          type: "image_url"
        }
      ],
      duration: 5,
      generate_audio: true,
      model: "bytedance/seedance-2.0",
      ratio: "16:9",
      resolution: "720p"
    })
    expect(body).not.toHaveProperty("seed")
  })

  it("drops references when frames are present (amux rejects the mix)", () => {
    const body = buildSeedanceTaskBody({
      ...base,
      firstFrameUrl: "https://cdn.amux.ai/a.png",
      referenceImageUrls: ["https://cdn.amux.ai/ref.png"]
    })

    expect(body.content.map((item) => item.role)).toEqual([
      undefined,
      "first_frame"
    ])
  })

  it("sends references when there are no frames", () => {
    const body = buildSeedanceTaskBody({
      ...base,
      referenceImageUrls: ["https://cdn.amux.ai/ref.png"]
    })

    expect(body.content.at(-1)).toMatchObject({ role: "reference_image" })
  })

  it("forces adaptive on Seedance 2.5 with frames only", () => {
    expect(
      buildSeedanceTaskBody({
        ...base,
        firstFrameUrl: "https://cdn.amux.ai/a.png",
        model: "bytedance/seedance-2.5"
      }).ratio
    ).toBe("adaptive")
    expect(
      buildSeedanceTaskBody({ ...base, model: "bytedance/seedance-2.5" }).ratio
    ).toBe("16:9")
  })
})

describe("buildSeedanceTaskBody for edit and extend", () => {
  it("sends the clip as a reference video with the omni task type", () => {
    const body = buildSeedanceTaskBody({
      duration: -1,
      generateAudio: true,
      model: "bytedance/seedance-2.5",
      prompt: "Make it night",
      ratio: "16:9",
      referenceVideoUrls: ["https://cdn.amux.ai/clip.mp4"],
      resolution: "720p",
      taskType: "edit"
    })

    expect(body).toMatchObject({
      content: [
        { text: "Make it night", type: "text" },
        {
          role: "reference_video",
          type: "video_url",
          video_url: { url: "https://cdn.amux.ai/clip.mp4" }
        }
      ],
      duration: -1,
      omni_reference_task_type: "edit",
      ratio: "adaptive"
    })
  })
})

describe("parseAmuxTask", () => {
  it("reads the unified task: outputs, cost, and error", () => {
    expect(
      parseAmuxTask({
        cost: "0.2108",
        id: "task-1",
        model: "bytedance/seedance-2.0",
        output: { videos: [{ index: 0, url: "https://cdn.amux.ai/v.mp4" }] },
        status: "succeeded"
      })
    ).toEqual({
      cost: "0.2108",
      id: "task-1",
      imageUrls: [],
      model: "bytedance/seedance-2.0",
      status: "succeeded",
      videoUrls: ["https://cdn.amux.ai/v.mp4"]
    })
    expect(
      parseAmuxTask({
        error: { code: "x", message: "refused" },
        id: "task-2",
        status: "failed"
      })
    ).toMatchObject({ error: "refused", status: "failed" })
  })

  it("reads the Ark alias and both cancel spellings", () => {
    expect(
      parseAmuxTask({
        content: { video_url: "https://cdn.amux.ai/v.mp4" },
        id: "task-3",
        status: "cancelled"
      })
    ).toMatchObject({
      status: "canceled",
      videoUrls: ["https://cdn.amux.ai/v.mp4"]
    })
  })

  it("rejects a body without an id", () => {
    expect(() => parseAmuxTask({ status: "queued" })).toThrow()
  })
})

describe("createAmuxClient", () => {
  it("posts Seedance JSON with the Bearer key and returns the task id", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ id: "cgt-1" })))
    const client = createAmuxClient({
      apiKey: "key-1",
      baseURL: "https://gateway.amux.ai/v1",
      fetch
    })

    await expect(
      client.createSeedanceTask({
        duration: 5,
        generateAudio: false,
        model: "bytedance/seedance-2.0-fast",
        prompt: "Waves",
        ratio: "9:16",
        resolution: "480p"
      })
    ).resolves.toBe("cgt-1")

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]

    expect(url).toBe(
      "https://gateway.amux.ai/api/v3/contents/generations/tasks"
    )
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({ Authorization: "Bearer key-1" })
    expect(JSON.parse(String(init.body))).toMatchObject({
      generate_audio: false,
      model: "bytedance/seedance-2.0-fast",
      ratio: "9:16"
    })
  })

  it("sends reference images as multipart files", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: "img-1" }, 202))
    )
    const client = createAmuxClient({
      apiKey: "key-1",
      baseURL: "https://gateway.amux.ai/v1",
      fetch
    })

    await client.createImageTask({
      images: [
        {
          bytes: new Uint8Array([1, 2]),
          fileName: "f.png",
          mediaType: "image/png"
        }
      ],
      model: "openai/gpt-image-2",
      prompt: "Keep it"
    })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const form = init.body as FormData

    expect(url).toBe("https://gateway.amux.ai/v1/tasks")
    expect(form.get("model")).toBe("openai/gpt-image-2")
    expect(form.getAll("image")).toHaveLength(1)
  })

  it("turns a 402 into a balance error carrying the status", async () => {
    const client = createAmuxClient({
      apiKey: "key-1",
      baseURL: "https://gateway.amux.ai/v1",
      fetch: () =>
        Promise.resolve(
          jsonResponse({ error: { message: "insufficient balance" } }, 402)
        )
    })

    const failure = client.getTask("t-1")

    await expect(failure).rejects.toBeInstanceOf(AmuxApiError)
    await expect(failure).rejects.toThrow(/balance is too low/u)
  })
})

describe("waitForAmuxTask", () => {
  it("waits 20 s before the first video poll, then 12 s, until terminal", async () => {
    const statuses = [
      pendingTask("queued"),
      pendingTask("running"),
      pendingTask("succeeded")
    ]
    const getTask = vi.fn(() =>
      Promise.resolve(statuses.shift() ?? pendingTask("failed"))
    )
    const sleep = vi.fn((_ms: number) => Promise.resolve())
    const onUpdate = vi.fn()

    const finished = await waitForAmuxTask({
      client: { getTask },
      id: "t-1",
      kind: "video",
      onUpdate,
      sleep
    })

    expect(finished.status).toBe("succeeded")
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20_000, 12_000, 12_000])
    expect(onUpdate).toHaveBeenCalledTimes(3)
  })

  it("polls images every 3 s", async () => {
    const statuses = [pendingTask("running"), pendingTask("succeeded")]
    const sleep = vi.fn((_ms: number) => Promise.resolve())

    await waitForAmuxTask({
      client: {
        getTask: () =>
          Promise.resolve(statuses.shift() ?? pendingTask("failed"))
      },
      id: "t-1",
      kind: "image",
      sleep
    })

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 3000])
  })
})
