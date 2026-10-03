/* eslint-disable unicorn/prefer-dom-node-text-content -- Browser reads must reflect rendered visible text, not hidden DOM source. */
import type { JSONValue } from "@ai-sdk/provider"
import type { BrowserWindow, WebContents } from "electron"
import { z } from "zod"

const RefSchema = z
  .string()
  .min(1)
  .max(100)
  .describe(
    "Element ref returned by the latest browser read. Read again if the page changed."
  )
export const BROWSER_INTERACTION_SCHEMAS = [
  z.object({ action: z.literal("click"), ref: RefSchema }).strict(),
  z
    .object({
      action: z.literal("type"),
      append: z.boolean().default(false),
      ref: RefSchema,
      text: z.string().max(20_000)
    })
    .strict(),
  z
    .object({
      action: z.literal("scroll"),
      deltaX: z.number().int().min(-10_000).max(10_000).default(0),
      deltaY: z.number().int().min(-10_000).max(10_000),
      ref: RefSchema.optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      key: z.enum([
        "Enter",
        "Tab",
        "Escape",
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Backspace",
        "Delete",
        "Space"
      ]),
      ref: RefSchema.optional()
    })
    .strict()
] as const
export const BrowserInteractionInputSchema = z.discriminatedUnion(
  "action",
  BROWSER_INTERACTION_SCHEMAS
)
export type BrowserInteractionInput = z.infer<
  typeof BrowserInteractionInputSchema
>
export interface BrowserElement {
  checked?: boolean
  disabled?: boolean
  name: string
  ref: string
  role: string
  type: string
  value?: string
}
export const browserElementToModelJson = (
  element: BrowserElement
): Record<string, JSONValue> => {
  const result: Record<string, JSONValue> = {
    name: element.name,
    ref: element.ref,
    role: element.role,
    type: element.type
  }
  if (element.checked !== undefined) {
    result.checked = element.checked
  }
  if (element.disabled !== undefined) {
    result.disabled = element.disabled
  }
  if (
    element.value !== undefined &&
    element.type.trim().toLowerCase() !== "password"
  ) {
    result.value = element.value.slice(0, 1000)
  }
  return result
}
interface ElementTarget {
  expectation?: string
  fingerprint: string
  node: HTMLElement
}
type BrowserInteractionScope = Window &
  typeof globalThis & {
    __etyonBrowserTargets?: Map<string, ElementTarget>
  }
export type BrowserInteractionOwner = Pick<
  BrowserWindow,
  "isDestroyed" | "isFocused"
>

