import { describe, expect, it } from "vite-plus/test"

import { AppSettingsSchema } from "../../src/schemas/settings"

describe("AppSettingsSchema", () => {
  it("adds moonshot and z.ai provider defaults for empty settings", () => {
    const settings = AppSettingsSchema.parse({})

    expect(settings.ai.providers.moonshot).toMatchObject({
      apiKey: "",
      baseURL: "https://api.moonshot.cn/v1",
      enabled: false,
      region: "china"
    })
    expect(settings.ai.providers.moonshot.availableModels).toEqual([])
    expect(settings.ai.providers.moonshot.models).toEqual([])
    expect(settings.ai.providers["zai-coding-plan"]).toMatchObject({
      apiKey: "",
      baseURL: "https://api.z.ai/api/coding/paas/v4",
      enabled: false
    })
    expect(settings.ai.providers["zai-coding-plan"].availableModels).toEqual([])
    expect(settings.ai.providers["zai-coding-plan"].models).toEqual([])
  })

  it("keeps existing provider config while backfilling new provider records", () => {
    const settings = AppSettingsSchema.parse({
      ai: {
        defaultProvider: "openai",
        providers: {
          openai: {
            apiKey: "sk-openai"
          }
        }
      }
    })

    expect(settings.ai.providers.openai.apiKey).toBe("sk-openai")
    expect(settings.ai.providers.moonshot.baseURL).toBe(
      "https://api.moonshot.cn/v1"
    )
    expect(settings.ai.providers.moonshot.region).toBe("china")
    expect(settings.ai.providers["zai-coding-plan"].baseURL).toBe(
      "https://api.z.ai/api/coding/paas/v4"
    )
  })

  it("defaults sidebar mode to simple for empty and legacy settings", () => {
    expect(AppSettingsSchema.parse({}).sidebar.mode).toBe("simple")

    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.sidebar.mode).toBe("simple")
  })

  it("adds disabled telegram bridge defaults for empty and legacy settings", () => {
    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.telegram).toEqual({
      allowedChatIds: "",
      allowedUserIds: "",
      botToken: "",
      botUsername: "",
      defaultModel: "",
      enabled: false,
      requireMentionInGroups: true
    })
  })

  it("adds memory defaults for empty and legacy settings", () => {
    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.memory).toEqual({
      enabled: true,
      includeChatbot: true,
      maxContextEntries: 8,
      shareAcrossProjects: true
    })
  })

  it("adds skills defaults for empty and legacy settings", () => {
    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.skills).toEqual({
      enabled: true,
      includeGlobal: true,
      includeProject: true,
      maxContextSkills: 4
    })
  })
})
