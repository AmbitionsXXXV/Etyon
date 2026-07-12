import { describe, expect, it } from "vite-plus/test"

import {
  AppSettingsSchema,
  UpdateSettingsSchema
} from "../../src/schemas/settings"

describe("AppSettingsSchema", () => {
  it("adds cursor, moonshot, openai and z.ai provider defaults for empty settings", () => {
    const settings = AppSettingsSchema.parse({})

    expect(settings.ai.providers.cursor).toMatchObject({
      apiKey: "",
      baseURL: "",
      enabled: false
    })
    expect(settings.ai.providers.cursor.availableModels).toEqual([])
    expect(settings.ai.providers.cursor.models).toEqual([])
    expect(settings.ai.providers.moonshot).toMatchObject({
      apiKey: "",
      baseURL: "https://api.moonshot.cn/v1",
      enabled: false,
      region: "china"
    })
    expect(settings.ai.providers.moonshot.availableModels).toEqual([])
    expect(settings.ai.providers.moonshot.models).toEqual([])
    expect(settings.ai.providers.openai).toMatchObject({
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      enabled: false
    })
    expect(settings.ai.providers.openai.availableModels).toEqual([])
    expect(settings.ai.providers.openai.models).toEqual([])
    expect(settings.ai.providers["zai-coding-plan"]).toMatchObject({
      apiKey: "",
      baseURL: "https://api.z.ai/api/coding/paas/v4",
      enabled: false
    })
    expect(settings.ai.providers["zai-coding-plan"].availableModels).toEqual([])
    expect(settings.ai.providers["zai-coding-plan"].models).toEqual([])
  })

  it("accepts an explicit openai apiMode override", () => {
    const settings = AppSettingsSchema.parse({
      ai: {
        providers: {
          openai: {
            apiMode: "chat-completions",
            baseURL: "https://openai-gateway.example.com/v1"
          }
        }
      }
    })

    expect(settings.ai.providers.openai.apiMode).toBe("chat-completions")
    expect(settings.ai.providers.openai.baseURL).toBe(
      "https://openai-gateway.example.com/v1"
    )
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
    expect(settings.ai.providers.cursor.enabled).toBe(false)
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
      autoRetrieve: true,
      autoSummarize: false,
      embeddingModel: "",
      enabled: true,
      includeChatbot: true,
      maxContextEntries: 8,
      maxRetrievedMemories: 8,
      memoryToolModel: "__auto__",
      queryRewriting: false,
      shareAcrossProjects: true,
      similarityThreshold: 0.1
    })
  })

  it("adds chat auto compact defaults for empty and legacy settings", () => {
    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.chat).toEqual({
      autoCompact: {
        enabled: true,
        keepRecentMessages: 4,
        threshold: 80
      },
      streamdown: {
        animation: "fade-in"
      }
    })
  })

  it("accepts partial chat streamdown settings updates", () => {
    const update = UpdateSettingsSchema.parse({
      chat: {
        streamdown: {
          animation: "blur-in"
        }
      }
    })

    expect(update.chat).toEqual({
      autoCompact: {
        enabled: true,
        keepRecentMessages: 4,
        threshold: 80
      },
      streamdown: {
        animation: "blur-in"
      }
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

  it("adds disabled agents defaults for empty and legacy settings", () => {
    const settings = AppSettingsSchema.parse({
      theme: "dark"
    })

    expect(settings.agents).toEqual({
      allowSubagentDelegation: false,
      approvals: {
        approvalTtlMs: 604_800_000,
        commandAllowlist: []
      },
      autoLoadWorkspaceRules: true,
      defaultPermissionMode: "default",
      defaultProfileId: "general-purpose",
      enabled: false,
      lsp: {
        diagnosticTimeoutMs: 5000,
        enabled: false,
        initTimeoutMs: 15_000,
        requireSandbox: true
      },
      maxConcurrentSubagents: 2,
      maxSteps: 64,
      maxSubagentSteps: 24,
      maxWorkflowConcurrency: 8,
      profiles: [],
      requireApprovalForWrites: true,
      retry: {
        maxAutomaticRetries: 1,
        retryTransientFailures: true
      },
      rtk: {
        autoRewrite: true
      },
      sandbox: {
        allowNetwork: false,
        autoAllowSandboxedShell: false,
        enabled: false,
        failIfUnavailable: true
      }
    })
  })

  it("accepts partial agents settings updates", () => {
    const update = UpdateSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        maxSteps: 12
      }
    })

    expect(update.agents).toEqual({
      allowSubagentDelegation: false,
      approvals: {
        approvalTtlMs: 604_800_000,
        commandAllowlist: []
      },
      autoLoadWorkspaceRules: true,
      defaultPermissionMode: "default",
      defaultProfileId: "coder",
      enabled: true,
      lsp: {
        diagnosticTimeoutMs: 5000,
        enabled: false,
        initTimeoutMs: 15_000,
        requireSandbox: true
      },
      maxConcurrentSubagents: 2,
      maxSteps: 12,
      maxSubagentSteps: 24,
      maxWorkflowConcurrency: 8,
      profiles: [],
      requireApprovalForWrites: true,
      retry: {
        maxAutomaticRetries: 1,
        retryTransientFailures: true
      },
      rtk: {
        autoRewrite: true
      },
      sandbox: {
        allowNetwork: false,
        autoAllowSandboxedShell: false,
        enabled: false,
        failIfUnavailable: true
      }
    })
  })

  it("accepts HeroUI Pro color schema presets", () => {
    const presets = [
      ["brutalism-dark", "brutalism-light"],
      ["glass-dark", "glass-light"],
      ["mouve-dark", "mouve-light"]
    ] as const

    for (const [darkColorSchema, lightColorSchema] of presets) {
      const settings = AppSettingsSchema.parse({
        darkColorSchema,
        lightColorSchema
      })

      expect(settings.darkColorSchema).toBe(darkColorSchema)
      expect(settings.lightColorSchema).toBe(lightColorSchema)
    }
  })
})
