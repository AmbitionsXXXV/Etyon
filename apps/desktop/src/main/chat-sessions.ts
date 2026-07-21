import fs from "node:fs"
import path from "node:path"

import type { ChatSessionSummary, GitProjectStatus } from "@etyon/rpc"
import { and, desc, eq, isNull } from "drizzle-orm"
import { app } from "electron"

import { listAgentEditedPathsBySession } from "@/main/agents/agent-edited-paths"
import { getAppConfigDir } from "@/main/app-paths"
import type { AppDatabase } from "@/main/db"
import { chatSessions } from "@/main/db/schema"
import {
  getGitProjectStatuses,
  getGitRepositoryRoot
} from "@/main/git-project-status"

const buildDefaultProjectPath = (): string =>
  getAppConfigDir(app.getPath("home"))

const ensureProjectDirectory = (projectPath: string): void => {
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true })
  }
}

const normalizeProjectPath = (projectPath: string): string =>
  path.resolve(projectPath)

const resolveProjectPathForGit = (projectPath: string): string => {
  try {
    return fs.realpathSync(projectPath)
  } catch {
    return path.resolve(projectPath)
  }
}

const getAgentGitStatus = ({
  agentEditedPaths,
  gitStatus,
  projectPath,
  repositoryRoot
}: {
  agentEditedPaths: string[]
  gitStatus: GitProjectStatus | undefined
  projectPath: string
  repositoryRoot: string | null
}): GitProjectStatus | undefined => {
  if (!gitStatus) {
    return undefined
  }

  const resolvedProjectPath = resolveProjectPathForGit(projectPath)
  const agentEditedAbsolutePaths = new Set(
    agentEditedPaths.map((filePath) =>
      path.resolve(resolvedProjectPath, filePath)
    )
  )
  const files = repositoryRoot
    ? gitStatus.files.filter((file) =>
        agentEditedAbsolutePaths.has(path.resolve(repositoryRoot, file.path))
      )
    : []
  let added = 0
  let deleted = 0
  let modified = 0
  let renamed = 0
  let untracked = 0

  for (const file of files) {
    if (file.status === "added") {
      added += 1
    } else if (file.status === "deleted") {
      deleted += 1
    } else if (file.status === "renamed") {
      renamed += 1
    } else if (file.status === "untracked") {
      untracked += 1
    } else {
      modified += 1
    }
  }

  return {
    added,
    changedFileCount: files.length,
    deleted,
    error: gitStatus.error,
    files,
    isRepository: gitStatus.isRepository,
    modified,
    projectPath: gitStatus.projectPath,
    renamed,
    untracked
  }
}

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

export const listChatSessions = async (
  db: AppDatabase
): Promise<ChatSessionSummary[]> => {
  const sessions = await db
    .select()
    .from(chatSessions)
    .where(isNull(chatSessions.archivedAt))
    .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.createdAt))
  const sessionIds = sessions.map((session) => session.id)
  const [agentEditedPathsBySession, gitStatuses] = await Promise.all([
    listAgentEditedPathsBySession({ db, sessionIds }),
    getGitProjectStatuses(sessions.map((session) => session.projectPath))
  ])
  const repositoryRootsByProjectPath = new Map(
    await Promise.all(
      [
        ...new Set(sessions.map((session) => path.resolve(session.projectPath)))
      ].map(
        async (projectPath) =>
          [projectPath, await getGitRepositoryRoot(projectPath)] as const
      )
    )
  )

  return sessions.map((session) => {
    const agentEditedPaths = agentEditedPathsBySession.get(session.id) ?? []
    const normalizedProjectPath = path.resolve(session.projectPath)
    const gitStatus = gitStatuses.get(normalizedProjectPath)

    return {
      ...session,
      agentEditedPaths,
      agentGitStatus: getAgentGitStatus({
        agentEditedPaths,
        gitStatus,
        projectPath: normalizedProjectPath,
        repositoryRoot:
          repositoryRootsByProjectPath.get(normalizedProjectPath) ?? null
      }),
      gitStatus
    }
  })
}

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
