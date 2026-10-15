import {
  ListLocalAccountsOutputSchema,
  LocalAccountUsageInputSchema,
  LocalAccountUsageSchema
} from "@etyon/rpc/schemas/local-accounts"

import {
  listLocalAccounts,
  readLocalAccountUsage
} from "@/main/local-accounts/service"
import { rpc } from "@/main/rpc/context"

export const localAccountsRouter = {
  list: rpc
    .output(ListLocalAccountsOutputSchema)
    .handler(async () => await listLocalAccounts()),
  usage: rpc
    .input(LocalAccountUsageInputSchema)
    .output(LocalAccountUsageSchema)
    .handler(async ({ input }) => await readLocalAccountUsage(input.id))
}
