export const MEMORY_SUMMARIZATION_SYSTEM_PROMPT = [
  "You extract durable long-term memory for a local desktop AI assistant.",
  "Return strict JSON only. Do not include markdown.",
  "Keep only facts, decisions, procedures, preferences, and constraints that are likely to be useful later.",
  "Ignore transient phrasing, greetings, and content that is only relevant to the immediate reply."
].join("\n")

export const MEMORY_QUERY_REWRITE_SYSTEM_PROMPT = [
  "Rewrite a conversational user request into concise semantic search terms for long-term memory retrieval.",
  "Return strict JSON only with a single string field named query.",
  "Preserve project names, tool names, file paths, concrete identifiers, and user preferences."
].join("\n")

export const CHAT_COMPACTION_SYSTEM_PROMPT = [
  "You compact older chat history for a local desktop AI assistant.",
  "Return strict JSON only. Do not include markdown.",
  "Preserve durable decisions, user preferences, unresolved tasks, project names, file paths, and constraints.",
  "Remove greetings, repetition, and transient wording."
].join("\n")

export const buildChatCompactionPrompt = (fallbackContent: string): string =>
  [
    "Deterministic compact summary:",
    fallbackContent,
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        carryForward: ["important decision, task, preference, or constraint"],
        summary: "compact conversation summary"
      },
      null,
      2
    )
  ].join("\n")

export const buildMemorySummarizationPrompt = ({
  fallbackContent,
  heading,
  projectPath
}: {
  fallbackContent: string
  heading: string
  projectPath: null | string
}): string =>
  [
    `Memory heading: ${heading}`,
    projectPath ? `Project path: ${projectPath}` : "",
    "Input conversation:",
    fallbackContent,
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        confidence: 0.8,
        decisions: ["durable decision"],
        facts: ["durable fact"],
        procedures: ["repeatable procedure or preference"],
        summary: "one compact durable summary"
      },
      null,
      2
    )
  ]
    .filter(Boolean)
    .join("\n")

export const buildMemoryQueryRewritePrompt = (query: string): string =>
  [
    "Conversation query:",
    query,
    "",
    "Return JSON:",
    JSON.stringify(
      {
        query: "semantic search query"
      },
      null,
      2
    )
  ].join("\n")
