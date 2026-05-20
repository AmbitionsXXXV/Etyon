import type { BuiltInProviderId, StoredProviderModel } from "@etyon/rpc"

const MOONSHOT_SEED_MODELS: StoredProviderModel[] = [
  {
    capabilities: {
      contextWindow: 262_144,
      functionCalling: true,
      imageOutput: false,
      jsonMode: false,
      maxOutputTokens: 32_768,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "kimi-k2.5",
    isManual: undefined,
    name: "kimi-k2.5"
  }
]

export const CURSOR_PROVIDER_SEED_MODELS: StoredProviderModel[] = [
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "auto",
    isManual: undefined,
    name: "Auto"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "composer-2",
    isManual: undefined,
    name: "Composer 2"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "claude-4.5-sonnet",
    isManual: undefined,
    name: "Claude 4.5 Sonnet"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "claude-4-sonnet",
    isManual: undefined,
    name: "Claude 4 Sonnet"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "gpt-5",
    isManual: undefined,
    name: "GPT-5"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "gpt-5-codex",
    isManual: undefined,
    name: "GPT-5 Codex"
  },
  {
    capabilities: {
      functionCalling: true,
      streaming: true,
      vision: true
    },
    id: "gpt-4.1",
    isManual: undefined,
    name: "GPT-4.1"
  },
  {
    capabilities: {
      functionCalling: true,
      reasoning: true,
      streaming: true,
      vision: true
    },
    id: "gemini-2.5-pro",
    isManual: undefined,
    name: "Gemini 2.5 Pro"
  },
  {
    capabilities: {
      functionCalling: true,
      streaming: true
    },
    id: "cursor-small",
    isManual: undefined,
    name: "Cursor Small"
  }
]

const ZAI_CODING_PLAN_SEED_MODELS: StoredProviderModel[] = [
  {
    capabilities: {
      contextWindow: 202_752,
      functionCalling: true,
      imageOutput: false,
      jsonMode: false,
      maxOutputTokens: 16_384,
      reasoning: true,
      streaming: true,
      vision: false
    },
    id: "glm-5",
    isManual: undefined,
    name: "glm-5"
  },
  {
    capabilities: {
      contextWindow: 200_000,
      functionCalling: true,
      imageOutput: false,
      jsonMode: true,
      maxOutputTokens: 131_072,
      reasoning: true,
      streaming: true,
      vision: false
    },
    id: "glm-5-turbo",
    isManual: undefined,
    name: "glm-5-turbo"
  },
  {
    capabilities: {
      contextWindow: 198_000,
      functionCalling: true,
      imageOutput: false,
      jsonMode: false,
      maxOutputTokens: 198_000,
      reasoning: true,
      streaming: true,
      vision: false
    },
    id: "glm-4.7",
    isManual: undefined,
    name: "glm-4.7"
  }
]

export const BUILT_IN_PROVIDER_SEED_MODELS: Record<
  BuiltInProviderId,
  StoredProviderModel[]
> = {
  anthropic: [],
  cursor: CURSOR_PROVIDER_SEED_MODELS,
  gateway: [],
  moonshot: MOONSHOT_SEED_MODELS,
  openai: [],
  "zai-coding-plan": ZAI_CODING_PLAN_SEED_MODELS
}
