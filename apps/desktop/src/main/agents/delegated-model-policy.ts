import path from "node:path"

import type {
  GenerateTextOnStepEndCallback,
  PrepareStepFunction,
  ToolSet
} from "ai"
import { app } from "electron"

import { recordAgentRunStep } from "@/main/agents/agent-event-store"
import {
  getFixedContextCost,
  prepareBudgetedContext
} from "@/main/agents/context-budget"
import { createWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getAppConfigDir } from "@/main/app-paths"
import { getDb } from "@/main/db"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { resolveModelContextWindow } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"

export const buildDelegatedModelPolicy = async ({
  childRunId,
  configProjectPath,
  instructions,
  modelId,
  projectPath,
  sessionId,
  tools
}: {
  childRunId?: string
  configProjectPath?: string
  instructions: string
  modelId: string | null
  projectPath: string
  sessionId?: string
  tools: ToolSet
}): Promise<{
  instructions: string
  maxOutputTokens?: number
  onStepEnd: GenerateTextOnStepEndCallback<ToolSet>
  prepareStep?: PrepareStepFunction<ToolSet>
}> => {
  const { agents } = getSettings()
  const rules = agents.autoLoadWorkspaceRules
    ? await createWorkspaceCore(
        configProjectPath ?? projectPath
      ).readWorkspaceRules()
    : null
  const effectiveInstructions = rules
    ? `${instructions}\n\nWorkspace rules (${rules.relativePath}):\n${rules.content}`
    : instructions
  const budget = agents.contextBudget
    ? {
        ...agents.contextBudget,
        contextWindow: resolveModelContextWindow(modelId)
      }
    : null
  const fixedCost = budget
    ? await getFixedContextCost(effectiveInstructions, tools)
    : 0
  let stepIndex = 0
  const onStepEnd: GenerateTextOnStepEndCallback<ToolSet> = async (step) => {
    stepIndex += 1
    if (!childRunId) {
      return
    }
    try {
      await runExclusiveDbWrite(
        async () =>
          await recordAgentRunStep({
            db: getDb(),
            runId: childRunId,
            step: {
              cachedInputTokens: step.usage.inputTokenDetails?.cacheReadTokens,
              finishReason: step.finishReason,
              inputTokens: step.usage.inputTokens,
              outputTokens: step.usage.outputTokens,
              stepIndex,
              toolCallCount: step.toolCalls.length
            }
          })
      )
    } catch (error) {
      logger.error("delegated_step_usage_record_failed", { error })
    }
  }
  const prepareStep: PrepareStepFunction<ToolSet> | undefined =
    budget && sessionId
      ? async ({ messages }) => {
          const prepared = await prepareBudgetedContext(
            messages,
            fixedCost,
            budget,
            {
              sessionId,
              storageRoot: path.join(
                getAppConfigDir(app.getPath("home")),
                "tool-results"
              )
            }
          )
          return { messages: prepared.messages }
        }
      : undefined
  return {
    instructions: effectiveInstructions,
    maxOutputTokens: budget?.reserveOutputTokens,
    onStepEnd,
    prepareStep
  }
}
