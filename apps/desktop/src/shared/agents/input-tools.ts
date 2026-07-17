import { z } from "zod"

/**
 * Input-required tools: defined without `execute`, so a call suspends the run
 * (see agent-loop) until the renderer supplies the result via `addToolResult`
 * and auto-send resumes it. Names, schemas, and part types live in shared so
 * the main-process tool definitions, the renderer cards, and the auto-send
 * predicate agree on a single source.
 */

export const ASK_USER_TOOL_NAME = "ask_user"
export const PROPOSE_PLAN_TOOL_NAME = "propose_plan"

export const ASK_USER_TOOL_PART_TYPE = `tool-${ASK_USER_TOOL_NAME}` as const
export const PROPOSE_PLAN_TOOL_PART_TYPE =
  `tool-${PROPOSE_PLAN_TOOL_NAME}` as const

const INPUT_REQUIRED_TOOL_PART_TYPES: ReadonlySet<string> = new Set([
  ASK_USER_TOOL_PART_TYPE,
  PROPOSE_PLAN_TOOL_PART_TYPE
])

export const isInputRequiredToolPartType = (type: string): boolean =>
  INPUT_REQUIRED_TOOL_PART_TYPES.has(type)

const INPUT_REQUIRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ASK_USER_TOOL_NAME,
  PROPOSE_PLAN_TOOL_NAME
])

export const isInputRequiredToolName = (name: string): boolean =>
  INPUT_REQUIRED_TOOL_NAMES.has(name)

const ASK_USER_QUESTION_MAX_CHARS = 300
const ASK_USER_OPTION_LABEL_MAX_CHARS = 60
const ASK_USER_OPTION_DESCRIPTION_MAX_CHARS = 140
const ASK_USER_MIN_OPTIONS = 2
const ASK_USER_MAX_OPTIONS = 5

export const AskUserInputSchema = z
  .object({
    multiSelect: z
      .boolean()
      .optional()
      .describe("Allow choosing several options. Defaults to false."),
    options: z
      .array(
        z
          .object({
            description: z
              .string()
              .max(ASK_USER_OPTION_DESCRIPTION_MAX_CHARS)
              .optional()
              .describe("One short line on what picking this option implies."),
            label: z
              .string()
              .min(1)
              .max(ASK_USER_OPTION_LABEL_MAX_CHARS)
              .describe("Concise option label (1-5 words).")
          })
          .strict()
      )
      .min(ASK_USER_MIN_OPTIONS)
      .max(ASK_USER_MAX_OPTIONS)
      .describe(
        "2-5 mutually exclusive answers. The UI always adds a free-form input besides these, so do not add an 'Other' option."
      ),
    question: z
      .string()
      .min(1)
      .max(ASK_USER_QUESTION_MAX_CHARS)
      .describe("The complete question, ending with a question mark.")
  })
  .strict()

export type AskUserInput = z.infer<typeof AskUserInputSchema>

export const AskUserOutputSchema = z
  .object({
    custom: z
      .string()
      .nullable()
      .describe("Free-form answer text, or null when options were chosen."),
    selected: z
      .array(z.string())
      .describe("Chosen option labels; empty when the answer is custom-only.")
  })
  .strict()

export type AskUserOutput = z.infer<typeof AskUserOutputSchema>

const PROPOSE_PLAN_TITLE_MAX_CHARS = 80

export const ProposePlanInputSchema = z
  .object({
    plan: z
      .string()
      .min(1)
      .describe(
        "The complete plan in markdown: ordered steps, files to change, what each change does, risks."
      ),
    title: z
      .string()
      .min(1)
      .max(PROPOSE_PLAN_TITLE_MAX_CHARS)
      .describe("Short handle for the plan, shown in the composer indicator.")
  })
  .strict()

export type ProposePlanInput = z.infer<typeof ProposePlanInputSchema>

export const PLAN_DECISIONS = ["implement", "not_now"] as const

export type PlanDecision = (typeof PLAN_DECISIONS)[number]

export const ProposePlanOutputSchema = z
  .object({
    decision: z
      .enum(PLAN_DECISIONS)
      .describe("The user's choice on the proposed plan.")
  })
  .strict()

export type ProposePlanOutput = z.infer<typeof ProposePlanOutputSchema>
