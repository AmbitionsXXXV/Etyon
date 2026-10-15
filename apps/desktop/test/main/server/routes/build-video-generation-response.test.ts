import { AppSettingsSchema } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  buildVideoGenerationStreamResponse,
  resolveVideoRequest
} from "@/main/server/routes/build-video-generation-response"

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: false, isMacOS: true, isWindows: false }
}))
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () => process.cwd(),
    getLocale: () => "en-US",
    getPath: () => "/private/tmp/etyon-video-route-test",
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock("@/main/db", () => ({ getDb: () => ({}) }))
vi.mock("@/main/logger", () => ({
  logger: { error: vi.fn(), startEvent: () => ({ end: vi.fn() }) }
}))
vi.mock("@/main/server/lib/video-generation", () => ({
  editAndPersistVideo: vi.fn(),
  generateAndPersistVideo: vi.fn(() =>
    Promise.reject(new Error("The operation was aborted"))
  )
}))

const baseSettings = AppSettingsSchema.parse({})
const settings = {
  ...baseSettings,
  ai: {
    ...baseSettings.ai,
    providers: {
      ...baseSettings.ai.providers,
      amux: {
        ...baseSettings.ai.providers.amux,
        apiKey: "sk-test",
        enabled: true,
        models: [
          { id: "openai/gpt-5.6-sol", name: "gpt-5.6-sol" },
          { id: "bytedance/seedance-2.0", name: "Seedance 2.0" },
          { id: "bytedance/seedance-2.0-fast", name: "Seedance 2.0 Fast" }
        ]
      }
    }
  }
}

const userMessage = (parts: UIMessage["parts"]): UIMessage => ({
  id: "user-1",
  parts,
  role: "user"
})

const choices = {
  duration: 10,
  generateAudio: false,
  imageUse: "ignore",
  model: "amux/bytedance/seedance-2.0-fast",
  ratio: "9:16",
  resolution: "480p"
}

const answeredCard = (output: unknown): UIMessage => ({
  id: "assistant-1",
  parts: [
    { type: "step-start" },
    {
      input: { prompt: "A paper boat in the rain", title: "A paper boat" },
      output,
      state: "output-available",
      toolCallId: "video_options-1",
      type: "tool-video_options"
    }
  ],
  role: "assistant"
})

const withOpenAiAt = (baseURL: string) => ({
  ...settings,
  ai: {
    ...settings.ai,
    providers: {
      ...settings.ai.providers,
      openai: {
        ...settings.ai.providers.openai,
        apiKey: "amux-key",
        baseURL,
        enabled: true,
        models: [{ id: "bytedance/seedance-2.0", name: "Seedance (relay)" }]
      }
    }
  }
})

