import type { StoredProviderModel } from "@etyon/rpc"

import { getProviderSeedModels } from "@/shared/providers/provider-catalog"

const cloneModel = (model: StoredProviderModel): StoredProviderModel => ({
  capabilities: model.capabilities ? { ...model.capabilities } : undefined,
  id: model.id,
  isManual: model.isManual,
  name: model.name
})

export const getCursorSeedModels = (): StoredProviderModel[] =>
  getProviderSeedModels("cursor").map(cloneModel)
