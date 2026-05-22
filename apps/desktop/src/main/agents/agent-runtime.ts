import type { AppSettings } from "@etyon/rpc"
import type { LanguageModel, ModelMessage } from "ai"
import { generateText, stepCountIs, streamText } from "ai"

import {
  createAgentRun,
  recordAgentToolCall,
  updateAgentRun,
  updateAgentToolCall
} from "@/main/agents/agent-event-store"
import { resolveActiveAgentProfile } from "@/main/agents/profiles"
import { buildAgentTools } from "@/main/agents/tool-registry"
import type { ExecuteAgentDelegation } from "@/main/agents/tool-registry"
import type { AppDatabase } from "@/main/db"

export interface StreamAgentChatOptions {
  db: AppDatabase
  messages: ModelMessage[]
  model: LanguageModel
  modelId?: string | null
  projectPath: string
  sessionId: string
  settings: AppSettings
  systemPrompts: string[]
}

interface AgentToolCallEvent {
  toolCall: {
    input: unknown
    toolCallId: string
    toolName: string
  }
}

interface AgentToolCallFinishEvent extends AgentToolCallEvent {
  error?: unknown
  output?: unknown
  success: boolean
}

interface AgentToolLifecycleHandlers {
  onToolCallFinish: (event: AgentToolCallFinishEvent) => Promise<void>
  onToolCallStart: (event: AgentToolCallEvent) => Promise<void>
}

const DELEGATION_SUMMARY_MAX_CHARS = 6_000

const buildAgentSystemPrompt = ({
  profileId,
  toolNames
}: {
  profileId: string
  toolNames: string[]
}): string =>
  [
    `Active agent profile: ${profileId}.`,
    `Available agent tools: ${toolNames.length > 0 ? toolNames.join(", ") : "none"}.`,
    "Use tools only when they reduce uncertainty. Keep the final response concise and grounded in tool results."
  ].join("\n")

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const clampDelegationSummary = (
  text: string
): {
  summary: string
  truncated: boolean
} => ({
  summary: text.slice(0, DELEGATION_SUMMARY_MAX_CHARS),
  truncated: text.length > DELEGATION_SUMMARY_MAX_CHARS
})

const buildDelegationPrompt = ({
  context,
  expectedOutput,
  task
}: {
  context: string
  expectedOutput: string
  task: string
}): string =>
  [
    "You are a delegated child agent. Work only on the bounded task below.",
    "Do not assume access to the parent conversation beyond the provided context.",
    "Return a concise summary with concrete evidence and any remaining uncertainty.",
    "",
    `Task:\n${task}`,
    context ? `Context:\n${context}` : "",
    expectedOutput ? `Expected output:\n${expectedOutput}` : ""
  ]
    .filter(Boolean)
    .join("\n\n")

const createAgentToolLifecycleHandlers = ({
  db,
  parentToolCallId = null,
  run
}: {
  db: AppDatabase
  parentToolCallId?: string | null
  run: Awaited<ReturnType<typeof createAgentRun>>
}): AgentToolLifecycleHandlers => {
  const parentToolPayload = parentToolCallId ? { parentToolCallId } : {}
  const onToolCallStart = async ({
    toolCall
  }: AgentToolCallEvent): Promise<void> => {
    await recordAgentToolCall({
      approvalState: "not_required",
      db,
      id: toolCall.toolCallId,
      input: toolCall.input,
      ...parentToolPayload,
      runId: run.id,
      state: "running",
      toolName: toolCall.toolName
    })
    await run.appendEvent({
      payload: {
        input: toolCall.input,
        ...parentToolPayload,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName
      },
      type: "tool_call_started"
    })
  }

  const onToolCallFinish = async ({
    error,
    output,
    success,
    toolCall
  }: AgentToolCallFinishEvent): Promise<void> => {
    if (success) {
      await updateAgentToolCall({
        db,
        id: toolCall.toolCallId,
        output,
        state: "finished"
      })
      await run.appendEvent({
        payload: {
          output,
          ...parentToolPayload,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        },
        type: "tool_call_finished"
      })
      return
    }

    await updateAgentToolCall({
      db,
      errorMessage: getErrorMessage(error),
      id: toolCall.toolCallId,
      state: "failed"
    })
    await run.appendEvent({
      payload: {
        error: getErrorMessage(error),
        ...parentToolPayload,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName
      },
      type: "tool_call_failed"
    })
  }

  return {
    onToolCallFinish,
    onToolCallStart
  }
}

