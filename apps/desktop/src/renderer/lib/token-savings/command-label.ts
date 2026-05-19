const RTK_COMMAND_PREFIX_PATTERN = /^rtk\s+/u
const RTK_FALLBACK_COMMAND_PREFIX_PATTERN = /^rtk\s+fallback:\s*/u
const SHELL_TOKEN_SEPARATOR_PATTERN = /\s+/u
const CLI_EXECUTABLE_NAME_PATTERN = /^([a-z][\w]*)/iu

export const normalizeRtkCommandLabel = (value: string): string => {
  const trimmedValue = value.trim()

  if (RTK_FALLBACK_COMMAND_PREFIX_PATTERN.test(trimmedValue)) {
    return trimmedValue.replace(RTK_FALLBACK_COMMAND_PREFIX_PATTERN, "")
  }

  return trimmedValue.replace(RTK_COMMAND_PREFIX_PATTERN, "")
}

export const getCliNameFromCommand = (value: string): string => {
  const normalizedCommand = normalizeRtkCommandLabel(value).trim()

  if (normalizedCommand === "") {
    return normalizedCommand
  }

  const [firstToken = normalizedCommand] = normalizedCommand.split(
    SHELL_TOKEN_SEPARATOR_PATTERN
  )
  const executableName = firstToken.includes("/")
    ? firstToken.slice(firstToken.lastIndexOf("/") + 1)
    : firstToken
  const cliMatch = executableName.match(CLI_EXECUTABLE_NAME_PATTERN)

  return cliMatch?.[1] ?? executableName
}