describe("resolveVideoRequest", () => {
  it("asks for choices on a fresh prompt with the skill on", () => {
    const request = resolveVideoRequest({
      messages: [
        userMessage([
          { text: "A paper boat in the rain", type: "text" },
          {
            mediaType: "image/png",
            type: "file",
            url: "data:image/png;base64,AA=="
          }
        ])
      ],
      settings,
      videoMode: true,
      videoModel: "amux/bytedance/seedance-2.0-fast"
    })

    expect(request).toMatchObject({
      input: {
        defaults: {
          duration: 5,
          imageUse: "first_frame",
          model: "amux/bytedance/seedance-2.0-fast",
          resolution: "720p"
        },
        hasImage: true,
        models: [
          { value: "amux/bytedance/seedance-2.0" },
          { value: "amux/bytedance/seedance-2.0-fast" }
        ],
        prompt: "A paper boat in the rain"
      },
      kind: "options"
    })
  })

  it("falls back to the first video model and ignores a missing image", () => {
    const request = resolveVideoRequest({
      messages: [userMessage([{ text: "Waves", type: "text" }])],
      settings,
      videoMode: true,
      videoModel: "amux/openai/gpt-5.6-sol"
    })

    expect(request).toMatchObject({
      input: {
        defaults: { imageUse: "ignore", model: "amux/bytedance/seedance-2.0" },
        hasImage: false
      },
      kind: "options"
    })
  })

  it("renders on the resume after the card is answered, skill on or off", () => {
    expect(
      resolveVideoRequest({
        messages: [
          userMessage([{ text: "A paper boat in the rain", type: "text" }]),
          answeredCard(choices)
        ],
        settings,
        videoMode: undefined,
        videoModel: undefined
      })
    ).toEqual({
      choices,
      kind: "render",
      prompt: "A paper boat in the rain",
      title: "A paper boat in the rain"
    })
  })

  it("hands back to chat for invalid answers, skill off, or no video model", () => {
    expect(
      resolveVideoRequest({
        messages: [
          answeredCard({ ...choices, model: "amux/openai/gpt-5.6-sol" })
        ],
        settings,
        videoMode: true,
        videoModel: undefined
      })
    ).toBeNull()
    expect(
      resolveVideoRequest({
        messages: [answeredCard({ ...choices, duration: 7 })],
        settings,
        videoMode: true,
        videoModel: undefined
      })
    ).toBeNull()
    expect(
      resolveVideoRequest({
        messages: [userMessage([{ text: "Hi", type: "text" }])],
        settings,
        videoMode: false,
        videoModel: undefined
      })
    ).toBeNull()
    expect(
      resolveVideoRequest({
        messages: [userMessage([{ text: "Hi", type: "text" }])],
        settings: baseSettings,
        videoMode: true,
        videoModel: undefined
      })
    ).toBeNull()
  })
})

const renderOnce = (abortSignal: AbortSignal): Promise<string> => {
  const response = buildVideoGenerationStreamResponse({
    abortSignal,
    chatModelId: null,
    messages: [userMessage([{ text: "Waves", type: "text" }])],
    onFinishPersist: () => Promise.resolve(),
    projectPath: "/projects/demo",
    request: {
      choices: { ...choices, imageUse: "ignore" } as never,
      kind: "render",
      prompt: "Waves",
      title: "Waves"
    },
    requestStartedAt: 0,
    sessionId: "session-1"
  })

  return response.text()
}

describe("buildVideoGenerationStreamResponse", () => {
  it("leaves the render part waiting when the request went away", async () => {
    const controller = new AbortController()

    controller.abort()

    const body = await renderOnce(controller.signal)

    expect(body).toContain("tool-input-available")
    expect(body).not.toContain("tool-output-error")
  })

  it("reports a real failure on the part", async () => {
    const body = await renderOnce(new AbortController().signal)

    expect(body).toContain("tool-output-error")
  })
})

describe("resolveVideoRequest on an OpenAI provider", () => {
  it("offers its Seedance models when its base URL is amux", () => {
    const request = resolveVideoRequest({
      messages: [userMessage([{ text: "Waves", type: "text" }])],
      settings: withOpenAiAt("https://gateway.amux.ai/v1"),
      videoMode: true,
      videoModel: "openai/bytedance/seedance-2.0"
    })

    expect(request).toMatchObject({
      input: {
        defaults: { model: "openai/bytedance/seedance-2.0" },
        models: expect.arrayContaining([
          { label: "Seedance (relay)", value: "openai/bytedance/seedance-2.0" }
        ])
      },
      kind: "options"
    })
  })

  it("leaves it out when the base URL is not amux", () => {
    const request = resolveVideoRequest({
      messages: [userMessage([{ text: "Waves", type: "text" }])],
      settings: withOpenAiAt("https://api.openai.com/v1"),
      videoMode: true,
      videoModel: "openai/bytedance/seedance-2.0"
    })

    expect(request).toMatchObject({
      input: { defaults: { model: "amux/bytedance/seedance-2.0" } }
    })
    expect(
      request?.kind === "options" &&
        request.input.models.some((model) => model.value.startsWith("openai/"))
    ).toBe(false)
  })
})

const assistantCard = (
  type: string,
  input: unknown,
  output: unknown
): UIMessage => ({
  id: "assistant-1",
  parts: [
    {
      input,
      output,
      state: "output-available",
      toolCallId: "c-1",
      type: type as `tool-${string}`
    }
  ],
  role: "assistant"
})

