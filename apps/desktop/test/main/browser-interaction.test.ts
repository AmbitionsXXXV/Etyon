import type { WebContents } from "electron"
import { Window } from "happy-dom"
import type { Element as DOMElement } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  BROWSER_PAGE_SNAPSHOT_SCRIPT,
  BrowserInteractionInputSchema,
  browserElementToModelJson,
  browserTargetScript,
  interactWithBrowser
} from "@/main/browser/interaction"
import type {
  BrowserElement,
  BrowserInteractionInput
} from "@/main/browser/interaction"

const windows: Window[] = []
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("A browser fixture value was missing.")
  }
  return value
}
const createPage = (
  html = '<input placeholder="Search"><button>Submit</button>'
) => {
  const window = new Window({ url: "https://example.com" })
  windows.push(window)
  window.document.body.innerHTML = html
  const nodes = [...window.document.body.querySelectorAll("*")]
  for (const [index, node] of nodes.entries()) {
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
      new window.DOMRect(10, 10 + index * 40, 100, 30)
    )
  }
  Object.defineProperty(window.document, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) =>
      nodes.toReversed().find((node) => {
        const bounds = node.getBoundingClientRect()
        return (
          node.isConnected &&
          x >= bounds.left &&
          x < bounds.right &&
          y >= bounds.top &&
          y < bounds.bottom
        )
      }) ?? null
  })
  return window
}
const snapshot = (
  window: Window
): { elements: BrowserElement[]; text: string } =>
  JSON.parse(window.eval(BROWSER_PAGE_SNAPSHOT_SCRIPT))
const element = (window: Window, name: string): BrowserElement => {
  const found = snapshot(window).elements.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`Element not found: ${name}`)
  }
  return found
}
const fixture = (window: Window) => {
  let selectedAll: DOMElement | null = null
  const owner = {
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true)
  }
  const selectAll = vi.fn(() => {
    selectedAll = window.document.activeElement
  })
  const insertText = vi.fn((value: string) => {
    const node = window.document.activeElement
    if (
      node instanceof window.HTMLInputElement ||
      node instanceof window.HTMLTextAreaElement
    ) {
      const start = node.selectionStart ?? node.value.length
      const end = node.selectionEnd ?? start
      node.value =
        selectedAll === node
          ? value
          : node.value.slice(0, start) + value + node.value.slice(end)
      selectedAll = null
      node.dispatchEvent(
        new window.InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertText"
        })
      )
    } else if (node instanceof window.HTMLElement && node.isContentEditable) {
      if (selectedAll === node) {
        node.textContent = value
      } else {
        node.append(window.document.createTextNode(value))
      }
      selectedAll = null
    }
    return Promise.resolve()
  })
  const sendInputEvent = vi.fn(
    (event: { keyCode?: string; type: string; x?: number; y?: number }) => {
      if (event.type === "mouseUp") {
        const hit = window.document.elementFromPoint(event.x ?? 0, event.y ?? 0)
        if (hit instanceof window.HTMLElement) {
          hit.click()
        }
      }
    }
  )
  const contents = {
    executeJavaScriptInIsolatedWorld: (
      _id: number,
      scripts: { code: string }[]
    ) => Promise.resolve(window.eval(required(scripts[0]).code)),
    focus: vi.fn(),
    insertText,
    selectAll,
    sendInputEvent
  } as unknown as WebContents
  const run = async (
    input: BrowserInteractionInput,
    signal?: AbortSignal
  ): Promise<void> => await interactWithBrowser(contents, input, signal, owner)
  return { contents, insertText, owner, run, selectAll, sendInputEvent }
}
afterEach(async () => {
  for (const window of windows.splice(0)) {
    await window.happyDOM.close()
  }
})