/* eslint-disable unicorn/consistent-function-scoping -- Page-world helpers must stay inside the serialized factory. */
// Every helper stays inside the serialized factory, including in the bundled
// main process. It never refers to a module-local helper name in the page.
const createBrowserWorld = () => {
  const scope = window as BrowserInteractionScope
  const doc = scope.document
  const textInputTypes = new Set([
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url"
  ])
  const text = (node: Element | null): string =>
    node instanceof scope.HTMLElement
      ? node.innerText
      : (node?.textContent ?? "")
  const name = (node: HTMLElement): string => {
    const ids = node.getAttribute("aria-labelledby")?.trim().split(/\s+/u) ?? []
    const referenced = ids
      .map((id) => text(doc.querySelector(`#${id}`)).trim())
      .filter(Boolean)
      .join(" ")
    const labels =
      node instanceof scope.HTMLInputElement ||
      node instanceof scope.HTMLTextAreaElement ||
      node instanceof scope.HTMLSelectElement
        ? [...(node.labels ?? [])]
            .map((label) => text(label).trim())
            .filter(Boolean)
            .join(" ")
        : ""
    const buttonValue =
      node instanceof scope.HTMLInputElement &&
      ["button", "image", "reset", "submit"].includes(node.type)
        ? node.value
        : ""
    return (
      referenced ||
      node.getAttribute("aria-label")?.trim() ||
      labels ||
      buttonValue ||
      node.getAttribute("placeholder") ||
      text(node) ||
      node.title
    )
      .trim()
      .slice(0, 200)
  }
  const role = (node: HTMLElement): string => {
    const explicit = node.getAttribute("role")?.trim().split(/\s+/u)[0]
    if (explicit) {
      return explicit.slice(0, 80)
    }
    if (node instanceof scope.HTMLInputElement) {
      if (["checkbox", "radio"].includes(node.type)) {
        return node.type
      }
      if (["button", "image", "reset", "submit"].includes(node.type)) {
        return "button"
      }
      if (node.type === "number") {
        return "spinbutton"
      }
      return node.type === "search" ? "searchbox" : "textbox"
    }
    if (node instanceof scope.HTMLTextAreaElement || node.isContentEditable) {
      return "textbox"
    }
    if (node instanceof scope.HTMLSelectElement) {
      return node.multiple || node.size > 1 ? "listbox" : "combobox"
    }
    if (node instanceof scope.HTMLAnchorElement) {
      return "link"
    }
    return node.tagName.toLowerCase()
  }
  const disabled = (node: HTMLElement): boolean =>
    node.ownerDocument !== doc ||
    node.matches(":disabled") ||
    node.closest('[aria-disabled="true"],[inert]') !== null
  const readOnly = (node: HTMLElement): boolean =>
    node.getAttribute("aria-readonly") === "true" ||
    ((node instanceof scope.HTMLInputElement ||
      node instanceof scope.HTMLTextAreaElement) &&
      node.readOnly)
  const visible = (node: HTMLElement): boolean => {
    if (node.closest('[hidden],[aria-hidden="true"],script,style')) {
      return false
    }
    for (
      let current: HTMLElement | null = node;
      current;
      current = current.parentElement
    ) {
      const style = scope.getComputedStyle(current)
      if (
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility) ||
        style.opacity === "0" ||
        style.contentVisibility === "hidden"
      ) {
        return false
      }
    }
    const bounds = node.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0
  }
  const type = (node: HTMLElement): string =>
    node instanceof scope.HTMLInputElement ||
    node instanceof scope.HTMLButtonElement
      ? node.type
      : (node.getAttribute("type") ?? "")
  const fingerprint = (node: HTMLElement): string =>
    JSON.stringify([
      node.tagName,
      type(node),
      name(node),
      node.id,
      node.getAttribute("href"),
      node.getAttribute("name"),
      disabled(node),
      readOnly(node),
      node instanceof scope.HTMLInputElement &&
      ["checkbox", "radio"].includes(node.type)
        ? node.checked
        : null,
      (node instanceof scope.HTMLInputElement && node.type !== "password") ||
      node instanceof scope.HTMLTextAreaElement
        ? node.value.slice(0, 20_000)
        : null,
      node.innerText.slice(0, 1000)
    ])
  const target = (ref: string, requireFingerprint = true): ElementTarget => {
    const found = scope.__etyonBrowserTargets?.get(ref)
    if (!found || !found.node.isConnected) {
      throw new Error("Browser target is stale. Read the page again.")
    }
    if (requireFingerprint && found.fingerprint !== fingerprint(found.node)) {
      throw new Error("Browser target changed. Read the page again.")
    }
    if (disabled(found.node)) {
      throw new Error("Browser target is disabled.")
    }
    if (!visible(found.node)) {
      throw new Error("Browser target is not visible.")
    }
    return found
  }
  const focused = (found: ElementTarget): void => {
    if (!found.node.isConnected || doc.activeElement !== found.node) {
      throw new Error("Browser target lost focus. Read the page again.")
    }
  }
  const editable = (node: HTMLElement): void => {
    const allowed =
      node instanceof scope.HTMLTextAreaElement ||
      (node instanceof scope.HTMLInputElement &&
        textInputTypes.has(node.type)) ||
      node.isContentEditable
    if (!allowed) {
      throw new Error(
        "Browser target is not an editable text field. Use click or press for select, checkbox and radio controls."
      )
    }
    if (readOnly(node)) {
      throw new Error("Browser target is read-only.")
    }
  }
  const snapshot = (): string => {
    const targets = new Map<string, ElementTarget>()
    const revision =
      scope.crypto.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const elements: BrowserElement[] = []
    for (const node of doc.querySelectorAll<HTMLElement>(
      'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=checkbox],[role=radio],[role=combobox],[role=textbox],[contenteditable=true],[contenteditable=""],[contenteditable=plaintext-only]'
    )) {
      if (elements.length >= 100) {
        break
      }
      if (!(node instanceof scope.HTMLElement) || !visible(node)) {
        continue
      }
      const ref = `${revision}:${elements.length}`
      const element: BrowserElement = {
        name: name(node),
        ref,
        role: role(node),
        type: type(node)
      }
      if (disabled(node)) {
        element.disabled = true
      }
      if (
        node instanceof scope.HTMLInputElement &&
        ["checkbox", "radio"].includes(node.type)
      ) {
        element.checked = node.checked
      } else if (
        ["checkbox", "radio"].includes(element.role) &&
        ["true", "false"].includes(node.getAttribute("aria-checked") ?? "")
      ) {
        element.checked = node.getAttribute("aria-checked") === "true"
      }
      if (
        (node instanceof scope.HTMLInputElement &&
          textInputTypes.has(node.type) &&
          node.type !== "password") ||
        node instanceof scope.HTMLTextAreaElement
      ) {
        element.value = node.value.slice(0, 1000)
      } else if (node.isContentEditable) {
        element.value = node.innerText.slice(0, 1000)
      }
      targets.set(ref, { fingerprint: fingerprint(node), node })
      elements.push(element)
    }
    scope.__etyonBrowserTargets = targets
    return JSON.stringify({
      elements,
      text: doc.body?.innerText ?? "",
      title: doc.title,
      url: scope.location.href
    })
  }
  const locate = (ref: string, focus: boolean, clickable = false): string => {
    let found = target(ref)
    found.node.scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "center"
    })
    if (focus) {
      found.node.focus({ preventScroll: true })
      found = target(ref)
      focused(found)
    }
    const bounds = found.node.getBoundingClientRect()
    const x = Math.round(bounds.x + bounds.width / 2)
    const y = Math.round(bounds.y + bounds.height / 2)
    if (clickable) {
      const hit = doc.elementFromPoint(x, y)
      if (!hit || (hit !== found.node && !found.node.contains(hit))) {
        throw new Error("Browser target is obscured. Read the page again.")
      }
    }
    return JSON.stringify({
      tag: found.node.tagName.toLowerCase(),
      type: type(found.node),
      x,
      y
    })
  }
  const prepareInput = (
    ref: string,
    append: boolean,
    inputText: string
  ): string => {
    let found = target(ref)
    editable(found.node)
    locate(ref, true)
    found = target(ref)
    editable(found.node)
    focused(found)
    const contentEditable = found.node.isContentEditable
    const previous =
      found.node instanceof scope.HTMLInputElement ||
      found.node instanceof scope.HTMLTextAreaElement
        ? found.node.value
        : found.node.innerText
    const expected = append ? previous + inputText : inputText
    if (expected.length > 20_000) {
      throw new Error("Browser input would exceed 20000 characters.")
    }
    if (
      found.node instanceof scope.HTMLInputElement &&
      found.node.type === "number" &&
      expected !== "" &&
      (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(expected) ||
        !Number.isFinite(Number(expected)))
    ) {
      throw new Error("Browser number input requires a valid number.")
    }
    if (
      found.node instanceof scope.HTMLInputElement &&
      /[\r\n]/u.test(inputText)
    ) {
      throw new Error("Browser single-line input cannot contain newlines.")
    }
    if (contentEditable && append) {
      const range = doc.createRange()
      range.selectNodeContents(found.node)
      range.collapse(false)
      const selection = scope.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    found.expectation = expected
    return JSON.stringify({
      insertText: contentEditable && append ? inputText : expected,
      selectAll: !contentEditable || !append
    })
  }
  const verifyInputTarget = (ref: string): void => {
    const found = target(ref)
    editable(found.node)
    focused(found)
  }
  const verifyInputResult = (ref: string): void => {
    const found = target(ref, false)
    const expected = found.expectation
    if (expected === undefined) {
      throw new Error("Browser input was not prepared.")
    }
    const actual =
      found.node instanceof scope.HTMLInputElement ||
      found.node instanceof scope.HTMLTextAreaElement
        ? found.node.value
        : found.node.innerText
    delete found.expectation
    if (actual !== expected) {
      throw new Error(
        "Browser input did not retain the requested value. Read the page to inspect its validation or formatting."
      )
    }
  }
  const scroll = (ref: string | null, deltaX: number, deltaY: number): void => {
    if (!ref) {
      scope.scrollBy({ behavior: "instant", left: deltaX, top: deltaY })
      return
    }
    target(ref).node.scrollBy({
      behavior: "instant",
      left: deltaX,
      top: deltaY
    })
  }
  return {
    locate,
    prepareInput,
    scroll,
    snapshot,
    verifyInputResult,
    verifyInputTarget
  }
}
/* eslint-enable unicorn/consistent-function-scoping */