const storyboardChoices = { ...choices, shots: 3 }
const plan = {
  keyframes: [
    { prompt: "k0" },
    { prompt: "k1" },
    { prompt: "k2" },
    { prompt: "k3" }
  ],
  shots: [{ prompt: "s1" }, { prompt: "s2" }, { prompt: "s3" }],
  style: "watercolor"
}
const frame = (key: string, variant: number) => ({
  path: `generated-frames/${key}-${variant}.png`,
  url: `https://cdn.amux.ai/${key}-${variant}.png`
})
const keyframes = ["k0", "k1", "k2", "k3"].map((key) => ({
  frames: [0, 1, 2].map((variant) => frame(key, variant)),
  prompt: key
}))

describe("resolveVideoRequest for a storyboard", () => {
  it("plans when the choices card asks for more than one shot", () => {
    expect(
      resolveVideoRequest({
        messages: [
          userMessage([{ text: "A paper boat", type: "text" }]),
          answeredCard(storyboardChoices)
        ],
        settings,
        videoMode: undefined,
        videoModel: undefined
      })
    ).toMatchObject({
      kind: "storyboard-plan",
      prompt: "A paper boat in the rain"
    })
  })

  it("makes keyframes from the approved plan", () => {
    expect(
      resolveVideoRequest({
        messages: [
          assistantCard(
            "tool-storyboard_plan",
            { choices: storyboardChoices, plan, prompt: "Boat", title: "Boat" },
            { plan }
          )
        ],
        settings,
        videoMode: undefined,
        videoModel: undefined
      })
    ).toMatchObject({ kind: "storyboard-keyframes", plan, title: "Boat" })
  })

  it("renders clips from one valid pick per keyframe", () => {
    const request = resolveVideoRequest({
      messages: [
        assistantCard(
          "tool-storyboard_curate",
          {
            choices: storyboardChoices,
            keyframes,
            plan,
            prompt: "Boat",
            title: "Boat"
          },
          { picks: [0, 2, 1, 0] }
        )
      ],
      settings,
      videoMode: undefined,
      videoModel: undefined
    })

    expect(request).toMatchObject({
      frames: [frame("k0", 0), frame("k1", 2), frame("k2", 1), frame("k3", 0)],
      kind: "storyboard-clips"
    })
  })

  it("refuses picks that miss a keyframe or name no variant", () => {
    for (const picks of [
      [0, 1, 2],
      [0, 1, 2, 7]
    ]) {
      expect(
        resolveVideoRequest({
          messages: [
            assistantCard(
              "tool-storyboard_curate",
              {
                choices: storyboardChoices,
                keyframes,
                plan,
                prompt: "Boat",
                title: "Boat"
              },
              { picks }
            )
          ],
          settings,
          videoMode: undefined,
          videoModel: undefined
        })
      ).toBeNull()
    }
  })
})

describe("resolveVideoRequest for Edit / Extend", () => {
  const edit = {
    mode: "extend",
    sourceTitle: "Paper boat",
    sourceToolCallId: "videogen-1"
  }

  it("turns a clip-card request into an edit of that clip", () => {
    expect(
      resolveVideoRequest({
        messages: [
          userMessage([{ text: "It drifts into the drain", type: "text" }])
        ],
        settings,
        videoEdit: { ...edit, duration: 4 },
        videoMode: undefined,
        videoModel: undefined
      })
    ).toEqual({
      edit: { ...edit, duration: 4 },
      kind: "edit",
      prompt: "It drifts into the drain",
      title: "Extended: Paper boat"
    })
  })

  it("ignores malformed edits and empty instructions", () => {
    expect(
      resolveVideoRequest({
        messages: [userMessage([{ text: "Hi", type: "text" }])],
        settings,
        videoEdit: { mode: "remix", sourceToolCallId: "x" },
        videoMode: false,
        videoModel: undefined
      })
    ).toBeNull()
    expect(
      resolveVideoRequest({
        messages: [userMessage([{ text: "  ", type: "text" }])],
        settings,
        videoEdit: edit,
        videoMode: false,
        videoModel: undefined
      })
    ).toBeNull()
  })
})
