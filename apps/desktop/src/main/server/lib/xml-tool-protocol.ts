import type {
  LanguageModelV3FilePart,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ReasoningPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart
} from "@ai-sdk/provider"

/**
 * Pure, dependency-free implementation of the XML tool-calling protocol used to
 * give tool use to models whose provider has no native function-calling API.
 * Everything here is a pure function or constant — it imports only types from
 * `@ai-sdk/provider` and holds no shared mutable state. The middleware (a
 * separate module) wires these into a `LanguageModelV3` via `wrapLanguageModel`.
 */

/** XML tag the model writes to invoke a tool. */
export const XML_TOOL_CALL_TAG = "tool_call"
/** XML tag used to feed tool results back to the model. */
export const XML_TOOL_RESULT_TAG = "tool_result"
/**
 * Sentinel line that begins the injected system prompt. Its presence in a
 * system message tells the middleware that this call is running in XML tool
 * mode (no shared mutable state is needed to detect it).
 */
export const XML_TOOL_PROMPT_HEADER = "## Tool calling (XML protocol)"

/** A tool as it is described to the model in the XML system prompt. */
export interface XmlSpecTool {
  description?: string
  inputSchema: unknown
  name: string
}

/** An event produced by the streaming parser. */
export type XmlToolParserEvent =
  | { input: string; toolName: string; type: "tool-call" }
  | { text: string; type: "text" }

/** Incremental, chunk-boundary-safe parser for the model's XML output. */
export interface XmlToolCallParser {
  flush: () => XmlToolParserEvent[]
  push: (delta: string) => XmlToolParserEvent[]
}

const OPEN_TAG = `<${XML_TOOL_CALL_TAG}`
const CLOSE_TAG = `</${XML_TOOL_CALL_TAG}>`

// Extracts the tool name from an opener, tolerant of extra/reordered
// attributes (e.g. a model imitating `id="..."` before `name="..."`).
const TOOL_NAME_ATTR_RE = /name\s*=\s*"([^"]+)"/u
const BOUNDARY_RE = /[\s/>]/u

const buildToolChoiceInstruction = (
  toolChoice?: LanguageModelV3ToolChoice
): string | null => {
  if (toolChoice?.type === "required") {
    return "You MUST call a tool in your next reply."
  }

  if (toolChoice?.type === "tool") {
    return `You MUST call the tool "${toolChoice.toolName}" in your next reply.`
  }

  return null
}

const buildToolBlock = (tool: XmlSpecTool): string => {
  const lines = [`<tool name="${tool.name}">`]

  if (tool.description) {
    lines.push(`<description>${tool.description}</description>`)
  }

  lines.push(
    `<input_schema>${JSON.stringify(tool.inputSchema)}</input_schema>`,
    "</tool>"
  )

  return lines.join("\n")
}

/**
 * Builds the system-prompt section that teaches the model the XML tool
 * protocol and lists the available tools. The returned string always begins
 * with {@link XML_TOOL_PROMPT_HEADER} so the middleware can detect XML mode.
 */
export const buildXmlToolSystemPrompt = (
  tools: readonly XmlSpecTool[],
  options?: { toolChoice?: LanguageModelV3ToolChoice }
): string => {
  const sections = [
    XML_TOOL_PROMPT_HEADER,
    "This model has no native tool API. To use a tool you write an XML block in your reply, exactly as described below.",
    `### How to call a tool

Write a block exactly like this, with the arguments as one valid JSON object between the opening and closing tags:

<${XML_TOOL_CALL_TAG} name="TOOL_NAME">
{"argument": "value"}
</${XML_TOOL_CALL_TAG}>`,
    `### Rules

- The body between the tags MUST be a single valid JSON object: double-quoted keys and string values, matching that tool's input schema.
- Write the block as plain text. Never wrap it in a code fence, quotes, or extra indentation.
- A brief sentence before your calls is fine, but stop right after your last call — do not write a final answer in the same reply as a tool call.
- Emit several blocks only when the calls are independent of one another; they run in parallel. If a call depends on another call's result, make a single call and wait for the result before the next one.
- Only call the tools listed below. Never write a <${XML_TOOL_RESULT_TAG}> block yourself, and never invent tool results.`,
    `### Tool results

Results come back in the next user message, one block per call:

<${XML_TOOL_RESULT_TAG} name="TOOL_NAME" id="CALL_ID">
...result...
</${XML_TOOL_RESULT_TAG}>

A failed call is marked with is_error="true":

<${XML_TOOL_RESULT_TAG} name="TOOL_NAME" id="CALL_ID" is_error="true">
...error...
</${XML_TOOL_RESULT_TAG}>

Read each result, fix your arguments or approach if it failed, and continue.`,
    `### Available tools

${tools.map(buildToolBlock).join("\n\n")}`
  ]

  const toolChoiceInstruction = buildToolChoiceInstruction(options?.toolChoice)

  if (toolChoiceInstruction) {
    sections.push(toolChoiceInstruction)
  }

  return sections.join("\n\n")
}

