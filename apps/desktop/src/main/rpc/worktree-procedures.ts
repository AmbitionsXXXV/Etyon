import path from "node:path"

import {
  ListHooksInputSchema,
  ListHooksOutputSchema
} from "@etyon/rpc/schemas/hooks"
import {
  ApplyBestOfNInputSchema,
  ApplyWorktreeInputSchema,
  ApplyWorktreeOutputSchema,
  BestOfNIdInputSchema,
  BestOfNRunSchema,
  ListBestOfNOutputSchema,
  ListWorktreesOutputSchema,
  PruneWorktreeInputSchema,
  WorktreeDiffSchema,
  WorktreeIdInputSchema,
  WorktreeSessionInputSchema
} from "@etyon/rpc/schemas/worktrees"
import { ORPCError } from "@orpc/server"
import { app } from "electron"
import * as z from "zod"

import { listHookConfigs } from "@/main/agents/hooks/config"
import {
  createRuntimeBestOfNService,
  getRuntimeWorktreeManager
} from "@/main/agents/worktree-runtime"
import { getAppConfigDir } from "@/main/app-paths"
import { getChatSessionById } from "@/main/chat-sessions"
import { rpc } from "@/main/rpc/context"
import type { AppRpcContext } from "@/main/rpc/context"
import { withRpcSessionMutation } from "@/main/rpc/session-mutation"

const assertSession = async (context: AppRpcContext, sessionId: string) => {
  const session = await getChatSessionById(context.db, sessionId)
  if (!session) {
    throw new ORPCError("NOT_FOUND", { message: "Chat session not found" })
  }
  return session
}

const assertIndependentWorktree = async (
  sessionId: string,
  id: string
): Promise<void> => {
  const runs = await createRuntimeBestOfNService().list(sessionId)
  if (
    runs.some((run) =>
      run.candidates.some((candidate) => candidate.worktreeId === id)
    )
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "This candidate belongs to a Best-of-N comparison. Select or discard it from that comparison."
    })
  }
}

export const hooksRouter = {
  list: rpc
    .input(ListHooksInputSchema)
    .output(ListHooksOutputSchema)
    .handler(async ({ context, input }) => {
      const session = input.sessionId
        ? await assertSession(context, input.sessionId)
        : null
      return {
        configs: await listHookConfigs({
          globalConfigPath: path.join(
            getAppConfigDir(app.getPath("home")),
            "hooks.json"
          ),
          projectPath: session?.projectPath
        })
      }
    })
}

export const worktreesRouter = {
  apply: rpc
    .input(ApplyWorktreeInputSchema)
    .output(ApplyWorktreeOutputSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await withRpcSessionMutation(input.sessionId, async () => {
        await assertIndependentWorktree(input.sessionId, input.id)
        return await getRuntimeWorktreeManager().apply(input)
      })
    }),
  list: rpc
    .input(WorktreeSessionInputSchema)
    .output(ListWorktreesOutputSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return {
        worktrees: await getRuntimeWorktreeManager().list(input.sessionId)
      }
    }),
  preview: rpc
    .input(WorktreeIdInputSchema)
    .output(WorktreeDiffSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await getRuntimeWorktreeManager().preview(
        input.id,
        input.sessionId
      )
    }),
  prune: rpc
    .input(PruneWorktreeInputSchema)
    .output(z.object({ ok: z.boolean() }))
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await withRpcSessionMutation(input.sessionId, async () => {
        await assertIndependentWorktree(input.sessionId, input.id)
        await getRuntimeWorktreeManager().prune(input)
        return { ok: true }
      })
    })
}

export const bestOfNRouter = {
  apply: rpc
    .input(ApplyBestOfNInputSchema)
    .output(ApplyWorktreeOutputSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await withRpcSessionMutation(
        input.sessionId,
        async () => await createRuntimeBestOfNService().apply(input)
      )
    }),
  cancel: rpc
    .input(BestOfNIdInputSchema)
    .output(BestOfNRunSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await createRuntimeBestOfNService().cancel(
        input.id,
        input.sessionId
      )
    }),
  discard: rpc
    .input(BestOfNIdInputSchema)
    .output(z.object({ ok: z.boolean() }))
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await withRpcSessionMutation(input.sessionId, async () => {
        await createRuntimeBestOfNService().discard(input.id, input.sessionId)
        return { ok: true }
      })
    }),
  list: rpc
    .input(WorktreeSessionInputSchema)
    .output(ListBestOfNOutputSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return { runs: await createRuntimeBestOfNService().list(input.sessionId) }
    }),
  preview: rpc
    .input(ApplyBestOfNInputSchema.omit({ expectedFingerprint: true }))
    .output(WorktreeDiffSchema)
    .handler(async ({ context, input }) => {
      await assertSession(context, input.sessionId)
      return await createRuntimeBestOfNService().preview(
        input.id,
        input.candidateId,
        input.sessionId
      )
    })
}
