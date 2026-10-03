import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ToolSet } from "ai"

import type { HookContext, HookRunner } from "@/main/agents/hooks/runner"

const addContextToModelOutput = (
  output: ToolResultOutput,
  context: string
): ToolResultOutput => {
  if (output.type === "text" || output.type === "error-text") {
    return { ...output, value: `${output.value}\n\nHook context:\n${context}` }
  }
  if (output.type === "json" || output.type === "error-json") {
    const { value } = output
    return {
      ...output,
      value:
        value && typeof value === "object" && !Array.isArray(value)
          ? { ...value, hookContext: context }
          : { hookContext: context, result: value }
    }
  }
  if (output.type === "content") {
    return {
      ...output,
      value: [
        ...output.value,
        { text: `Hook context:\n${context}`, type: "text" }
      ]
    }
  }
  return output
}

const wrapModelOutput =
  (
    toModelOutput: NonNullable<ToolSet[string]["toModelOutput"]>
  ): typeof toModelOutput =>
  async (options: Parameters<typeof toModelOutput>[0]) => {
    const rendered = await toModelOutput(options)
    const output: unknown = options.output
    if (
      !output ||
      typeof output !== "object" ||
      !("hookContext" in output) ||
      typeof output.hookContext !== "string"
    ) {
      return rendered
    }
    return addContextToModelOutput(rendered, output.hookContext)
  }

/** Wrap only executions already gated by the caller's approval policy. */
export const wrapToolsWithHooks = <TTools extends ToolSet>(
  tools: TTools,
  {
    runner,
    ...context
  }: Pick<HookContext, "runId" | "sessionId"> & { runner: HookRunner }
): TTools =>
  Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const { execute, toModelOutput } = definition
      if (!execute) {
        return [toolName, definition]
      }
      return [
        toolName,
        {
          ...definition,
          ...(toModelOutput
            ? { toModelOutput: wrapModelOutput(toModelOutput) }
            : {}),
          execute: (input, options) =>
            runner.invoke({
              ...context,
              execute: async () => await execute(input, options),
              input,
              signal: options.abortSignal,
              toolCallId: options.toolCallId,
              toolName
            })
        } satisfies typeof definition
      ]
    })
  ) as TTools
