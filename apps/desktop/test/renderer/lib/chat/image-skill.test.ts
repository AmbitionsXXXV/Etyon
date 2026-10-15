import { describe, expect, it } from "vite-plus/test"

import {
  getImageSkillModelOptions,
  resolveImageSkillModel,
  shouldSuggestImageSkill
} from "@/renderer/lib/chat/image-skill"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"

const option = (id: string, imageOutput: boolean) => ({
  capabilities: imageOutput ? { imageOutput: true } : {},
  id,
  label: id,
  providerId: "openai" as const,
  providerName: "OpenAI",
  summary: "",
  value: `openai/${id}`
})

const groups = [
  {
    options: [
      option("gpt-chat", false),
      option("image-a", true),
      option("image-b", true)
    ],
    providerId: "openai",
    providerName: "OpenAI"
  }
] as ChatModelGroup[]

describe("shouldSuggestImageSkill", () => {
  it("recognizes image requests in English, Chinese, and Japanese", () => {
    expect(shouldSuggestImageSkill("Draw an app icon with a palm tree")).toBe(
      true
    )
    expect(shouldSuggestImageSkill("generate an image of a fox")).toBe(true)
    expect(shouldSuggestImageSkill("Make a logo for my cafe")).toBe(true)
    expect(shouldSuggestImageSkill("画一张东京夜景海报")).toBe(true)
    expect(shouldSuggestImageSkill("猫のイラストを描いて")).toBe(true)
  })

  it("ignores ordinary coding prompts and near-miss words", () => {
    expect(shouldSuggestImageSkill("Why does the composer wrap?")).toBe(false)
    expect(shouldSuggestImageSkill("Fix the drawer animation")).toBe(false)
    expect(shouldSuggestImageSkill("Fix the render loop in the list")).toBe(
      false
    )
    expect(shouldSuggestImageSkill("Improve first contentful paint")).toBe(
      false
    )
    expect(
      shouldSuggestImageSkill("Fix the logo alignment in the navbar")
    ).toBe(false)
    expect(shouldSuggestImageSkill("这个画面卡顿怎么修")).toBe(false)
  })
})

describe("image skill models", () => {
  it("lists only image-output models", () => {
    expect(getImageSkillModelOptions(groups).map((item) => item.id)).toEqual([
      "image-a",
      "image-b"
    ])
  })

  it("prefers the last pick, then an image-capable chat model, then the first", () => {
    const options = getImageSkillModelOptions(groups)
    expect(
      resolveImageSkillModel({
        options,
        preferredValue: "openai/image-b",
        selectedChatModelValue: "openai/image-a"
      })
    ).toBe("openai/image-b")
    expect(
      resolveImageSkillModel({
        options,
        preferredValue: "openai/gone",
        selectedChatModelValue: "openai/image-b"
      })
    ).toBe("openai/image-b")
    expect(
      resolveImageSkillModel({
        options,
        preferredValue: null,
        selectedChatModelValue: "openai/gpt-chat"
      })
    ).toBe("openai/image-a")
    expect(
      resolveImageSkillModel({
        options: [],
        preferredValue: null,
        selectedChatModelValue: "openai/gpt-chat"
      })
    ).toBeNull()
  })
})