describe("browser page snapshot", () => {
  it("maps model metadata to JSON without undefined fields or password values", () => {
    const empty = browserElementToModelJson({
      checked: false,
      disabled: undefined,
      name: "Name",
      ref: "ref",
      role: "textbox",
      type: "text",
      value: undefined
    })
    expect(empty).toEqual({
      checked: false,
      name: "Name",
      ref: "ref",
      role: "textbox",
      type: "text"
    })
    const password = browserElementToModelJson({
      name: "Password",
      ref: "ref",
      role: "textbox",
      type: " PASSWORD ",
      value: "private-password"
    })
    expect(password).not.toHaveProperty("value")
    expect(JSON.stringify(password)).not.toContain("private-password")
    expect(
      browserElementToModelJson({
        name: "Text",
        ref: "ref",
        role: "textbox",
        type: "text",
        value: "x".repeat(1200)
      }).value
    ).toHaveLength(1000)
  })
  it("reads rendered text without script, style or hidden node content", () => {
    const window = createPage(
      '<p>Visible paragraph</p><script>privateScriptToken()</script><style>.privateCSS { color: red }</style><p style="display:none">Private hidden text</p>'
    )
    const read = snapshot(window)
    expect(read.text).toContain("Visible paragraph")
    expect(read.text).not.toContain("privateScriptToken")
    expect(read.text).not.toContain("privateCSS")
    expect(read.text).not.toContain("Private hidden")
  })

  it("resolves label and aria-labelledby names, roles and bounded non-password values", () => {
    const window = createPage(
      '<label for="email">Email</label><input id="email" type="email" value="before@example.com"><span id="first">Account</span><span id="second">name</span><input aria-labelledby="first second" aria-label="Wrong fallback" value="Alice"><label><input type="checkbox" checked>Subscribe</label><label for="plan">Plan</label><select id="plan"><option>Basic</option></select><input type="password" aria-label="Password" value="private-password"><textarea aria-label="Notes"></textarea>'
    )
    required(window.document.querySelector("textarea")).value = "x".repeat(1200)
    const read = snapshot(window).elements
    expect(read.find((node) => node.name === "Email")).toMatchObject({
      role: "textbox",
      type: "email",
      value: "before@example.com"
    })
    expect(read.find((node) => node.name === "Account name")?.value).toBe(
      "Alice"
    )
    expect(read.find((node) => node.name === "Subscribe")).toMatchObject({
      checked: true,
      role: "checkbox"
    })
    expect(read.find((node) => node.name === "Plan")?.role).toBe("combobox")
    expect(read.find((node) => node.name === "Password")).not.toHaveProperty(
      "value"
    )
    expect(read.find((node) => node.name === "Notes")?.value).toHaveLength(1000)
  })

  it("excludes CSS-hidden controls and identifies disabled visible controls", () => {
    const window = createPage(
      '<div style="display:none"><input aria-label="Hidden"></div><input aria-label="Disabled" disabled><button aria-disabled="true">Unavailable</button>'
    )
    expect(snapshot(window).elements.map((node) => node.name)).toEqual([
      "Disabled",
      "Unavailable"
    ])
    expect(snapshot(window).elements.every((node) => node.disabled)).toBe(true)
  })
})

describe("browser target identity and clicks", () => {
  it("expires refs on a later read and refuses mutations or detached targets", () => {
    const window = createPage()
    const first = snapshot(window).elements
    expect(() =>
      window.eval(browserTargetScript(required(first[1]).ref, false))
    ).not.toThrow()
    required(window.document.querySelector("button")).textContent = "Delete"
    expect(() =>
      window.eval(browserTargetScript(required(first[1]).ref, false))
    ).toThrow("changed")
    snapshot(window)
    expect(() =>
      window.eval(browserTargetScript(required(first[0]).ref, false))
    ).toThrow("stale")
    const button = element(window, "Delete")
    required(window.document.querySelector("button")).remove()
    expect(() => window.eval(browserTargetScript(button.ref, false))).toThrow(
      "stale"
    )
    expect(() =>
      window.eval(
        browserTargetScript(
          'x); window.location="https://other.test"; //',
          false
        )
      )
    ).toThrow("stale")
    expect(window.location.hostname).toBe("example.com")
  })

  it("blocks a covered target rather than clicking the overlay", async () => {
    const window = createPage(
      '<button>Submit</button><div id="overlay">Overlay</div>'
    )
    const { ref } = element(window, "Submit")
    const overlay = required(window.document.querySelector("#overlay"))
    Object.defineProperty(window.document, "elementFromPoint", {
      value: () => overlay
    })
    const browser = fixture(window)
    await expect(browser.run({ action: "click", ref })).rejects.toThrow(
      "obscured"
    )
    expect(browser.sendInputEvent).not.toHaveBeenCalled()
  })

  it("reads back checkbox state after native mouse events", async () => {
    const window = createPage('<input type="checkbox" aria-label="Subscribe">')
    const { ref } = element(window, "Subscribe")
    const browser = fixture(window)
    await browser.run({ action: "click", ref })
    expect(
      browser.sendInputEvent.mock.calls.map(([event]) => event.type)
    ).toEqual(["mouseDown", "mouseUp"])
    expect(element(window, "Subscribe").checked).toBe(true)
  })

  it("refuses disabled targets and aborted actions without sending mouse or keys", async () => {
    const window = createPage("<button disabled>Submit</button>")
    const { ref } = element(window, "Submit")
    const browser = fixture(window)
    await expect(browser.run({ action: "click", ref })).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(
      browser.run({ action: "press", key: "Enter" }, controller.signal)
    ).rejects.toThrow()
    expect(browser.sendInputEvent).not.toHaveBeenCalled()
  })
})

