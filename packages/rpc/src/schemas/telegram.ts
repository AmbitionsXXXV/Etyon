import * as z from "zod"

export const TelegramBotConnectionSchema = z.object({
  firstName: z.string(),
  id: z.number(),
  username: z.string().optional()
})

export const TelegramTestConnectionInputSchema = z.object({
  botToken: z.string()
})

export const TelegramTestConnectionOutputSchema = z.object({
  bot: TelegramBotConnectionSchema.optional(),
  error: z.string().optional(),
  ok: z.boolean()
})

export type TelegramBotConnection = z.infer<typeof TelegramBotConnectionSchema>
export type TelegramTestConnectionInput = z.infer<
  typeof TelegramTestConnectionInputSchema
>
export type TelegramTestConnectionOutput = z.infer<
  typeof TelegramTestConnectionOutputSchema
>