export const streamAgentChat = async ({
  db,
  messages,
  model,
  modelId = null,
  projectPath,
  sessionId,
  settings,
  systemPrompts
}: StreamAgentChatOptions): Promise<ReturnType<typeof streamText>> => {
  if (!settings.agents.enabled) {
    return streamText({
      ...(systemPrompts.length > 0
        ? { system: systemPrompts.join("\n\n") }
        : {}),
      messages,
      model
    })
  }

  const profile = resolveActiveAgentProfile(settings.agents)
  const run = await createAgentRun({
    chatSessionId: sessionId,
    db,
    modelId,
    profileId: profile.id
  })
  let activeSubagentCount = 0
  const executeDelegation: ExecuteAgentDelegation = async ({
    abortSignal,
    input,
    parentToolCallId,
    profileId
  }) => {
    const childProfile = resolveActiveAgentProfile(settings.agents, profileId)

    if (childProfile.id !== profileId) {
      return {
        profileId,
        runId: null,
        status: "rejected",
        summary: `Agent profile is unavailable: ${profileId}`,
        truncated: false
      }
    }

    if (activeSubagentCount >= settings.agents.maxConcurrentSubagents) {
      return {
        profileId,
        runId: null,
        status: "rejected",
        summary: "Sub-agent concurrency budget is exhausted.",
        truncated: false
      }
    }

    activeSubagentCount += 1

    const childRun = await createAgentRun({
      chatSessionId: sessionId,
      db,
      modelId,
      parentRunId: run.id,
      profileId: childProfile.id
    })
    const childSettings = {
      ...settings.agents,
      allowSubagentDelegation: false,
      defaultProfileId: childProfile.id,
      maxSteps: Math.min(
        settings.agents.maxSteps,
        childProfile.budgetPolicy.maxSteps
      )
    }
    const childTools = buildAgentTools({
      db,
      includeApprovalTools: false,
      projectPath,
      settings: childSettings
    })
    const childToolNames = Object.keys(childTools)
    const childLifecycleHandlers = createAgentToolLifecycleHandlers({
      db,
      parentToolCallId,
      run: childRun
    })

    await run.appendEvent({
      payload: {
        childRunId: childRun.id,
        parentToolCallId,
        profileId: childProfile.id,
        task: input.task
      },
      type: "subagent_started"
    })
    await childRun.appendEvent({
      payload: {
        parentRunId: run.id,
        parentToolCallId,
        profileId: childProfile.id,
        task: input.task,
        toolNames: childToolNames
      },
      type: "agent_run_started"
    })

    try {
      const result = await generateText({
        abortSignal,
        experimental_onToolCallFinish: childLifecycleHandlers.onToolCallFinish,
        experimental_onToolCallStart: childLifecycleHandlers.onToolCallStart,
        messages: [
          {
            content: buildDelegationPrompt(input),
            role: "user"
          }
        ],
        model,
        stopWhen: stepCountIs(childSettings.maxSteps),
        system: [
          childProfile.instructions,
          buildAgentSystemPrompt({
            profileId: childProfile.id,
            toolNames: childToolNames
          })
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools: childTools
      })
      const summary = clampDelegationSummary(result.text)

      await updateAgentRun({
        db,
        id: childRun.id,
        status: "succeeded"
      })
      await childRun.appendEvent({
        payload: {
          finishReason: result.finishReason,
          usage: result.usage
        },
        type: "agent_run_finished"
      })
      await run.appendEvent({
        payload: {
          childRunId: childRun.id,
          parentToolCallId,
          profileId: childProfile.id,
          status: "succeeded"
        },
        type: "subagent_finished"
      })

      return {
        profileId: childProfile.id,
        runId: childRun.id,
        status: "succeeded",
        ...summary
      }
    } catch (error) {
      const message = getErrorMessage(error)

      await updateAgentRun({
        db,
        errorMessage: message,
        id: childRun.id,
        status: "failed"
      })
      await childRun.appendEvent({
        payload: {
          error: message
        },
        type: "agent_run_failed"
      })
      await run.appendEvent({
        payload: {
          childRunId: childRun.id,
          error: message,
          parentToolCallId,
          profileId: childProfile.id,
          status: "failed"
        },
        type: "subagent_finished"
      })

      return {
        profileId: childProfile.id,
        runId: childRun.id,
        status: "failed",
        summary: message,
        truncated: false
      }
    } finally {
      activeSubagentCount -= 1
    }
  }
  const agentTools = buildAgentTools({
    db,
    executeDelegation,
    projectPath,
    settings: settings.agents
  })
  const toolNames = Object.keys(agentTools)

  await run.appendEvent({
    payload: {
      profileId: profile.id,
      toolNames
    },
    type: "agent_run_started"
  })

  const lifecycleHandlers = createAgentToolLifecycleHandlers({
    db,
    run
  })

  return streamText({
    experimental_onToolCallFinish: lifecycleHandlers.onToolCallFinish,
    experimental_onToolCallStart: lifecycleHandlers.onToolCallStart,
    messages,
    model,
    onError: async ({ error }) => {
      await updateAgentRun({
        db,
        errorMessage: getErrorMessage(error),
        id: run.id,
        status: "failed"
      })
      await run.appendEvent({
        payload: {
          error: getErrorMessage(error)
        },
        type: "agent_run_failed"
      })
    },
    onFinish: async ({ finishReason, usage }) => {
      await updateAgentRun({
        db,
        id: run.id,
        status: "succeeded"
      })
      await run.appendEvent({
        payload: {
          finishReason,
          usage
        },
        type: "agent_run_finished"
      })
    },
    stopWhen: stepCountIs(settings.agents.maxSteps),
    system: [
      profile.instructions,
      buildAgentSystemPrompt({
        profileId: profile.id,
        toolNames
      }),
      ...systemPrompts
    ]
      .filter(Boolean)
      .join("\n\n"),
    tools: agentTools
  })
}