describe("native browser text input", () => {
  it.each(["email", "number"])(
    "replaces and appends %s input without unsupported DOM selection APIs",
    async (type) => {
      const window = createPage(
        `<input type="${type}" aria-label="Field" value="${type === "number" ? "12" : "before@example.com"}">`
      )
      const input = required(window.document.querySelector("input"))
      vi.spyOn(input, "select").mockImplementation(() => {
        throw new Error("Unsupported selection API")
      })
      const browser = fixture(window)
      await browser.run({
        action: "type",
        append: false,
        ref: element(window, "Field").ref,
        text: type === "number" ? "34" : "after@example.com"
      })
      expect(input.value).toBe(type === "number" ? "34" : "after@example.com")
      await browser.run({
        action: "type",
        append: true,
        ref: element(window, "Field").ref,
        text: type === "number" ? "5" : ".test"
      })
      expect(input.value).toBe(
        type === "number" ? "345" : "after@example.com.test"
      )
      expect(browser.selectAll).toHaveBeenCalledTimes(2)
      expect(input.select).not.toHaveBeenCalled()
    }
  )

  it.each(["checkbox", "radio", "select", "readonly"])(
    "does not type through append=true into a %s control",
    async (kind) => {
      const html =
        kind === "select"
          ? '<select aria-label="Field"><option>Basic</option></select>'
          : `<input aria-label="Field" ${kind === "readonly" ? "readonly" : `type="${kind}"`}>`
      const window = createPage(html)
      const browser = fixture(window)
      await expect(
        browser.run({
          action: "type",
          append: true,
          ref: element(window, "Field").ref,
          text: "wrong"
        })
      ).rejects.toThrow(kind === "readonly" ? "read-only" : "editable text")
      expect(browser.insertText).not.toHaveBeenCalled()
      expect(browser.selectAll).not.toHaveBeenCalled()
    }
  )

  it("does not insert into another field selected by an onfocus listener", async () => {
    const window = createPage(
      '<input aria-label="Expected"><input aria-label="Other">'
    )
    const { ref } = element(window, "Expected")
    const [first, other] = window.document.querySelectorAll("input")
    required(first).addEventListener("focus", () => required(other).focus())
    const browser = fixture(window)
    await expect(
      browser.run({ action: "type", append: true, ref, text: "private" })
    ).rejects.toThrow("lost focus")
    expect(required(other).value).toBe("")
    expect(browser.insertText).not.toHaveBeenCalled()
  })

  it("rejects targets removed during focus and focus redirected during selectAll", async () => {
    const window = createPage(
      '<input aria-label="Expected"><input aria-label="Other">'
    )
    const { ref } = element(window, "Expected")
    const [first, other] = window.document.querySelectorAll("input")
    const browser = fixture(window)
    browser.selectAll.mockImplementation(() => required(other).focus())
    await expect(
      browser.run({ action: "type", append: false, ref, text: "private" })
    ).rejects.toThrow("lost focus")
    expect(browser.insertText).not.toHaveBeenCalled()
    required(first).addEventListener("focus", () => required(first).remove())
    await expect(
      browser.run({ action: "type", append: false, ref, text: "private" })
    ).rejects.toThrow("stale")
  })

  it("reports page validation that changes typed text rather than silently claiming success", async () => {
    const window = createPage('<input aria-label="Field">')
    const input = required(window.document.querySelector("input"))
    input.addEventListener("input", () => {
      input.value = "rejected by page"
    })
    const browser = fixture(window)
    await expect(
      browser.run({
        action: "type",
        append: false,
        ref: element(window, "Field").ref,
        text: "Wanted"
      })
    ).rejects.toThrow("did not retain")
  })

  it("appends to a contenteditable at its end without flattening existing markup", async () => {
    const window = createPage(
      '<div id="edit" tabindex="0" contenteditable="true" aria-label="Editor"><strong>Bold</strong></div>'
    )
    const editor = required(window.document.querySelector("#edit"))
    Object.defineProperty(editor, "isContentEditable", { value: true })
    const browser = fixture(window)
    await browser.run({
      action: "type",
      append: true,
      ref: element(window, "Editor").ref,
      text: " suffix"
    })
    expect(editor.querySelector("strong")?.textContent).toBe("Bold")
    expect(element(window, "Editor").value).toBe("Bold suffix")
    expect(browser.selectAll).not.toHaveBeenCalled()
  })

  it("does not paste invalid numeric text or exceed the bounded append limit", async () => {
    const window = createPage(
      '<input type="number" aria-label="Number"><textarea aria-label="Long"></textarea>'
    )
    required(window.document.querySelector("textarea")).value = "x".repeat(
      20_000
    )
    const browser = fixture(window)
    await expect(
      browser.run({
        action: "type",
        append: false,
        ref: element(window, "Number").ref,
        text: "not-a-number"
      })
    ).rejects.toThrow("valid number")
    await expect(
      browser.run({
        action: "type",
        append: true,
        ref: element(window, "Long").ref,
        text: "more"
      })
    ).rejects.toThrow("20000")
    expect(browser.insertText).not.toHaveBeenCalled()
  })
})

