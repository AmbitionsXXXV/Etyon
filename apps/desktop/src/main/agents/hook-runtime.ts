import { randomUUID } from "node:crypto"
import path from "node:path"

import { eq, sql } from "drizzle-orm"
import { app } from "electron"

import { createHookRunner } from "@/main/agents/hooks/runner"
import type { HookAudit } from "@/main/agents/hooks/runner"
import { getAppConfigDir } from "@/main/app-paths"
import { getDb } from "@/main/db"
import { agentEvents } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { getSettings } from "@/main/settings"

const recordHookAudit = async (audit: HookAudit): Promise<void> => {
  if (!audit.runId) {
    return
  }
  const { runId } = audit
  await runExclusiveDbWrite(async () => {
    const db = getDb()
    const [row] = await db
      .select({
        sequence: sql<number>`coalesce(max(${agentEvents.sequence}), -1)`
      })
      .from(agentEvents)
      .where(eq(agentEvents.runId, runId))
    await db.insert(agentEvents).values({
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      payloadJson: JSON.stringify(audit),
      runId,
      sequence: (row?.sequence ?? -1) + 1,
      type: "hook.execution"
    })
  })
}

export const createRuntimeHookRunner = (
  projectPath: string,
  { configProjectPath }: { configProjectPath?: string } = {}
) =>
  createHookRunner({
    configProjectPath,
    enabled: getSettings().agents.hooks?.enabled ?? false,
    globalConfigPath: path.join(
      getAppConfigDir(app.getPath("home")),
      "hooks.json"
    ),
    onAudit: recordHookAudit,
    projectPath
  })

export const isHookConfigurationPath = (
  input: unknown,
  projectPath?: string
): boolean => {
  if (
    !input ||
    typeof input !== "object" ||
    !("path" in input) ||
    typeof input.path !== "string"
  ) {
    return false
  }
  const normalized = path.posix
    .normalize(input.path.replaceAll("\\", "/"))
    .toLowerCase()
  return (
    normalized === ".etyon/hooks.json" ||
    normalized.endsWith("/.etyon/hooks.json") ||
    path.resolve(projectPath ?? ".", input.path).toLowerCase() ===
      path
        .join(getAppConfigDir(app.getPath("home")), "hooks.json")
        .toLowerCase()
  )
}
