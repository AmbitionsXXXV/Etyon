import fs from "node:fs"
import path from "node:path"

import type { ChatSessionSummary } from "@etyon/rpc"
import { and, desc, eq, isNull } from "drizzle-orm"
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

const normalizeProjectPath = (projectPath: string): string =>
  path.resolve(projectPath)

const getRecentChatSession = async (
  db: AppDatabase
): Promise<ChatSessionSummary | undefined> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(isNull(chatSessions.archivedAt))
    .orderBy(desc(chatSessions.lastOpenedAt), desc(chatSessions.createdAt))
    .limit(1)

  return session
}

export const getChatSessionById = async (
  db: AppDatabase,
  sessionId: string
): Promise<ChatSessionSummary | undefined> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .limit(1)

  return session
}

const resolveProjectPath = async ({
  currentSessionId,
  db,
  projectPath
}: {
  currentSessionId: string | undefined
  db: AppDatabase
  projectPath: string | undefined
}): Promise<string> => {
  if (projectPath) {
    return normalizeProjectPath(projectPath)
  }

  if (currentSessionId) {
    const currentSession = await getChatSessionById(db, currentSessionId)

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
  db,
  projectPath
}: {
  currentSessionId?: string
  db: AppDatabase
  projectPath?: string
}): Promise<ChatSessionSummary> => {
  const now = new Date().toISOString()
  const resolvedProjectPath = await resolveProjectPath({
    currentSessionId,
    db,
    projectPath
  })

  ensureProjectDirectory(resolvedProjectPath)

  const [createdSession] = await db
    .insert(chatSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      id: crypto.randomUUID(),
      lastOpenedAt: now,
      modelId: null,
      pinnedAt: null,
      projectPath: resolvedProjectPath,
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
    .where(isNull(chatSessions.archivedAt))
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
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
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
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .returning()

  if (!updatedSession) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return updatedSession
}

export const setChatSessionModel = async ({
  db,
  modelId,
  sessionId
}: {
  db: AppDatabase
  modelId: string | null
  sessionId: string
}): Promise<ChatSessionSummary> => {
  const [updatedSession] = await db
    .update(chatSessions)
    .set({
      modelId
    })
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .returning()

  if (!updatedSession) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return updatedSession
}

export const archiveChatSession = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<ChatSessionSummary> => {
  const now = new Date().toISOString()
  const [archivedSession] = await db
    .update(chatSessions)
    .set({
      archivedAt: now,
      pinnedAt: null,
      updatedAt: now
    })
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .returning()

  if (!archivedSession) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return archivedSession
}

export const archiveProjectChatSessions = async ({
  db,
  projectPath
}: {
  db: AppDatabase
  projectPath: string
}): Promise<ChatSessionSummary[]> => {
  const now = new Date().toISOString()

  await db
    .update(chatSessions)
    .set({
      archivedAt: now,
      pinnedAt: null,
      updatedAt: now
    })
    .where(
      and(
        eq(chatSessions.projectPath, normalizeProjectPath(projectPath)),
        isNull(chatSessions.archivedAt)
      )
    )

  return listChatSessions(db)
}

export const removeProjectChatSessions = async ({
  db,
  projectPath
}: {
  db: AppDatabase
  projectPath: string
}): Promise<ChatSessionSummary[]> => {
  await db
    .delete(chatSessions)
    .where(eq(chatSessions.projectPath, normalizeProjectPath(projectPath)))

  return listChatSessions(db)
}