describe("browser input ownership", () => {
  it("requires the original owner window to remain focused for keyboard events", async () => {
    const window = createPage()
    const browser = fixture(window)
    browser.owner.isFocused.mockReturnValue(false)
    await expect(
      browser.run({ action: "press", key: "Enter" })
    ).rejects.toThrow("Focus the Etyon")
    expect(browser.contents.focus).not.toHaveBeenCalled()
    expect(browser.sendInputEvent).not.toHaveBeenCalled()
    browser.owner.isFocused.mockReturnValue(true)
    await browser.run({ action: "press", key: "ArrowDown" })
    expect(browser.sendInputEvent).toHaveBeenCalledWith({
      keyCode: "Down",
      type: "keyDown"
    })
  })

  it("does not claim keyboard success without a known live owner", async () => {
    const browser = fixture(createPage())
    await expect(
      interactWithBrowser(browser.contents, { action: "press", key: "Enter" })
    ).rejects.toThrow("Focus the Etyon")
    browser.owner.isDestroyed.mockReturnValue(true)
    await expect(
      browser.run({ action: "press", key: "Enter" })
    ).rejects.toThrow("Focus the Etyon")
    expect(browser.sendInputEvent).not.toHaveBeenCalled()
  })

  it("rechecks owner focus before native dispatch after a DOM target lookup", async () => {
    const window = createPage()
    const browser = fixture(window)
    browser.owner.isFocused.mockReturnValueOnce(true).mockReturnValue(false)
    await expect(
      browser.run({ action: "click", ref: element(window, "Submit").ref })
    ).rejects.toThrow("Focus the Etyon")
    expect(browser.sendInputEvent).not.toHaveBeenCalled()
  })

  it("accepts only the bounded action surface", () => {
    expect(
      BrowserInteractionInputSchema.safeParse({
        action: "eval",
        code: "alert(1)"
      }).success
    ).toBe(false)
    expect(
      BrowserInteractionInputSchema.safeParse({
        action: "scroll",
        deltaY: 20_000
      }).success
    ).toBe(false)
    expect(
      BrowserInteractionInputSchema.safeParse({ action: "press", key: "Meta" })
        .success
    ).toBe(false)
  })
})