const worldScript = (method: string, args: unknown[]): string =>
  `(${createBrowserWorld.toString()})().${method}(${args.map((arg) => JSON.stringify(arg)).join(",")})`
export const BROWSER_INTERACTION_WORLD_ID = 1001
export const BROWSER_PAGE_SNAPSHOT_SCRIPT = worldScript("snapshot", [])
export const browserTargetScript = (ref: string, focus: boolean): string =>
  worldScript("locate", [ref, focus])
const evaluate = async (
  contents: WebContents,
  code: string
): Promise<unknown> =>
  await contents.executeJavaScriptInIsolatedWorld(
    BROWSER_INTERACTION_WORLD_ID,
    [{ code }],
    true
  )
const BoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
})
const PreparedInputSchema = z.object({
  insertText: z.string().max(20_000),
  selectAll: z.boolean()
})
const parseSerialized = (raw: unknown): unknown => {
  if (typeof raw !== "string") {
    throw new TypeError("Invalid browser target response")
  }
  return JSON.parse(raw)
}
const requireFocusedOwner = (
  owner: BrowserInteractionOwner | undefined
): void => {
  if (!owner || owner.isDestroyed() || !owner.isFocused()) {
    throw new Error("Focus the Etyon window before sending browser input.")
  }
}
const PRESS_KEYS = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backspace: "Backspace",
  Delete: "Delete",
  Enter: "Enter",
  Escape: "Escape",
  Space: "Space",
  Tab: "Tab"
} as const

