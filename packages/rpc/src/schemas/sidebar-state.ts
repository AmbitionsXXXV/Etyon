import * as z from "zod"

const EMPTY_COLLAPSED_PROJECT_PATHS: string[] = []
const DEFAULT_SIDEBAR_WIDTH_PX = 272

export const SidebarUiStateSchema = z.object({
  collapsedProjectPaths: z
    .array(z.string())
    .default(EMPTY_COLLAPSED_PROJECT_PATHS),
  sidebarWidthPx: z
    .number()
    .int()
    .min(240)
    .max(420)
    .default(DEFAULT_SIDEBAR_WIDTH_PX)
})

export const SetCollapsedProjectsInputSchema = z.object({
  collapsedProjectPaths: z.array(z.string())
})

export const SetSidebarWidthInputSchema = z.object({
  sidebarWidthPx: z.number().int().min(240).max(420)
})

export type SetCollapsedProjectsInput = z.infer<
  typeof SetCollapsedProjectsInputSchema
>
export type SetSidebarWidthInput = z.infer<typeof SetSidebarWidthInputSchema>
export type SidebarUiState = z.infer<typeof SidebarUiStateSchema>
