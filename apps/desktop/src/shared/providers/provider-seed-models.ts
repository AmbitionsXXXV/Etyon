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
  gateway: [],
  moonshot: MOONSHOT_SEED_MODELS,
  openai: [],
  "zai-coding-plan": ZAI_CODING_PLAN_SEED_MODELS
}