export const interactWithBrowser = async (
  contents: WebContents,
  input: BrowserInteractionInput,
  signal?: AbortSignal,
  ownerWindow?: BrowserInteractionOwner
): Promise<void> => {
  signal?.throwIfAborted()
  if (input.action === "scroll") {
    if (input.ref) {
      await evaluate(contents, browserTargetScript(input.ref, false))
    }
    await evaluate(
      contents,
      worldScript("scroll", [input.ref ?? null, input.deltaX, input.deltaY])
    )
    signal?.throwIfAborted()
    return
  }
  requireFocusedOwner(ownerWindow)
  contents.focus()
  if (input.action === "click") {
    const raw = await evaluate(
      contents,
      worldScript("locate", [input.ref, false, true])
    )
    const target = BoundsSchema.parse(parseSerialized(raw))
    signal?.throwIfAborted()
    requireFocusedOwner(ownerWindow)
    contents.sendInputEvent({
      button: "left",
      clickCount: 1,
      type: "mouseDown",
      ...target
    })
    contents.sendInputEvent({
      button: "left",
      clickCount: 1,
      type: "mouseUp",
      ...target
    })
    return
  }
  if (input.action === "type") {
    const raw = await evaluate(
      contents,
      worldScript("prepareInput", [input.ref, input.append, input.text])
    )
    const prepared = PreparedInputSchema.parse(parseSerialized(raw))
    signal?.throwIfAborted()
    if (prepared.selectAll) {
      contents.selectAll()
    }
    await evaluate(contents, worldScript("verifyInputTarget", [input.ref]))
    signal?.throwIfAborted()
    requireFocusedOwner(ownerWindow)
    await contents.insertText(prepared.insertText)
    signal?.throwIfAborted()
    await evaluate(contents, worldScript("verifyInputResult", [input.ref]))
    return
  }
  if (input.ref) {
    await evaluate(contents, browserTargetScript(input.ref, true))
  }
  signal?.throwIfAborted()
  requireFocusedOwner(ownerWindow)
  const keyCode = PRESS_KEYS[input.key]
  contents.sendInputEvent({ keyCode, type: "keyDown" })
  contents.sendInputEvent({ keyCode, type: "keyUp" })
}
