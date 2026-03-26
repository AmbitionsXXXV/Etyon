import * as z from "zod"

const EMPTY_COLLAPSED_PROJECT_PATHS: string[] = []

export const SidebarUiStateSchema = z.object({
  collapsedProjectPaths: z
    .array(z.string())
    .default(EMPTY_COLLAPSED_PROJECT_PATHS)
})

export const SetCollapsedProjectsInputSchema = z.object({
  collapsedProjectPaths: z.array(z.string())
})

export type SetCollapsedProjectsInput = z.infer<
  typeof SetCollapsedProjectsInputSchema
>
export type SidebarUiState = z.infer<typeof SidebarUiStateSchema>