const textEvent = (text: string): XmlToolParserEvent => ({ text, type: "text" })

const toolCallEvent = (
  toolName: string,
  input: string
): XmlToolParserEvent => ({ input, toolName, type: "tool-call" })

const textPart = (text: string): LanguageModelV3TextPart => ({
  text,
  type: "text"
})

/**
 * Creates a streaming parser that turns a raw model text stream into text and
 * tool-call events. It is a character-scanning state machine (text → opener →
 * args → text) with a bounded holdback so a `<tool_call` opener may straddle
 * any chunk boundary. It never validates the JSON body — the raw body is passed
 * through and policy lives in the middleware.
 *
 * Known limitation: a literal `</tool_call>` inside a JSON string value ends the
 * block early; upstream self-correction (a re-tried call) handles it.
 */
export const createXmlToolCallParser = (): XmlToolCallParser => {
  let state: "args" | "opener" | "text" = "text"
  // Unconsumed input tail. In `text` state this holds at most a partial
  // `<tool_call` prefix; in `opener`/`args` it holds the block body so far.
  let buffer = ""
  // Verbatim opener (`<tool_call ...>`) once in `args`, for flush reconstruction.
  let openerRaw = ""
  let pendingToolName = ""
  // Offset into `buffer` already scanned for the closer (keeps args O(n)).
  let argsScanStart = 0

  const scan = (events: XmlToolParserEvent[]): void => {
    while (true) {
      if (state === "text") {
        const lt = buffer.indexOf("<")

        if (lt === -1) {
          if (buffer.length > 0) {
            events.push(textEvent(buffer))
            buffer = ""
          }

          return
        }

        if (lt > 0) {
          events.push(textEvent(buffer.slice(0, lt)))
          buffer = buffer.slice(lt)
        }

        const compareLength = Math.min(buffer.length, OPEN_TAG.length)

        if (
          buffer.slice(0, compareLength) !== OPEN_TAG.slice(0, compareLength)
        ) {
          // `<` does not begin `<tool_call`; emit it and rescan after it.
          events.push(textEvent("<"))
          buffer = buffer.slice(1)
          continue
        }

        if (buffer.length <= OPEN_TAG.length) {
          // Matched a prefix (or exactly `<tool_call`) but the boundary char
          // that would confirm it has not arrived yet — hold for more input.
          return
        }

        if (BOUNDARY_RE.test(buffer[OPEN_TAG.length] ?? "")) {
          state = "opener"
          continue
        }

        // e.g. `<tool_callback` — a longer word, not an opener.
        events.push(textEvent("<"))
        buffer = buffer.slice(1)
        continue
      }

      if (state === "opener") {
        const gt = buffer.indexOf(">")

        if (gt === -1) {
          return
        }

        const opener = buffer.slice(0, gt + 1)
        const name = TOOL_NAME_ATTR_RE.exec(opener)?.[1]

        if (name === undefined) {
          // Structural failure: no name attribute — emit the whole opener as
          // text so nothing vanishes, and drop back to text scanning.
          events.push(textEvent(opener))
          buffer = buffer.slice(gt + 1)
          state = "text"
          continue
        }

        if (opener[gt - 1] === "/") {
          events.push(toolCallEvent(name, "{}"))
          buffer = buffer.slice(gt + 1)
          state = "text"
          continue
        }

        pendingToolName = name
        openerRaw = opener
        buffer = buffer.slice(gt + 1)
        argsScanStart = 0
        state = "args"
        continue
      }

      // args
      const closeIndex = buffer.indexOf(CLOSE_TAG, argsScanStart)

      if (closeIndex === -1) {
        // Hold everything; only re-scan the small tail that could start a closer.
        argsScanStart = Math.max(0, buffer.length - (CLOSE_TAG.length - 1))

        return
      }

      const body = buffer.slice(0, closeIndex).trim()

      events.push(toolCallEvent(pendingToolName, body === "" ? "{}" : body))
      buffer = buffer.slice(closeIndex + CLOSE_TAG.length)
      openerRaw = ""
      pendingToolName = ""
      argsScanStart = 0
      state = "text"
    }
  }

  return {
    flush: () => {
      const events: XmlToolParserEvent[] = []

      scan(events)

      if (state === "text") {
        if (buffer.length > 0) {
          events.push(textEvent(buffer))
          buffer = ""
        }
      } else if (state === "opener") {
        // Unterminated opener — emit verbatim so it is never lost.
        events.push(textEvent(buffer))
        buffer = ""
        state = "text"
      } else {
        // Unterminated block — reconstruct opener + body so far, verbatim.
        events.push(textEvent(openerRaw + buffer))
        buffer = ""
        openerRaw = ""
        pendingToolName = ""
        argsScanStart = 0
        state = "text"
      }

      return events
    },
    push: (delta: string) => {
      buffer += delta

      const events: XmlToolParserEvent[] = []

      scan(events)

      return events
    }
  }
}

