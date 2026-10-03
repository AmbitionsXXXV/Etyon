import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { HooksConfigSchema } from "@etyon/rpc/schemas/hooks"
import type { HookConfigStatus, HookDefinition } from "@etyon/rpc/schemas/hooks"

import { getAppConfigDir } from "@/main/app-paths"

const MAX_CONFIG_BYTES = 256 * 1024

const validateMatcher = (source: string): void => {
  let escaped = false
  let characterClass = false
  let previous = ""
  let quantifiers = 0
  for (const character of source) {
    if (escaped) {
      if (/\d/u.test(character) && !characterClass) {
        throw new Error("Hook matchers cannot use backreferences.")
      }
      escaped = false
    } else if (character === "\\") {
      escaped = true
    } else if (character === "[") {
      characterClass = true
    } else if (character === "]") {
      characterClass = false
    } else if (
      !characterClass &&
      /[+*?{]/u.test(character) &&
      !(character === "?" && previous === "(")
    ) {
      quantifiers += 1
      if ((previous === ")" && character !== "?") || quantifiers > 2) {
        throw new Error(
          "Hook matchers must use simple tool-name alternatives without repeated groups or more than two quantifiers."
        )
      }
    }
    previous = character
  }
  const matcher = new RegExp(source, "u")
  void matcher
}

export interface LoadedHook extends HookDefinition {
  configPath: string
}

export const loadHookConfig = async (
  configPath: string,
  scope: HookConfigStatus["scope"]
): Promise<HookConfigStatus> => {
  try {
    const configStat = await stat(configPath)
    if (configStat.size > MAX_CONFIG_BYTES) {
      throw new Error("Hooks configuration exceeds 256 KiB.")
    }
    const { hooks } = HooksConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf-8"))
    )
    for (const hook of hooks) {
      // Bound input tool names in the runner as well as the regex source.
      validateMatcher(hook.matcher)
    }
    return { hooks, path: configPath, scope }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { hooks: [], path: configPath, scope }
    }
    return {
      error: error instanceof Error ? error.message : String(error),
      hooks: [],
      path: configPath,
      scope
    }
  }
}

export const listHookConfigs = async ({
  globalConfigPath = path.join(getAppConfigDir(homedir()), "hooks.json"),
  projectPath
}: {
  globalConfigPath?: string
  projectPath?: string
}): Promise<HookConfigStatus[]> => {
  const configs = [await loadHookConfig(globalConfigPath, "global")]
  if (projectPath) {
    configs.push(
      await loadHookConfig(
        path.join(projectPath, ".etyon", "hooks.json"),
        "project"
      )
    )
  }
  return configs
}
