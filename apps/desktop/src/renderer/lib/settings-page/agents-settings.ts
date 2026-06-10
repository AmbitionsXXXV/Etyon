export const AGENT_MAX_STEPS_MAX = 20
export const AGENT_MAX_STEPS_MIN = 1

export const clampAgentMaxSteps = (value: number): number =>
  Math.min(
    AGENT_MAX_STEPS_MAX,
    Math.max(AGENT_MAX_STEPS_MIN, Math.round(value))
  )