const renderToolResultOutput = (
  output: LanguageModelV3ToolResultOutput
): { isError: boolean; text: string } => {
  switch (output.type) {
    case "text": {
      return { isError: false, text: output.value }
    }
    case "error-text": {
      return { isError: true, text: output.value }
    }
    case "json": {
      return { isError: false, text: JSON.stringify(output.value) }
    }
    case "error-json": {
      return { isError: true, text: JSON.stringify(output.value) }
    }
    case "execution-denied": {
      const base = "The user denied this tool call."

      return {
        isError: true,
        text: output.reason ? `${base} ${output.reason}` : base
      }
    }
    default: {
      // "content": join text items, replace file/image items with placeholders.
      const text = output.value
        .map((item) =>
          item.type === "text"
            ? item.text
            : `[attachment: ${"mediaType" in item ? item.mediaType : item.type}]`
        )
        .join("")

      return { isError: false, text }
    }
  }
}

const renderToolResultPart = (part: LanguageModelV3ToolResultPart): string => {
  const { isError, text } = renderToolResultOutput(part.output)
  const errorAttr = isError ? ' is_error="true"' : ""

  return `<${XML_TOOL_RESULT_TAG} name="${part.toolName}" id="${part.toolCallId}"${errorAttr}>\n${text}\n</${XML_TOOL_RESULT_TAG}>`
}

const renderToolCallText = (
  toolName: string,
  toolCallId: string,
  input: unknown
): string =>
  `<${XML_TOOL_CALL_TAG} name="${toolName}" id="${toolCallId}">\n${JSON.stringify(input)}\n</${XML_TOOL_CALL_TAG}>`

const convertAssistantMessage = (
  message: Extract<LanguageModelV3Message, { role: "assistant" }>
): LanguageModelV3Message => {
  const content: (
    | LanguageModelV3FilePart
    | LanguageModelV3ReasoningPart
    | LanguageModelV3TextPart
  )[] = []

  for (const part of message.content) {
    if (part.type === "tool-call") {
      content.push(
        textPart(renderToolCallText(part.toolName, part.toolCallId, part.input))
      )
    } else if (part.type === "tool-result") {
      // Defensive: tool results should not normally live on assistant messages,
      // but render them the same way if they do.
      content.push(textPart(renderToolResultPart(part)))
    } else {
      content.push(part)
    }
  }

  return { ...message, content }
}

const convertToolMessage = (
  message: Extract<LanguageModelV3Message, { role: "tool" }>
): LanguageModelV3Message | null => {
  const content: LanguageModelV3TextPart[] = []

  for (const part of message.content) {
    if (part.type === "tool-result") {
      content.push(textPart(renderToolResultPart(part)))
    }
    // tool-approval-response parts are dropped.
  }

  if (content.length === 0) {
    return null
  }

  return { content, role: "user" }
}

/**
 * Rewrites a prompt so prior tool use is expressed in the XML protocol rather
 * than as native tool-call / tool-result messages. This is applied to every
 * call in XML mode so replaying agent-era history still makes sense to a model
 * that has no native tool API.
 *
 * - system/user messages pass through untouched (file/vision parts included);
 * - assistant `tool-call` parts become `<tool_call ... id>` text parts;
 * - `tool` role messages become a user message of `<tool_result>` text parts;
 * - empty `tool` messages (e.g. only approval responses) are dropped.
 *
 * Consecutive user messages are deliberately NOT merged.
 */
export const convertToolHistoryToXml = (
  prompt: LanguageModelV3Prompt
): LanguageModelV3Prompt => {
  const result: LanguageModelV3Prompt = []

  for (const message of prompt) {
    if (message.role === "system" || message.role === "user") {
      result.push(message)
    } else if (message.role === "assistant") {
      result.push(convertAssistantMessage(message))
    } else {
      const converted = convertToolMessage(message)

      if (converted) {
        result.push(converted)
      }
    }
  }

  return result
}

/**
 * Appends `section` to the first system message's content (separated by a blank
 * line). If the prompt has no system message, a new one is prepended.
 */
export const appendToSystemPrompt = (
  prompt: LanguageModelV3Prompt,
  section: string
): LanguageModelV3Prompt => {
  const systemIndex = prompt.findIndex((message) => message.role === "system")

  if (systemIndex === -1) {
    return [{ content: section, role: "system" }, ...prompt]
  }

  return prompt.map((message, index) =>
    index === systemIndex && message.role === "system"
      ? { ...message, content: `${message.content}\n\n${section}` }
      : message
  )
}
