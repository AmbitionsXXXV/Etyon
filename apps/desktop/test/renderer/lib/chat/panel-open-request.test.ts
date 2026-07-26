import { describe, expect, it } from "vite-plus/test"

import {
  consumePanelOpenRequest,
  requestPanelOpen
} from "@/renderer/lib/chat/panel-open-request"

describe("consumePanelOpenRequest", () => {
  it("reports a pending request once and clears it", () => {
    requestPanelOpen()

    expect(consumePanelOpenRequest()).toBe(true)
    expect(consumePanelOpenRequest()).toBe(false)
  })

  it("reports nothing when no request was made", () => {
    expect(consumePanelOpenRequest()).toBe(false)
  })
})
