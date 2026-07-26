import type { PickedWebElement } from "@etyon/rpc"
import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  buildWebElementMentionLabel,
  clearPickedWebElement,
  createWebElementMention,
  getPickedWebElementSnapshot,
  publishPickedWebElement
} from "@/renderer/lib/chat/web-element-capture"

const createPickedElement = (
  overrides: Partial<PickedWebElement> = {}
): PickedWebElement => ({
  classes: ["hero", "dark"],
  id: "main-title",
  innerText: "Example Domain",
  outerHtml: '<h1 id="main-title" class="hero dark">Example Domain</h1>',
  rect: { height: 40, width: 320, x: 12, y: 96 },
  selector: "#main-title",
  styles: { color: "rgb(0, 0, 0)", fontSize: "32px" },
  tagName: "h1",
  title: "Example Domain",
  url: "https://example.com/",
  ...overrides
})

afterEach(() => {
  clearPickedWebElement()
})

describe("buildWebElementMentionLabel", () => {
  it("combines tag, id and the first class", () => {
    expect(
      buildWebElementMentionLabel({
        classes: ["hero", "dark"],
        id: "main-title",
        tagName: "h1"
      })
    ).toBe("h1#main-title.hero")
  })

  it("falls back to the bare tag when there is no id or class", () => {
    expect(
      buildWebElementMentionLabel({ classes: [], id: null, tagName: "section" })
    ).toBe("section")
  })

  it("truncates a long label with an ellipsis", () => {
    const label = buildWebElementMentionLabel({
      classes: ["a".repeat(80)],
      id: null,
      tagName: "div"
    })

    expect(label).toHaveLength(40)
    expect(label.endsWith("…")).toBe(true)
  })
})

describe("createWebElementMention", () => {
  it("keeps the model-facing payload and drops rect and classes", () => {
    expect(createWebElementMention(createPickedElement())).toEqual({
      innerText: "Example Domain",
      kind: "webElement",
      label: "h1#main-title.hero",
      outerHtml: '<h1 id="main-title" class="hero dark">Example Domain</h1>',
      selector: "#main-title",
      styles: { color: "rgb(0, 0, 0)", fontSize: "32px" },
      tagName: "h1",
      title: "Example Domain",
      url: "https://example.com/"
    })
  })
})

describe("publishPickedWebElement", () => {
  it("stores the latest mention with a monotonically increasing id", () => {
    publishPickedWebElement(createWebElementMention(createPickedElement()))
    const first = getPickedWebElementSnapshot()

    publishPickedWebElement(
      createWebElementMention(
        createPickedElement({ id: null, selector: "p", tagName: "p" })
      )
    )
    const second = getPickedWebElementSnapshot()

    expect(first?.mention.label).toBe("h1#main-title.hero")
    expect(second?.mention.label).toBe("p.hero")
    expect((second?.requestId ?? 0) > (first?.requestId ?? 0)).toBe(true)
  })

  it("re-triggers with a fresh id when the same element is picked twice", () => {
    publishPickedWebElement(createWebElementMention(createPickedElement()))
    const firstId = getPickedWebElementSnapshot()?.requestId

    publishPickedWebElement(createWebElementMention(createPickedElement()))
    const secondId = getPickedWebElementSnapshot()?.requestId

    expect(firstId).toBeDefined()
    expect(secondId).not.toBe(firstId)
  })

  it("clears the pending element", () => {
    publishPickedWebElement(createWebElementMention(createPickedElement()))
    expect(getPickedWebElementSnapshot()).not.toBeNull()

    clearPickedWebElement()
    expect(getPickedWebElementSnapshot()).toBeNull()
  })
})
