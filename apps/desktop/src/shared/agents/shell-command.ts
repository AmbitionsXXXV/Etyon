// A small lexer for literal shell arguments and simple command boundaries.
// It preserves quoted words as one argument and removes shell quote/escape
// syntax. It does not resolve variables, substitutions, functions or aliases.
export interface ShellCommands {
  commands: string[][]
  hasOperators: boolean
}

const SHELL_OPERATORS = new Set(["\n", ";", "&", "|", "<", ">"])
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"])

const isDynamicSyntax = (char: string, next: string | undefined): boolean =>
  char === "`" || (char === "$" && next === "(")

const readQuotedCharacter = (
  command: string,
  index: number,
  quote: '"' | "'"
): { closed: boolean; index: number; text: string } | null => {
  const char = command[index] as string
  const next = command[index + 1]
  if (char === quote) {
    return { closed: true, index, text: "" }
  }
  if (quote === "'") {
    return { closed: false, index, text: char }
  }
  if (char === "\\" && next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
    return { closed: false, index: index + 1, text: next === "\n" ? "" : next }
  }
  return isDynamicSyntax(char, next)
    ? null
    : { closed: false, index, text: char }
}

export const tokenizeShellCommands = (
  command: string
): ShellCommands | null => {
  const commands: string[][] = []
  let tokens: string[] = []
  let word = ""
  let hasWord = false
  let hasOperators = false
  let quote: '"' | "'" | null = null
  const finishWord = () => {
    if (hasWord) {
      tokens.push(word)
      word = ""
      hasWord = false
    }
  }
  const finishCommand = () => {
    finishWord()
    if (tokens.length > 0) {
      commands.push(tokens)
      tokens = []
    }
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    const next = command[index + 1]
    if (quote !== null) {
      const quoted = readQuotedCharacter(command, index, quote)
      if (quoted === null) {
        return null
      }
      const { closed, index: nextIndex, text } = quoted
      word += text
      index = nextIndex
      if (closed) {
        quote = null
      }
      continue
    }
    if (isDynamicSyntax(char, next)) {
      return null
    }
    if (char === '"' || char === "'") {
      quote = char
      hasWord = true
    } else if (char === "\\" && next !== undefined) {
      if (next !== "\n") {
        word += next
        hasWord = true
      }
      index += 1
    } else if (char === "#" && !hasWord) {
      while (index + 1 < command.length && command[index + 1] !== "\n") {
        index += 1
      }
    } else if (SHELL_OPERATORS.has(char)) {
      hasOperators = true
      finishCommand()
    } else if (char === " " || char === "\t") {
      finishWord()
    } else {
      word += char
      hasWord = true
    }
  }
  if (quote !== null) {
    return null
  }
  finishCommand()
  return { commands, hasOperators }
}
