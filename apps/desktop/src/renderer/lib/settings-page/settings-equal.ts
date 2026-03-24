import type { AppSettings } from "@etyon/rpc"

export const settingsEqual = (a: AppSettings, b: AppSettings) =>
  JSON.stringify(a) === JSON.stringify(b)
