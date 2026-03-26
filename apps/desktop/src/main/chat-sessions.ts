import fs from "node:fs"

import type { ChatSessionSummary } from "@etyon/rpc"
import { desc, eq } from "drizzle-orm"
import { app } from "electron"

import type { AppDatabase } from "@/main/db"
import { getAppConfigDir } from "@/main/db/libsql-paths"
import { chatSessions } from "@/main/db/schema"

const buildDefaultProjectPath = (): string =>
  getAppConfigDir(app.getPath("home"))

const ensureProjectDirectory = (projectPath: string): void => {
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true })
  }
}

const getRecentChatSession = async (
  db: AppDatabase
): Promise<ChatSessionSummary | undefined> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .orderBy(desc(chatSessions.lastOpenedAt), desc(chatSessions.createdAt))
    .limit(1)

  return session
}

const getSessionById = async (
  db: AppDatabase,
  sessionId: string
): Promise<ChatSessionSummary | undefined> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1)

  return session
}

const resolveProjectPath = async (
  currentSessionId: string | undefined,
  db: AppDatabase
): Promise<string> => {
  if (currentSessionId) {
    const currentSession = await getSessionById(db, currentSessionId)

    if (currentSession) {
      return currentSession.projectPath
    }
  }

  const recentSession = await getRecentChatSession(db)

  if (recentSession) {
    return recentSession.projectPath
  }

  return buildDefaultProjectPath()
}

export const createChatSession = async ({
  currentSessionId,
  db
}: {
  currentSessionId?: string
  db: AppDatabase
}): Promise<ChatSessionSummary> => {
  const now = new Date().toISOString()
  const projectPath = await resolveProjectPath(currentSessionId, db)

  ensureProjectDirectory(projectPath)

  const [createdSession] = await db
    .insert(chatSessions)
    .values({
      createdAt: now,
      id: crypto.randomUUID(),
      lastOpenedAt: now,
      pinnedAt: null,
      projectPath,
      title: "",
      updatedAt: now
    })
    .returning()

  if (!createdSession) {
    throw new Error("Failed to create chat session")
  }

  return createdSession
}

export const listChatSessions = (
  db: AppDatabase
): Promise<ChatSessionSummary[]> =>
  db
    .select()
    .from(chatSessions)
    .orderBy(desc(chatSessions.lastOpenedAt), desc(chatSessions.createdAt))

export const openChatSession = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<ChatSessionSummary> => {
  const [openedSession] = await db
    .update(chatSessions)
    .set({
      lastOpenedAt: new Date().toISOString()
    })
    .where(eq(chatSessions.id, sessionId))
    .returning()

  if (!openedSession) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return openedSession
}

export const setChatSessionPinned = async ({
  db,
  pinned,
  sessionId
}: {
  db: AppDatabase
  pinned: boolean
  sessionId: string
}): Promise<ChatSessionSummary> => {
  const [updatedSession] = await db
    .update(chatSessions)
    .set({
      pinnedAt: pinned ? new Date().toISOString() : null
    })
    .where(eq(chatSessions.id, sessionId))
    .returning()

  if (!updatedSession) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return updatedSession
}
