export const clampText = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text.slice(0, max)}\n[... truncated at ${max} characters]`
